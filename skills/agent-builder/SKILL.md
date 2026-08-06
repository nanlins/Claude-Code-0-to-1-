---
name: agent-builder
description: 设计和构建 Agent Harness（agent 循环、工具、hooks、权限、上下文管理）。当需要构建或扩展 agent 系统时使用。
---

# Agent 构建器

核心原则：

1. **Agency = Model + Harness**。循环内绝不包含业务逻辑；一切挂在 hooks/管道上。
2. **循环优先**：`while stop_reason == tool_use` 是整个系统的心脏。先构建它，再谈其他。
3. **工具是 (schema, executor) 对**，注册进分发映射表。加工具永远不改循环。
4. **执行前先做权限判断**：拒绝列表 → 规则 → 审批。永远不要把安全托付给模型。
5. **上下文是最稀缺的资源**：budget → snip → micro → LLM 摘要，便宜的先跑。
6. **文件系统就是数据库**：`.tasks/*.json`、`.team/.../*.jsonl`（append-only）、`.memory/*.md`。
7. **子 Agent 隔离上下文**：独立的 messages[]，只回传摘要。
8. **Hooks 保持循环纯净**：用 PreToolUse/PostToolUse/Stop 处理横切关注点。

搭建新 agent 时：
- 从一个接入工具注册表 + 权限闸门的 `Agent` 类开始。
- 在加功能之前先加 hooks（日志、审批、审计）。
- 从第一天就接上 transcript/audit —— 不能回放的东西就无法调试。
