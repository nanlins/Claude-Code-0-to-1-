/**
 * Context Compact —— 上下文总会满，要有办法腾地方（s08 模式）。
 *
 * 四层管线（便宜的先跑，贵的后跑）：
 *   L3 budget：大 tool_result 落盘，上下文只留标记 + 预览
 *   L1 snip：裁掉对话中段（保护 tool_use/tool_result 配对）
 *   L2 micro：旧 tool_result 换占位符
 *   L4 LLM 摘要：仍超阈值时，禁止工具的纯文本压缩调用
 * 以及 reactiveCompact：prompt_too_long 时的应急路径（s11）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LlmClient } from '../llm/client.js';
import type { Message, ToolResultBlock } from '../types.js';
import { countChars, isToolResultBlock, messageBlocks } from '../types.js';
import type { ReadFileState } from './readFileState.js';

export interface CompactOptions {
  thresholdChars: number;
  maxMessages: number;
  keepHead: number;
  keepRecentToolResults: number;
  maxToolResultChars: number;
  persistDir: string;
  onAction?: (action: string) => void;
}

const DEFAULTS = {
  maxMessages: 50,
  keepHead: 3,
  keepRecentToolResults: 3,
  maxToolResultChars: 200_000,
};

/** 同步三层（0 API）。 */
export function compactMessages(messages: Message[], opts: Partial<CompactOptions>): Message[] {
  const o: CompactOptions = {
    thresholdChars: 50_000,
    persistDir: '.task_outputs/tool-results',
    ...DEFAULTS,
    ...opts,
  };
  let msgs = messages;
  msgs = toolResultBudget(msgs, o);
  msgs = snipCompact(msgs, o);
  msgs = microCompact(msgs, o);
  return msgs;
}

/* ---------- L3: budget（大结果落盘） ---------- */

