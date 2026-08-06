/**
 * REPL 快捷键 —— 终端快捷键支持。
 *
 * 快捷键：
 *   Ctrl+C  — 中断当前操作
 *   Ctrl+D  — 退出
 *   Ctrl+L  — 清屏
 *   Ctrl+U  — 清除当前输入
 *   Ctrl+K  — 清除光标后内容
 *   Ctrl+A  — 光标移到行首
 *   Ctrl+E  — 光标移到行尾
 *   Ctrl+W  — 删除前一个单词
 *   Up/Down — 历史命令导航
 *   Tab     — 自动补全
 */

export interface ShortcutHandler {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  description: string;
  action: () => void | Promise<void>;
}

export class ShortcutManager {
  private handlers = new Map<string, ShortcutHandler>();

  register(handler: ShortcutHandler): void {
    const key = this.buildKey(handler);
    this.handlers.set(key, handler);
  }

  private buildKey(handler: ShortcutHandler): string {
    const parts: string[] = [];
    if (handler.ctrl) parts.push('ctrl');
    if (handler.meta) parts.push('meta');
    parts.push(handler.key.toLowerCase());
    return parts.join('+');
  }

  /** 处理按键事件。 */
  async handleKey(key: string, ctrl: boolean, meta: boolean): Promise<boolean> {
    const parts: string[] = [];
    if (ctrl) parts.push('ctrl');
    if (meta) parts.push('meta');
    parts.push(key.toLowerCase());
    const combo = parts.join('+');

    const handler = this.handlers.get(combo);
    if (handler) {
      await handler.action();
      return true;
    }
    return false;
  }

  /** 列出所有快捷键。 */
  list(): ShortcutHandler[] {
    return [...this.handlers.values()];
  }
}

/** 创建默认快捷键。 */
export function createDefaultShortcuts(actions: {
  interrupt?: () => void;
  exit?: () => void;
  clearScreen?: () => void;
  clearInput?: () => void;
}): ShortcutManager {
  const manager = new ShortcutManager();

  if (actions.interrupt) {
    manager.register({ key: 'c', ctrl: true, description: '中断当前操作', action: actions.interrupt });
  }
  if (actions.exit) {
    manager.register({ key: 'd', ctrl: true, description: '退出', action: actions.exit });
  }
  if (actions.clearScreen) {
    manager.register({ key: 'l', ctrl: true, description: '清屏', action: actions.clearScreen });
  }
  if (actions.clearInput) {
    manager.register({ key: 'u', ctrl: true, description: '清除当前输入', action: actions.clearInput });
  }

  return manager;
}
