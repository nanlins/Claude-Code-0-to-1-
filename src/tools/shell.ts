/**
 * bash 工具 —— 命令走 Sandbox（deny list + 超时 + 输出上限 + 可选容器包装）。
 * cwd 跟随 workdir（worktree 隔离场景自动切换）。
 * 支持 run_in_background 参数：慢操作放后台，立即返回任务 ID。
 */
import { z } from 'zod';
import { Sandbox } from '../core/sandbox.js';
import type { ToolContext, ToolDef } from '../types.js';
import type { BackgroundSystem } from './background.js';

const bashSchema = z.object({
  command: z.string().min(1, 'command cannot be empty'),
  run_in_background: z.boolean().optional(),
});

export function bashTool(bg?: BackgroundSystem): ToolDef {
  return {
    schema: {
      name: 'bash',
      description: '在工作区执行 shell 命令（沙箱保护，120s 超时，输出截断）。慢操作可设 run_in_background=true。',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          run_in_background: { type: 'boolean', description: '慢操作放后台执行（返回任务 id）', default: false },
        },
        required: ['command'],
      },
    },
    validator: bashSchema,
    executor: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
      const command = String(args.command ?? '');
      if (!command.trim()) return 'Error: empty command';

      /* 无论前台/后台，先过 deny list（纵深防御，后台路径不得绕过沙箱） */
      const blocked = Sandbox.blockedByDenyList(command);
      if (blocked) return `Error: ${blocked}`;

      if (args.run_in_background && bg) {
        const id = bg.start(command);
        return `[Background task ${id} started] Poll with bg_check.`;
      }

      const sandbox = new Sandbox({
        cwd: ctx.workdir,
        sandboxCmd: ctx.config.sandboxCmd,
        maxOutputChars: ctx.config.maxToolOutputChars,
      });
      return sandbox.run(command);
    },
  };
}
