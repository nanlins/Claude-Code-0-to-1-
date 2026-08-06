/**
 * 配置热重载 —— 监听 .env 和 settings 文件变化，自动重新加载。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ConfigWatcherOptions {
  /** 监听的目录。 */
  watchDir: string;
  /** 变化回调。 */
  onChange: (changedFiles: string[]) => void;
  /** 防抖延迟（毫秒，默认 500）。 */
  debounceMs?: number;
}

export class ConfigWatcher {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges = new Set<string>();

  constructor(private opts: ConfigWatcherOptions) {}

  /** 开始监听。 */
  start(): void {
    const filesToWatch = ['.env', '.claude/settings.json', '.claude/settings.local.json', '.mcp/servers.json'];
    for (const file of filesToWatch) {
      const fullPath = path.join(this.opts.watchDir, file);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const watcher = fs.watch(fullPath, (eventType, filename) => {
          if (filename) {
            this.pendingChanges.add(filename);
            this.scheduleReload();
          }
        });
        this.watchers.push(watcher);
      } catch {
        /* 监听失败忽略 */
      }
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const changes = [...this.pendingChanges];
      this.pendingChanges.clear();
      if (changes.length > 0) {
        this.opts.onChange(changes);
      }
    }, this.opts.debounceMs ?? 500);
  }

  /** 停止监听。 */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