function toolResultBudget(messages: Message[], o: CompactOptions): Message[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return messages;
  const results = messageBlocks(last).filter(isToolResultBlock);
  if (results.length === 0) return messages;
  const total = results.reduce((s, r) => s + r.content.length, 0);
  if (total <= o.maxToolResultChars) return messages;

  fs.mkdirSync(o.persistDir, { recursive: true });
  const sorted = [...results].sort((a, b) => b.content.length - a.content.length);
  let budget = total - o.maxToolResultChars;
  let persisted = 0;
  for (const r of sorted) {
    if (budget <= 0) break;
    const fname = `tool_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
    fs.writeFileSync(path.join(o.persistDir, fname), r.content, 'utf8');
    r.content = `<persisted-output file="${fname}" note="Full content on disk; read it back if needed.">\n${r.content.slice(0, 2000)}`;
    budget -= r.content.length;
    persisted += 1;
    o.onAction?.(`[compact L3] persisted ${fname}`);
  }
  if (persisted > 0) o.onAction?.(`[compact L3] persisted ${persisted} large tool results to disk`);
  return messages;
}

/* ---------- L1: snip（裁中段） ---------- */

function hasToolUse(m: Message): boolean {
  return messageBlocks(m).some((b) => b.type === 'tool_use');
}

function isToolResultMessage(m: Message): boolean {
  return messageBlocks(m).some(isToolResultBlock);
}

export function snipCompact(messages: Message[], o: CompactOptions): Message[] {
  if (messages.length <= o.maxMessages) return messages;
  const keepTail = o.maxMessages - o.keepHead;
  let headEnd = o.keepHead;
  let tailStart = messages.length - keepTail;

  /* 优先找"自然断点"：切口前后都不是半截工具对 */
  const headSafe = findSafeBoundary(messages, headEnd, Math.max(1, headEnd - 8), headEnd + 8);
  if (headSafe >= 0) headEnd = headSafe;
  const tailSafe = findSafeBoundary(messages, tailStart, tailStart - 8, Math.min(messages.length - 1, tailStart + 8));
  if (tailSafe >= 0) tailStart = tailSafe;

  /* 退路：教学版保护逻辑（限步，防止纯工具对序列级联吞掉整个对话） */
  let guard = 0;
  while (headEnd < tailStart && guard < 8 && hasToolUse(messages[headEnd - 1]) && isToolResultMessage(messages[headEnd])) {
    headEnd += 1;
    guard += 1;
  }
  guard = 0;
  while (tailStart > headEnd && guard < 8 && isToolResultMessage(messages[tailStart]) && hasToolUse(messages[tailStart - 1])) {
    tailStart -= 1;
    guard += 1;
  }

  if (tailStart <= headEnd) return messages;
  const snippedCount = tailStart - headEnd;
  const out = [
    ...messages.slice(0, headEnd),
    { role: 'user' as const, content: `[snipped ${snippedCount} messages from conversation middle]` },
    ...messages.slice(tailStart),
  ];
  o.onAction?.(`[compact L1] snipped ${snippedCount} messages`);
  return out;
}

/** 在 [lo, hi] 内找切口位置 i：messages[i-1] 不含 tool_use 且 messages[i] 不是 tool_result。 */
function findSafeBoundary(messages: Message[], desired: number, lo: number, hi: number): number {
  const scan = (from: number, to: number, step: number): number => {
    for (let i = from; i >= lo && i <= hi; i += step) {
      if (i <= 0 || i >= messages.length) continue;
      const before = messages[i - 1];
      const after = messages[i];
      const beforeUse = hasToolUse(before) && !isToolResultMessage(before);
      const afterResult = isToolResultMessage(after);
      if (!beforeUse && !afterResult) return i;
    }
    return -1;
  };
  const up = scan(desired, hi, 1);
  if (up >= 0) return up;
  return scan(desired - 1, lo, -1);
}
/* ---------- L2: micro（旧结果占位） ---------- */

export function microCompact(messages: Message[], o: CompactOptions): Message[] {
  const results: ToolResultBlock[] = [];
  for (const m of messages) {
    for (const b of messageBlocks(m)) {
      if (isToolResultBlock(b)) results.push(b);
    }
  }
  const toCompact = results.slice(0, Math.max(0, results.length - o.keepRecentToolResults));
  if (toCompact.length === 0) return messages;
  for (const block of toCompact) {
    if (block.content.length > 120) {
      block.content = '[Earlier tool result compacted. Re-run if needed.]';
    }
  }
  o.onAction?.(`[compact L2] compacted ${toCompact.length} old tool results`);
  return messages;
}

/* ---------- L4: LLM 摘要（1 API，文本专用） ---------- */

const COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
You are compacting a coding-agent conversation transcript.
Keep: current goal, completed work, remaining work, user constraints, key file paths, pending decisions.
Drop: intermediate exploration, repeated tool outputs.
First write <analysis>...</analysis> reasoning, then write <summary>...</summary> with the final summary only.`;

export interface CompactHistoryOptions {
  maxTokens: number;
  keepRecentMessages?: number;
  /** 可选：compact 后恢复最近读过的文件内容。 */
  readFileState?: ReadFileState;
  /** 可选：恢复文件的目录基准（默认进程 cwd）。 */
  restoreBaseDir?: string;
  maxFilesToRestore?: number;
  maxTokensPerFile?: number;
  /** 可选：session memory（跨压缩的会话摘要）。足够长时直接复用，不调 LLM。 */
  sessionMemory?: string;
  /** session memory 复用阈值（字符数，默认 2000）。 */
  sessionMemoryMinChars?: number;
}

export interface CompactHistoryResult {
  messages: Message[];
  summary: string;
  /** 摘要来源：'llm'（调用了模型）或 'session-memory'（复用已有摘要，0 API）。 */
  source: 'llm' | 'session-memory';
}

export async function compactHistory(
  messages: Message[],
  llm: LlmClient,
  opts: CompactHistoryOptions,
): Promise<CompactHistoryResult> {
  /* SessionMemoryCompact：session memory 足够时直接复用，跳过 LLM 调用（CC 的 sessionMemoryCompact） */
  const minChars = opts.sessionMemoryMinChars ?? 2000;
  if (opts.sessionMemory && opts.sessionMemory.length >= minChars) {
    const keep = opts.keepRecentMessages ?? 10;
    const tail = messages.slice(-keep);
    const restored = opts.readFileState
      ? restoreRecentFileReads(messages, opts.readFileState, {
          baseDir: opts.restoreBaseDir,
          maxFiles: opts.maxFilesToRestore ?? 5,
          maxCharsPerFile: (opts.maxTokensPerFile ?? 5000) * 4,
        })
      : [];
    return {
      messages: [{ role: 'user', content: `[Conversation compacted. Summary:\n${opts.sessionMemory}]` }, ...tail, ...restored],
      summary: opts.sessionMemory,
      source: 'session-memory',
    };
  }

  const serialized = serializeForCompaction(messages);
  const result = await llm.complete({
    system: 'You are a conversation compaction engine. Text only. Never call tools.',
    messages: [{ role: 'user', content: `${COMPACT_PROMPT}\n\n${serialized}` }],
    tools: [],
    maxTokens: opts.maxTokens,
  });
  const text = result.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const summary = extractSummary(text) ?? text;
  const keep = opts.keepRecentMessages ?? 10;
  const tail = messages.slice(-keep);

  const restored = opts.readFileState
    ? restoreRecentFileReads(messages, opts.readFileState, {
        baseDir: opts.restoreBaseDir,
        maxFiles: opts.maxFilesToRestore ?? 5,
        maxCharsPerFile: (opts.maxTokensPerFile ?? 5000) * 4,
      })
    : [];

  return {
    messages: [{ role: 'user', content: `[Conversation compacted. Summary:\n${summary}]` }, ...tail, ...restored],
    summary,
    source: 'llm',
  };
}

/** 从被压缩的历史中提取最近 read_file 的路径，重新读取未变化文件并注入上下文。 */
function restoreRecentFileReads(
  messages: Message[],
  rfs: ReadFileState,
  opts: { baseDir?: string; maxFiles: number; maxCharsPerFile: number },
): Message[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (let i = messages.length - 1; i >= 0 && files.length < opts.maxFiles; i--) {
    for (const b of messageBlocks(messages[i])) {
      if (b.type === 'tool_use' && b.name === 'read_file') {
        const p = String((b.input as Record<string, unknown>).path ?? '');
        if (p && !seen.has(p)) {
          seen.add(p);
          files.push(p);
          if (files.length >= opts.maxFiles) break;
        }
      }
    }
  }
  if (files.length === 0) return [];

  const restored: Message[] = [];
  for (const rel of files) {
    const abs = opts.baseDir ? path.resolve(opts.baseDir, rel) : path.resolve(rel);
    if (!rfs.isUnchanged(abs)) continue;
    try {
      const content = fs.readFileSync(abs, 'utf8').slice(0, opts.maxCharsPerFile);
      restored.push({
        role: 'user',
        content: `[Restored context] File ${rel}:\n${content}`,
      });
    } catch {
      // 文件不存在或不可读则跳过
    }
  }
  return restored;
}

/** prompt_too_long 时的应急压缩（s11 路径 2）。 */
export async function reactiveCompact(
  messages: Message[],
  llm: LlmClient,
  opts: CompactHistoryOptions,
): Promise<CompactHistoryResult> {
  return compactHistory(messages, llm, { ...opts, keepRecentMessages: 6 });
}

function extractSummary(text: string): string | null {
  const m = text.match(/<summary>([\s\S]*?)<\/summary>/);
  return m ? m[1].trim() : null;
}

function serializeForCompaction(messages: Message[]): string {
  return messages
    .map((m) => {
      if (typeof m.content === 'string') return `${m.role}: ${m.content}`;
      const parts = m.content.map((b) => {
        if (b.type === 'text') return b.text;
        if (b.type === 'tool_use') return `[tool_use ${b.name} ${JSON.stringify(b.input).slice(0, 300)}]`;
        return `[tool_result ${b.content.slice(0, 500)}]`;
      });
      return `${m.role}: ${parts.join('\n')}`;
    })
    .join('\n---\n');
}

/** 总字符数（供阈值判断）。 */
export { countChars };