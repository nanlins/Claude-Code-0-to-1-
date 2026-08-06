/**
 * ReadFileState —— 重复读取未变化文件时返回 FILE_UNCHANGED_STUB。
 * 按 mtime + size 判断文件是否变化，避免重复读大文件浪费 token。
 * 与子 agent 共享（CC 中 readFileState 从父克隆），同一实例跨 agent 复用。
 */
import fs from 'node:fs';

export const FILE_UNCHANGED_STUB = '[File unchanged since last read]';

interface CachedEntry {
  mtimeMs: number;
  size: number;
}

export class ReadFileState {
  private cache = new Map<string, CachedEntry>();

  /** 检查是否自上次读取后未变化。 */
  isUnchanged(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      const entry = this.cache.get(filePath);
      if (!entry) return false;
      return entry.mtimeMs === stat.mtimeMs && entry.size === stat.size;
    } catch {
      return false;
    }
  }

  /** 读取成功后再标记缓存。 */
  markRead(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      this.cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // 文件不存在则清除缓存
      this.cache.delete(filePath);
    }
  }

  /** 清除某个文件（或全部）的缓存。 */
  invalidate(filePath?: string): void {
    if (filePath) this.cache.delete(filePath);
    else this.cache.clear();
  }
}
