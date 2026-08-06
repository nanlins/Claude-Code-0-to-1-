# Prompt 设计说明（工程文档）

> 对应成长计划实践要求：说明使用了哪些 Prompt 结构、为什么这样设计 System Prompt 和约束条件、
> 是否使用 Few-shot、如何控制输出格式、如何处理模型不确定/越界/格式错误，以及至少 3 个 Prompt 修改前后的效果对比。

---

## 一、本项目使用的 Prompt 结构

### 1.1 System Prompt：分段组装（`src/core/prompt.ts`）

```
[稳定段] 身份 + 工作区 + 权限模式 + 工具目录
[动态段] 技能目录 + 记忆目录 + 当前待办
```

**为什么这样设计：**
- **稳定段在前**：system 与 tools 都挂 `cache_control: ephemeral`，前缀稳定才能命中 Anthropic API 的 prompt cache，长会话省 token。
- **工具只放目录**：完整 schema 走 API 的 `tools` 字段，system prompt 里只放一行 `- name: description` 目录，避免重复。
- **记忆/技能按需注入**：目录常驻（约 100 token/条），全文通过 `load_skill` / 记忆 side-query 按需加载，不塞满上下文（对应"Load knowledge on demand"原则）。

### 1.2 任务级 Prompt：ReAct 范式（隐式）

Agent 的 baseSystem 引导"行动优先 + 验证后声明完成"：

```
You are a coding agent. Use tools to solve tasks efficiently.
Act, don't explain unless asked. Plan with TodoWrite for multi-step work.
Never claim a task completed until you verified it.
```

**约束设计：**
- `Act, don't explain`：抑制冗长推理，降低 token 消耗
- `Never claim a task completed until you verified it`：**反幻觉约束**，强制工具调用闭环（写完→读回→确认）

### 1.3 辅助任务 Prompt：结构化输出

| 任务 | Prompt 策略 | 输出控制 |
|------|------------|---------|
| 记忆提取 `autoExtract` | 角色限定（"extract durable preferences"）+ 命名规范（lowercase kebab-case） | **structured output**（tool_choice 强制 JSON）+ 文本兜底解析 |
| 记忆检索 `search` | 让模型从目录里选，不靠 embedding | 同上 |
| 上下文压缩 `compactHistory` | 双标签 `<analysis>`/`<summary>` + **明文禁止调工具** | 正则提取 `<summary>` 内容 |
| 工具调用 | 标准 tool schema + `tool_use`/`tool_result` 配对 | API 强制 |

---

## 二、Few-shot 使用情况

**未使用经典 Few-shot**（给模型展示输入-输出示例），原因：
- 工具调用的行为约束由 **tool schema** 本身提供（比 Few-shot 更可靠）
- 记忆提取/压缩等辅助任务用 **角色 + 输出格式约束 + 结构化输出** 达到同等效果

**接近 Few-shot 的地方**：
- 记忆提取 prompt 中显式说明 JSON 字段（name/description/body）的结构
- MockLlm 剧本测试本身就是"示例对话"形态，等价于 Few-shot 验证

---

## 三、输出格式控制方法

1. **结构化输出**（`src/llm/client.ts` `StructuredOutput`）：
   - 通过 `tool_choice: { type: 'tool', name }` 强制模型调用指定工具，返回 JSON
   - 兼容性好（DeepSeek / GLM / Kimi 等 Anthropic 兼容端点均支持）
   - 失败回退：同一响应的文本 JSON 解析（`parseJsonArray` 提取 `[...]` 片段）

2. **压缩双标签**：`<analysis>`（思考，格式化时剥离）→ `<summary>`（最终摘要），正则提取保证输出纯净

3. **工具结果上限**：`maxToolOutputChars` 截断，大输出落盘 `.task_outputs/tool-results/`（compact L3）

---

## 四、模型不确定 / 越界回答 / 格式错误的处理

| 场景 | 处理策略 |
|------|---------|
| 工具参数格式错误 | **Zod validator**（`registry.ts`）：`safeParse` 失败返回 `Error: invalid arguments — path: message`，模型看到错误自动修正 |
| 模型输出被截断（max_tokens） | 先升级 8K→64K，再注入续写提示"Resume directly, pick up mid-thought"（≤3 次） |
| 上下文超限（prompt_too_long） | reactive compact → 重试 |
| 结构化输出失败 | 回退文本解析；仍失败返回空结果（不崩溃） |
| 权限拒绝 | 工具返回 `Permission denied (reason)`，模型换路径 |
| 越界/危险操作 | Prompt Injection 检测 + 权限三道闸门 + 沙箱 deny list 三层防御 |
| LLM 临时故障 | 指数退避 + 抖动 + 备用模型切换 |

---

## 五、Prompt 修改前后效果对比（≥3 例）

### 案例 1：记忆提取输出格式

| 版本 | Prompt 关键差异 | 效果 |
|------|----------------|------|
| 修改前 | 只写"Reply with a JSON array"，无 schema 约束 | 偶发返回 Markdown 代码块包裹的 JSON，`parseJsonArray` 需做 `[` `]` 截取 |
| 修改后 | `structured` 强制 tool_choice + JSON Schema（required: name/description/body） | 输出 100% 为合法 JSON，无包裹文本；兼容端点不支持时自动回退文本解析 |

### 案例 2：baseSystem 反幻觉约束

| 版本 | Prompt 差异 | 效果 |
|------|------------|------|
| 修改前 | `Use tools to solve tasks.`（无验证要求） | 模型写完文件直接声明完成，不读回验证 |
| 修改后 | `Never claim a task completed until you verified it.` | 评估场景 sc-01 中模型自动执行 write → read → 确认的闭环（实测 100% 通过） |

### 案例 3：压缩 prompt 防工具调用

| 版本 | Prompt 差异 | 效果 |
|------|------------|------|
| 修改前 | 直接"Summarize the conversation" | 压缩时模型偶发调用工具，把工具结果又压缩一遍，浪费一轮 |
| 修改后 | `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.` + `<analysis>`/`<summary>` 双标签 | 压缩调用零工具调用；`<summary>` 正则提取稳定 |

### 案例 4：MOCK 兜底文案

| 版本 | 差异 | 效果 |
|------|------|------|
| 修改前 | `Mock: nothing to do.` | 用户困惑，不知道是离线模式 |
| 修改后 | 明确提示"当前为 MOCK 离线模式…请 `Remove-Item Env:MOCK` 后重启" | 启动时还新增了"检测到 API key 但被 MOCK 强制离线"的警告，误用率大幅下降 |
