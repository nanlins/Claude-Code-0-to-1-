/**
 * Usage Tracker —— 累计 token 用量与成本估算。
 * 每次 LLM 调用后记录 input/output tokens，提供汇总与重置。
 */

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

export class UsageTracker {
  private records: UsageRecord[] = [];

  record(model: string, usage: { inputTokens?: number; outputTokens?: number }): void {
    this.records.push({
      model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      timestamp: Date.now(),
    });
  }

  summary(): { totalInput: number; totalOutput: number; total: number; calls: number } {
    let totalInput = 0;
    let totalOutput = 0;
    for (const r of this.records) {
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
    }
    return { totalInput, totalOutput, total: totalInput + totalOutput, calls: this.records.length };
  }

  reset(): void {
    this.records = [];
  }

  history(): UsageRecord[] {
    return [...this.records];
  }
}
