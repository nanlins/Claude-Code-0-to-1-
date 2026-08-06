/**
 * Agent 评估场景 —— 定义任务、期望结果检查器与指标采集。
 *
 * 每个场景包含：
 *   id/prompt      —— 任务本身
 *   requiresTool   —— 期望调用的关键工具（用于"工具调用准确率"指标）
 *   check          —— 对工作区/对话产物的结果检查（用于"任务完成率"指标）
 *   setup          —— 可选前置准备（制造失败/脏环境，用于"失败恢复能力"指标）
 */

import fs from 'node:fs';
import path from 'node:path';

export interface EvalContext {
  workdir: string;
  logs: Array<{ tool: string; args: Record<string, unknown>; output: string }>;
  messagesCount: number;
  usage: { inputTokens: number; outputTokens: number; calls: number };
  durationMs: number;
}

export interface EvalScenario {
  id: string;
  name: string;
  prompt: string;
  /** 期望被调用的关键工具（缺一即扣"工具准确率"）。 */
  requiresTool?: string[];
  /** 前置准备：可写文件制造失败环境。 */
  setup?: (workdir: string) => void;
  /** 结果检查：返回 null 表示通过，返回字符串为失败原因。 */
  check: (workdir: string, ctx: EvalContext) => Promise<string | null>;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: Array<{ id: string; reason: string }>;
  toolAccuracy: { correct: number; total: number };
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function buildReport(scenarios: EvalScenario[], results: Array<{ scenario: EvalScenario; ok: boolean; reason: string | null }>, ctx: EvalContext): EvalReport {
  const passed = results.filter((r) => r.ok).length;
  const toolChecks = scenarios.flatMap((s) => s.requiresTool ?? []);
  const toolHits = new Set<string>();
  for (const log of ctx.logs) toolHits.add(log.tool);
  const correct = toolChecks.filter((t) => toolHits.has(t)).length;
  return {
    total: scenarios.length,
    passed,
    failed: results.filter((r) => !r.ok).map((r) => ({ id: r.scenario.id, reason: r.reason ?? 'unknown' })),
    toolAccuracy: { correct, total: toolChecks.length },
    totalDurationMs: ctx.durationMs,
    totalInputTokens: ctx.usage.inputTokens,
    totalOutputTokens: ctx.usage.outputTokens,
  };
}

export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push('===== Agent 评估报告 =====');
  lines.push(`场景总数: ${r.total}   通过: ${r.passed}   失败: ${r.failed.length}`);
  lines.push(`任务完成率: ${r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0}%`);
  lines.push(
    `工具调用准确率: ${r.toolAccuracy.total > 0 ? Math.round((r.toolAccuracy.correct / r.toolAccuracy.total) * 100) : 0}% (${r.toolAccuracy.correct}/${r.toolAccuracy.total})`,
  );
  lines.push(`总耗时: ${(r.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`Token 用量: 输入 ${r.totalInputTokens} / 输出 ${r.totalOutputTokens}`);
  if (r.failed.length > 0) {
    lines.push('失败 case:');
    for (const f of r.failed) lines.push(`  - [${f.id}] ${f.reason}`);
  }
  lines.push('===========================');
  return lines.join('\n');
}

/* ---------- 内置评估场景 ---------- */

export const DEFAULT_SCENARIOS: EvalScenario[] = [
  {
    id: 'sc-01',
    name: '创建文件并验证内容',
    prompt: '用 write_file 创建 report.txt，内容为 "Eval scenario one"，然后用 read_file 读回来确认。',
    requiresTool: ['write_file', 'read_file'],
    check: async (workdir) => {
      const p = path.join(workdir, 'report.txt');
      if (!fs.existsSync(p)) return '期望文件 report.txt 不存在';
      const content = fs.readFileSync(p, 'utf8');
      if (!content.includes('Eval scenario one')) return `内容不符: ${content}`;
      return null;
    },
  },
  {
    id: 'sc-02',
    name: '读取文件并回答内容问题',
    prompt: '先读 examples/mcp-echo-server.mjs 文件，然后回答：该文件用了哪个 Node 模块处理输入？',
    requiresTool: ['read_file'],
    check: async (_workdir, ctx) => {
      const hasRead = ctx.logs.some((l) => l.tool === 'read_file' && String(l.args.path ?? '').includes('mcp-echo-server'));
      return hasRead ? null : '未读取 mcp-echo-server.mjs';
    },
  },
  {
    id: 'sc-03',
    name: '失败恢复：脚本先失败后重试',
    prompt: '运行 bash 执行 node -e "throw new Error(1)"（会失败），然后换一个能成功的命令 node -e "console.log(42)" 验证 node 可用。',
    requiresTool: ['bash'],
    check: async (_workdir, ctx) => {
      const bashCalls = ctx.logs.filter((l) => l.tool === 'bash');
      if (bashCalls.length < 2) return 'bash 调用次数不足，未体现失败后重试';
      return null;
    },
  },
  {
    id: 'sc-04',
    name: '多文件批量操作',
    prompt: '创建 a.txt、b.txt、c.txt 三个文件，内容分别为 A、B、C（用 write_file，可并行）。',
    requiresTool: ['write_file'],
    check: async (workdir) => {
      for (const [f, expect] of [
        ['a.txt', 'A'],
        ['b.txt', 'B'],
        ['c.txt', 'C'],
      ] as const) {
        const p = path.join(workdir, f);
        if (!fs.existsSync(p)) return `期望文件 ${f} 不存在`;
        if (fs.readFileSync(p, 'utf8').trim() !== expect) return `${f} 内容不符`;
      }
      return null;
    },
  },
  {
    id: 'sc-05',
    name: '规划工具使用（TodoWrite）',
    prompt: '这是一个多步骤任务：先列计划（TodoWrite），然后创建 hello_eval.py（打印 hello），最后用 bash 运行它。',
    requiresTool: ['TodoWrite', 'write_file', 'bash'],
    check: async (workdir) => {
      const p = path.join(workdir, 'hello_eval.py');
      if (!fs.existsSync(p)) return '期望文件 hello_eval.py 不存在';
      return null;
    },
  },
];
