/**
 * Error Recovery 工具 —— 错误不是结束，是重试的开始（s11 模式）。
 * 这里提供纯函数；agent.ts 的循环里按三种路径使用：
 *   max_tokens 截断 → 升级 token / 续写
 *   prompt_too_long → reactive compact
 *   429/529 → 指数退避 + 抖动 + 备用模型
 */
import type { LlmClient } from '../llm/client.js';
import { reactiveCompact } from './compact.js';
import type { Message } from '../types.js';

export function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || status === 529 || status === 408 || status === 502 || status === 503;
}

export function isPromptTooLong(err: unknown): boolean {
  const e = err as { error?: { type?: string }; message?: string };
  return (
    e?.error?.type === 'prompt_too_long' ||
    (typeof e?.message === 'string' && e.message.includes('prompt_too_long'))
  );
}

/** 指数退避 + 抖动（真实 CC 的公式简化版）。 */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 15_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RecoveryHandlers {
  /** prompt_too_long 时调用：压缩后返回新 messages。 */
  onPromptTooLong: () => Promise<Message[]>;
  onModelSwitch: (model: string) => void;
}

export interface RecoveryOptions {
  llm: LlmClient;
  fallbackModel?: string;
  maxConsecutiveOverloads?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/**
 * 通用"带重试的 LLM 调用"：只处理临时故障（429/529/408/502/503）。
 * max_tokens 与 prompt_too_long 由 agent 循环处理（需要改 messages）。
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  opts: RecoveryOptions,
  handlers?: RecoveryHandlers,
): Promise<T> {
  let consecutive = 0;
  let currentModel: string | undefined;
  const maxConsecutive = opts.maxConsecutiveOverloads ?? 2;

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await fn();
      consecutive = 0;
      return result;
    } catch (err) {
      if (isPromptTooLong(err) && handlers) {
        opts.log?.('warn', '[recovery] prompt_too_long → reactive compact');
        void (await handlers.onPromptTooLong());
        consecutive = 0;
        continue;
      }
      if (!isRetryableError(err)) throw err;
      consecutive += 1;
      if (opts.fallbackModel && currentModel === undefined && consecutive >= maxConsecutive) {
        currentModel = opts.fallbackModel;
        handlers?.onModelSwitch(currentModel);
        opts.log?.('warn', `[recovery] switching to fallback model ${currentModel}`);
        consecutive = 0;
        continue;
      }
      if (attempt >= 6) throw err;
      const delay = backoffDelay(attempt);
      opts.log?.('warn', `[recovery] retryable error (${(err as Error).message}) — retry in ${delay}ms`);
      await sleep(delay);
    }
  }
}

/** prompt_too_long 应急压缩的便捷包装（供 agent 使用）。 */
export async function emergencyCompact(
  messages: Message[],
  llm: LlmClient,
  maxTokens: number,
): Promise<Message[]> {
  const result = await reactiveCompact(messages, llm, { maxTokens });
  return result.messages;
}