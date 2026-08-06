/**
 * 对话导出 —— 将会话历史导出为 Markdown / JSON。
 */
import type { Message } from '../types.js';

export type ExportFormat = 'markdown' | 'json';

/** 导出会话为指定格式。 */
export function exportConversation(messages: Message[], format: ExportFormat = 'markdown'): string {
  if (format === 'json') {
    return JSON.stringify(messages, null, 2);
  }

  /* Markdown 格式 */
  const lines: string[] = ['# 对话记录', '', `导出时间: ${new Date().toISOString()}`, ''];

  for (const msg of messages) {
    const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
    lines.push(`## ${role}`, '');

    if (typeof msg.content === 'string') {
      lines.push(msg.content, '');
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          lines.push(block.text, '');
        } else if (block.type === 'tool_use') {
          lines.push(`**调用工具**: \`${block.name}\``, '```json', JSON.stringify(block.input, null, 2), '```', '');
        } else if (block.type === 'tool_result') {
          lines.push(`**工具结果**:`, '```', block.content.slice(0, 500), '```', '');
        }
      }
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}
