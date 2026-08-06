# 手搓 Claude Code（Hand-rolled Claude Code）

> 从零构建的 Agent Harness —— 用 4 个里程碑复刻 Claude Code 的架构骨架。
> 智能来自模型，Agent 产品 = 模型 + Harness。这个仓库是"造载具"的练习。

零业务依赖（仅 `@anthropic-ai/sdk` + `dotenv`），TypeScript，`node:test` 测试，`MOCK=1` 离线可跑。

## 快速开始

```bash
# 1. 安装依赖
npm.cmd install          # 或 npm install（PowerShell 执行策略限制时用 npm.cmd）

# 2. 离线演示（不需要 API key）
MOCK=1 npm.cmd start
#   或在 Windows PowerShell 里：
#   $env:MOCK = '1'; npm.cmd start

# 3. 真实 LLM（支持任意 Anthropic 兼容端点）
#    复制 .env.example 为 .env，填写 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / MODEL_ID
npm.cmd start

# 4. 测试
npm.cmd test             # node --import tsx --test tests/*.test.ts
npm.cmd typecheck        # tsc --noEmit
```

### 全局命令（任意目录启动）

在任何目录输入 `anvil` 或 `小锤` 即可启动（工作区自动跟随当前目录）：

```bash
# 安装一次（在项目目录执行）
npm link

# 之后在任何目录：
anvil              # 或：小锤
```

> 说明：`npm link` 创建全局符号链接，改项目代码即时生效。

演示：`MOCK=1` 下输入任意问题，会看到 agent 循环跑完"写文件 → 读文件 → 总结"三步（mock 剧本），
验证循环、工具分发、权限、压缩、记忆、transcript 全链路。

## Docker 部署（一键启动完整栈）

> 容器化部署：App + Redis + PostgreSQL(pgvector)，环境隔离、端口错开、一条命令启动。
> 终端版应用运行在宿主机（`npm start` / `anvil`），Docker 只提供基础设施（Redis + PostgreSQL+pgvector）。

### 一键启动基础设施

```bash
# 1. 配置 API key（可选：不配则 MOCK 模式）
#    复制 .env.example 为 .env 填写，或设置环境变量
export ANTHROPIC_API_KEY=sk-xxx
export MODEL_ID=deepseek-v4-flash

# 2. 启动 Redis + PostgreSQL+pgvector
docker-compose up -d

# 3. 终端应用连接（.env）
#    REDIS_URL=redis://localhost:6380
#    PG_CONNECTION_STRING=postgres://postgres:491220@localhost:5434/ai_agent
```

### 端口映射

| 服务 | 容器 | 宿主机端口 | 说明 |
|------|------|-----------|------|
| PostgreSQL | anvil-postgres | `:5434` | pgAdmin 连接用（避开本机 5432） |
| Redis | anvil-redis | `:6380` | 缓存/限流（避开 WSL Redis 6379） |

> 容器间通过内部网络通信（`redis:6379` / `postgres:5432`），不受宿主机端口冲突影响。

### 常用命令

```bash
docker-compose up -d --build   # 构建 + 启动
docker-compose logs -f anvil   # 查看应用日志
docker-compose ps              # 查看状态
docker-compose down            # 停止（保留数据卷）
docker-compose down -v         # 停止 + 删除数据卷
```

### 架构说明（面试可讲）

- **多阶段 Dockerfile**：构建 → 生产依赖 → 精简运行镜像（3 层）
- **服务编排**：`depends_on` + 健康检查保证启动顺序
- **数据持久化**：Docker volumes（redis_data / postgres_data）
- **安全**：非 root 用户运行、健康检查探针

### CI/CD

`.github/workflows/ci-cd.yml`：push/PR 时自动跑 `typecheck` → `test` → `build` → `docker build`。

## 4 个里程碑（本仓库全部实现）

