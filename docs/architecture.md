# 架构文档

## 设计哲学

**Agency = Model + Harness**。模型负责判断与行动选择；harness 负责把环境、工具、权限、
记忆、团队和外部能力组织好。本仓库的所有代码都是 harness —— 不给模型加智能，只给它
双手、双眼和工作空间。

三条不可动摇的原则：

1. **循环纯净**：`while stop_reason == "tool_use"` 是唯一的主干。任何新能力都以
   hook / 管道 / 工具注册的方式接入，绝不修改循环本体。
2. **文件系统即数据库**：任务 `.tasks/*.json`、团队收件箱 `.team/agents/*/inbox.jsonl`
   （append-only + drain-on-read）、记忆 `.memory/*.md`、cron 作业 `.cron/jobs.json`。
   简单、可调试、无外部依赖。
3. **上下文预算化**：压缩管线按"便宜的先跑，贵的后跑"排序；大输出落盘而非截断。

## 模块与数据流

```
┌─────────────────────────────────────────────────────────────┐
│ REPL (src/repl.ts)                                           │
│   │ ask（审批复用同一 readline）                              │
│   ▼                                                          │
│ Agent.run(input) (src/core/agent.ts)                         │
│   UserPromptSubmit hook                                      │
│   → inject()（后台任务结果 / cron 触发）                       │
│   → compactMessages（L3 budget → L1 snip → L2 micro）         │
│   → assembleSystemPrompt（稳定段在前 + cache 友好）            │
│   → llm.complete（callWithRetry：退避/降级/应急压缩）           │
│   → stopReason == 'max_tokens'？升级 token / 续写（≤3 次）     │
│   → 有 tool_use？逐工具：                                    │
│       PermissionGate.check（G1 deny → G2 规则 → G3 审批）      │
│       → PreToolUse hook → registry.execute → PostToolUse hook │
│       → tool_result 回填                                      │
│   → 无 tool_use？Stop hook → memory.autoExtract → 返回文本     │
└─────────────────────────────────────────────────────────────┘
```

## 权限管线（安全第一）

```
G1 拒绝列表   bash 危险模式（rm -rf /、sudo、shutdown…）+ 写路径逃逸 → 直接拒绝
G2 规则匹配   只读工具放行；bash 用规则分类器（SAFE_READ_CMD / DANGEROUS_CMD）
             classifier 钩子可换成 LLM 分类器（YOLO 模式）
G3 审批       ask 模式 → 终端 y/N（REPL 复用同一 readline）
             auto 模式 → 规则内放行 / deny 模式 → 一律拒绝
```
纵深防御：即使权限层被绕过，`Sandbox` 仍会做 deny 检查、路径约束、超时、输出上限；
`SANDBOX_CMD` 可以把命令整体送进 docker/WSL。

## 压缩管线（四层 + 应急）

| 层 | 触发 | 动作 | 成本 |
|---|---|---|---|
| L3 budget | 单条 user 消息 tool_result > 200KB | 大结果落盘 `.task_outputs/tool-results/`，留标记+2KB 预览 | 0 API |
| L1 snip | 消息数 > 50 | 保留头 3 + 尾 47，保护 tool_use/tool_result 配对 | 0 API |
| L2 micro | 旧 tool_result | 保留最近 3 条，其余换占位符 | 0 API |
| L4 摘要 | 仍超阈值 | 纯文本压缩 prompt（禁止工具 + `<analysis>/<summary>`） | 1 API |
| 应急 | prompt_too_long | reactiveCompact（保留更少尾部） | 1 API |

## 多 Agent 协作

- **MessageBus**：`.team/agents/<name>/inbox.jsonl`，append-only，drain-on-read。
- **协议**：request_id 配对 —— shutdown 握手、plan 审批门（send_plan_request / respond_plan）。
- **自治**：Teammate 状态机 WORK → IDLE → SHUTDOWN；空闲轮询任务看板，自动认领
  （`blockedBy` 全部完成才可 claim），完成即解锁下游。
- **隔离**：`git worktree add -b wt/<name>` + 任务绑定；工具 cwd 由 workdir 决定。

## MCP

- 真实 stdio JSON-RPC：`initialize → notifications/initialized → tools/list → tools/call`。
- 配置 `.mcp/servers.json`；连接后工具以 `mcp__server__tool` 注册进 ToolRegistry，
  下一轮 LLM 调用即可见（每轮都重新取 schemas）。

## 可观测性

- `.transcripts/<sessionId>.jsonl`：user_prompt / llm_call / tool_use / permission / compact / llm_error。
- `.audit/events.jsonl`：权限询问与 worktree 变更（敏感操作审计流）。
- 测试用 `MockLlm` 剧本驱动，断言 transcript 与消息序列，全程无网络。
