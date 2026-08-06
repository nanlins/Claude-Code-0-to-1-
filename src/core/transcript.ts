/**
 * 可观测性 —— 比教学版更早、更重投入的第三件事。
 *
 * 1. Transcript：每个会话一个 .transcripts/<sessionId>.jsonl，记录全部事件
 *    （用户输入 / LLM 调用摘要 / 工具调用 / 工具结果 / 权限决策 / 错误）；
 * 2. AuditLog：.audit/events.jsonl 追加式审计流（权限 + worktree 等敏感操作），
 *    用于多 agent 场景的追责与回放。
 * 3. Snapshot：会话断点恢复 —— 完整消息快照存 .transcripts/<id>.messages.json，
 *    重启后 /resume 载入继续。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Message } from '../types.js';

export class Transcript {
  private file: string;
  private lines: Array<Record<string, unknown>> = [];

  constructor(private dir: string, private sessionId: string) {
    this.file = path.join(dir, `${sessionId}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
  }

  log(event: string, data?: Record<string, unknown>): void {
    const line = { ts: new Date().toISOString(), session: this.sessionId, event, ...data };
    this.lines.push(line);
    fs.appendFileSync(this.file, JSON.stringify(line) + '\n', 'utf8');
  }

  /** 供 REPL /compact 等命令查看最近事件。 */
  recent(n = 20): Array<Record<string, unknown>> {
    return this.lines.slice(-n);
  }

  /* ---------- 断点恢复快照 ---------- */

  private snapshotFile(): string {
    return path.join(this.dir, `${this.sessionId}.messages.json`);
  }

  /** 保存完整消息快照（覆盖式，供会话恢复）。 */
  saveSnapshot(messages: Message[]): void {
    fs.writeFileSync(this.snapshotFile(), JSON.stringify(messages, null, 2), 'utf8');
  }

  /** 读取快照；不存在返回 null。 */
  loadSnapshot(): Message[] | null {
    const f = this.snapshotFile();
    if (!fs.existsSync(f)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as Message[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

/** 列出可恢复的会话（存在 .messages.json 快照的会话）。 */
export function listResumableSessions(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.messages.json'))
    .map((f) => f.replace(/\.messages\.json$/, ''));
}

export class AuditLog {
  private file: string;

  constructor(private dir: string) {
    this.file = path.join(dir, 'events.jsonl');
    fs.mkdirSync(dir, { recursive: true });
  }

  event(type: string, data?: Record<string, unknown>): void {
    const line = { ts: new Date().toISOString(), type, ...data };
    fs.appendFileSync(this.file, JSON.stringify(line) + '\n', 'utf8');
  }
}