| 里程碑 | 内容 | 对应源码 |
|---|---|---|
| M1 最小闭环 | agent loop + 工具注册表 + 权限三道闸门 + 沙箱 + REPL | `src/core/agent.ts` `registry.ts` `permission.ts` `sandbox.ts` `src/repl.ts` |
| M2 扩展骨架 | Hooks（4 事件）+ TodoWrite + Subagent + Skill 两级加载 | `src/core/hooks.ts` `src/tools/todo.ts` `subagent.ts` `skills.ts` |
| M3 长会话与可靠性 | 四层压缩 + Memory + system prompt 分段组装 + 错误恢复 + 流式 | `src/core/compact.ts` `memory.ts` `prompt.ts` `recovery.ts` |
| M4 协作与生产化 | 任务系统 + 后台任务 + cron + 团队/协议/自治 + worktree + MCP + 可观测性 | `src/tools/tasks.ts` `background.ts` `cron.ts` `teams.ts` `worktree.ts` `mcp.ts` `src/core/transcript.ts` |

## 比教学版更早、更重投入的三件事

1. **安全第一**：bash 命令走 `Sandbox`（deny list 纵深防御 + 超时 + 输出上限 + 可选 `SANDBOX_CMD` 容器包装）；
   文件工具全部 `safePath` 强约束；权限管线 G0 settings.json 多来源规则（user/project/local 优先级合并）
   → G1 拒绝 → G2 规则分类器 + **YoloClassifier（LLM 自动审批，YOLO=1 启用，连续 unsafe 回退人工）** → G3 审批。
   见 `src/core/permission.ts`、`src/core/yoloClassifier.ts`、`src/core/permissionSettings.ts`。
2. **提示词缓存友好**：system 稳定段在前（BASE/WORKDIR/MODE/TOOLS），易变段在后；
   system 与 tools 都挂 `cache_control: ephemeral`；工具 schema 顺序稳定；**子 agent 支持 fork 模式**
   （复用父会话历史前缀命中 API 端 prompt cache）。见 `src/llm/client.ts`、`src/tools/subagent.ts`。
3. **测试与可观测性**：`node:test` + `MockLlm` 剧本测试（无网络）；每个会话 `.transcripts/<id>.jsonl` 全事件回放；
   `.audit/events.jsonl` 权限与 worktree 审计流。见 `tests/`、`src/core/transcript.ts`。

## 生产级机制（对齐真实 CC）

- **Hook 16 事件**：UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / SessionStart / SessionEnd /
  Stop（支持 blockingError 自纠 + stopHookActive 防死循环）/ PreCompact / PostCompact / PermissionRequest /
  PermissionDenied 等；HookResult 支持 updatedInput / blockingError / additionalContext / permissionBehavior。
- **SessionMemoryCompact**：压缩前复用 session memory（≥2000 字符直接做摘要，0 API 调用）。
- **错误恢复**：max_tokens 升级→续写、prompt_too_long reactive compact、429/529 指数退避+备用模型、
  token_budget_continuation + diminishing returns（连续 3 次增量 <500 token 停止续跑）。
- **记忆 Dream**：consolidate 四层门控（时间间隔 / 条目阈值 / 会话 / 文件锁），LLM 去重合并矛盾记忆。
- **任务高水位标**：`.highwatermark` 顺序 ID，删除任务后 ID 不重用。
- **后台看门狗**：45s 无输出增长 + 检测交互式提示 → 自动终止。
- **权限冒泡**：队友审批请求发 `permission_request` 到 Lead，Lead 用 `respond_permission` 回复。
- **Reflexion**：`self_review` 工具让模型对工作自检修正。
- **Rerank**：RAG 检索可选 LLM 二阶段精排（`search_docs` 粗排+精排架构）。

## 扩展功能（本轮新增）

- **多模型路由**：根据任务复杂度自动选择模型（简单→flash / 复杂→pro），`/model` 命令强制指定
- **成本统计**：UsageTracker 实时统计 token 用量（输入/输出/调用次数），`/usage` 可查看
- **Memory 向量化**：`searchByVector` 用 embedding 相似度检索记忆（0 API 调用，比 LLM 选择更快）
- **Redis 集成**：工具结果缓存（TTL 5分钟）+ 会话状态存储 + 滑动窗口限流
- **Docker 基础设施**：docker-compose 编排 Redis+PostgreSQL(pgvector) + DockerSandbox 容器沙箱
- **MCP WebSocket transport**：第 4 种传输方式（stdio/http/sse/ws）
- **多会话管理**：SessionManager 支持 list/switch/create/delete
- **配置热重载**：ConfigWatcher 监听 .env/settings 变化自动重载
- **对话导出**：exportConversation 支持 Markdown/JSON 格式

