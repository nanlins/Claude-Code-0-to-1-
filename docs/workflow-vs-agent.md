# Workflow vs Agent：何时用哪种（工程决策文档）

> 参考 Anthropic《Building Effective Agents》：可控流程优先于盲目 Agent 化。

## 核心判断

| 场景 | 选择 | 理由 |
|------|------|------|
| 步骤固定、顺序明确（如：拉取→构建→测试→报告） | **Workflow** | 确定性流程，Agent 化只会引入随机性 |
| 步骤不可预知、需要动态决策（如：修复未知 bug） | **Agent** | 需要模型判断下一步 |

## 本项目中的应用

### 本仓库已有：Agent 模式（默认）

```text
用户输入 → Agent 循环 → 模型自主决定调哪些工具
```

适用于：代码修复、探索、多文件重构等开放式任务。

### 建议补充：Workflow 模式（`/workflow` 或独立脚本）

将固定流程写成确定性管线，只把"不确定的子步骤"交给 Agent：

```
示例：CI 报告工作流
  1. git pull（确定性）
  2. npm run typecheck（确定性）
  3. 若失败 → 交给 Agent 分析错误并修复（Agent 化）
  4. 重新运行 2-3 直到通过（循环）
  5. 生成总结（确定性模板）
```

### 模式对照表（Anthropic 五模式）

| 模式 | 何时用 | 本项目对应 |
|------|--------|-----------|
| Prompt Chaining | 输出是下一步输入，串行分解 | 多轮 agent 循环（隐式） |
| Routing | 按输入分类走不同分支 | 工具分发 TOOL_HANDLERS（隐式） |
| Parallelization | 子任务独立可并行 | 工具并发批次 partitionBatches + 多队友 |
| Orchestrator-Workers | 主 Agent 分解并委派 | spawn_subagent / spawn_teammate |
| Evaluator-Optimizer | 生成后评估再迭代 | 评估系统 tests/eval + 记忆提取验证 |

## 工程建议

1. 默认从 **Workflow 起步**：先写确定步骤，只有出现"分支不确定"再引入 Agent 决策
2. Agent 内部用 **Orchestrator-Workers**：大任务拆子 Agent（已有）
3. 用 **评估系统**（`npm run eval`）衡量 Agent 化是否真的提升了效果，而不是"为了 Agent 而 Agent"