## 扩展功能（第二轮新增）

- **Plugin 市场**：PluginMarket 支持本地 plugin 发现/安装/卸载（skills/ 目录扫描）
- **AST 级命令分析**：commandAnalyzer 解析 bash 命令结构（管道/重定向/子shell/链接），识别危险模式，判断命令意图
- **终端主题**：深色青蓝 ANSI 主题 + 像素锤子吉祥物（SVG 矢量 logo 见 `assets/anvil.svg`）
- **REPL 快捷键**：ShortcutManager 支持 Ctrl+C/D/L/U 等快捷键
- **多语言 i18n**：中英文切换（setLocale/t 函数）

## 架构总览

```
用户输入 → UserPromptSubmit hook → [压缩管线 budget→snip→micro→LLM摘要]
        → system prompt 组装 → LLM（重试/退避/降级/应急压缩）
        → stop_reason == tool_use?
            ├─ 否 → Stop hook → 记忆提取 → 输出
            └─ 是 → 逐工具：权限闸门 → PreToolUse hook → 执行 → PostToolUse hook
                 → tool_result 回填 → 回到 LLM
```

机制很多，循环一个。所有横切逻辑（权限、日志、审计、扩展）都挂在 hooks 和管道上，循环保持纯净。

## 配置（.env）

| 变量 | 说明 | 默认 |
|---|---|---|
| `ANTHROPIC_API_KEY` | API key（缺省时自动进入 MOCK 模式） | — |
| `ANTHROPIC_BASE_URL` | Anthropic 兼容端点（DeepSeek/GLM/Kimi/DashScope 改这里） | `https://api.anthropic.com` |
| `MODEL_ID` | 模型 | `claude-sonnet-4-6` |
| `FLASH_MODEL_ID` / `PRO_MODEL_ID` | 多模型路由：简单任务 flash / 复杂任务 pro | — |
| `FALLBACK_MODEL_ID` | 429/529 连续失败时切换 | — |
| `PERMISSION_MODE` | `ask` 询问 / `auto` 自动放行规则内 / `deny` 拒绝 | `ask` |
| `YOLO` | 1 = 启用 LLM 自动审批（YoloClassifier） | `0` |
| `SANDBOX_CMD` | 命令沙箱包装（如 docker run） | — |
| `REDIS_URL` | Redis 连接（工具缓存+限流+会话状态） | — |
| `VECTOR_STORE` | 向量存储：`memory` / `pg` | `memory` |
| `PG_CONNECTION_STRING` | PostgreSQL 连接（pgvector） | — |
| `EMBEDDING_BASE_URL/KEY/MODEL` | 语义 embedding（缺省本地哈希） | — |
| `MAX_TOKENS` / `COMPACT_THRESHOLD_CHARS` / `MAX_TOOL_OUTPUT_CHARS` | 上限参数 | 8192 / 50000 / 50000 |
| `MOCK` | 1 = 离线演示 | `0` |

## REPL 命令

`/help` `/clear` `/tools` `/config` `/compact` `/tasks` `/memory` `/team` `/mode [ask|auto|deny]` `/model [模型ID]` `/apikey [sk-xxx]` `/resume` `/exit`

> 上线场景配置：启动后 `/model 模型ID` 切换模型、`/apikey sk-xxx` 设置自己的 API key（已持久化到 .env，重启保留）。

## 使用者的模型配置（推送到 GitHub 后其他人怎么用）

> 你的 API key 在 `.env` 里，已被 `.gitignore` 排除，**不会**推送到 GitHub。其他人克隆后需要自己配置。

### 方式1：首次启动自动引导（推荐）
其他人克隆并 `npm install` 后直接运行，若未配置 key 会显示引导：

```
未检测到模型配置，当前为离线演示模式（MOCK）。
配置真实模型有两种方式：
  方式1：复制 .env.example 为 .env 并填写
  方式2：启动后输入命令（本会话生效）
        /apikey sk-你的key     设置 API key
        /model 模型ID         切换模型
```

### 方式2：运行时命令（无需编辑文件）
```bash
anvil
/model deepseek-v4-flash     # 切换模型（写入 .env 持久化）
/apikey sk-xxx              # 设置自己的 API key（写入 .env 持久化）
```

### 方式3：手动配置 .env
复制 `.env.example` 为 `.env`，取消注释对应模型的配置：

```env
ANTHROPIC_API_KEY=sk-xxx
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic   # 或其他兼容端点
MODEL_ID=deepseek-v4-flash
```

### 支持的模型端点
| 模型 | baseUrl |
|------|---------|
| DeepSeek | `https://api.deepseek.com/anthropic` |
| GLM | `https://open.bigmodel.cn/api/anthropic` |
| Kimi | `https://api.moonshot.cn/anthropic` |
| MiniMax | `https://api.minimaxi.com/anthropic` |

## 吉祥物

矢量 logo 见 `assets/anvil.svg`（SVG 矢量路径 + 粗糙喷溅滤镜，愤怒锤头 + 无辜笑脸）。终端内以 ANSI 像素画呈现同一形象。

## MCP 示例

```json
// .mcp/servers.json
{ "echo": { "command": "node", "args": ["examples/mcp-echo-server.mjs"] } }
```

然后对 agent 说 "connect to the echo MCP server"，下一轮起 `mcp__echo__*` 工具可用。

## 目录结构

```
src/
  main.ts         装配 + REPL 入口（createHarness 供测试复用）
  config.ts       Anthropic 兼容端点配置
  llm/            client.ts（SDK 封装+流式+cache_control+结构化输出） mock.ts（剧本）
  core/           agent / registry / hooks / permission / sandbox /
                  transcript / prompt / compact / memory / recovery /
                  security（Prompt Injection 检测）/ usage / readFileState
  tools/          fs / shell / todo / skills / subagent / tasks /
                  background / cron / teams / worktree / mcp / index
tests/            node:test 测试（MockLlm，无网络）
tests/eval/       评估场景 + 运行器（npm run eval）
skills/           示例技能（code-review / agent-builder）
examples/         MCP echo 服务器示例
docs/             架构文档 / prompt-design（Prompt 设计说明与效果对比）
```

## 工程文档

- [架构文档](docs/architecture.md)：设计哲学、模块数据流、权限/压缩管线、多 Agent、MCP、可观测性
- [Prompt 设计说明](docs/prompt-design.md)：Prompt 结构、Few-shot 使用、输出格式控制、失败处理、4 个修改前后效果对比
- [RAG 与 pgvector](docs/rag-pgvector.md)：向量检索架构、PostgreSQL 部署、表设计（HNSW/JSONB/全文检索/事务/锁）

## 评估与安全

- **评估**：`npm run eval` 运行 5 个内置场景，输出任务完成率 / 工具调用准确率 / 耗时 / token 用量报告（真实 LLM 需要 .env；`--mock` 仅演示框架）
- **安全**：`src/core/security.ts` 在 UserPromptSubmit 阶段检测 Prompt Injection（指令覆盖 / 角色冒充 / 泄露诱导 / 工具滥用），高危命中改写输入并记录审计；配合权限三道闸门 + Sandbox deny list 纵深防御

## 路线图（教学版 → 本仓库的取舍）

- 教学版用 Python + 字符串权限；本仓库 TypeScript + 沙箱 + 分类器 + 审批（安全更早投入）。
- 教学版 glob/grep 走 shell；本仓库原生 JS 实现（Windows 行为一致）。
- 教学版 mock MCP；本仓库真实 stdio JSON-RPC 客户端 + 示例服务器。
- 未做（文档化）：并发安全工具批次、contextCollapse、YOLO LLM 分类器（钩子已留）。