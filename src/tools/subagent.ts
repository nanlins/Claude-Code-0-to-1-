/**
 * Subagent —— 大任务拆小，每个拿到的都是干净上下文（s06 模式）。
 *
 * 两种模式（对齐真实 CC）：
 *   Normal：独立 messages[]，全新上下文（默认）
 *   Fork：复用父会话历史作为前缀，API 端 prompt cache 命中（省钱）
 *     —— 当需要从父会话大量上下文继续工作时，fork 比 normal 便宜得多
 *
 * 其余：递归深度限制；Explore 只给只读工具，Code 给完整文件工具；
 * 权限审批冒泡到父终端（共享同一个 PermissionGate）。
 */
import path from 'node:path';
import type { Session, ToolContext, ToolDef } from '../types.js';
import { Agent } from '../core/agent.js';
import { HookRegistry } from '../core/hooks.js';
import { ToolRegistry } from '../core/registry.js';
import { Transcript } from '../core/transcript.js';
import { MemoryStore } from '../core/memory.js';
import { bashTool } from './shell.js';
import { fsTools } from './fs.js';

const depths = new WeakMap<Session, number>();
const MAX_DEPTH = 3;

export function spawnSubagentTool(): ToolDef {
  return {
    schema: {
      name: 'spawn_subagent',
      description:
        '派生一个上下文隔离的子 Agent 来探索或实现一个有界的任务。只返回其最终摘要。fork=true 时复用父会话历史（prompt cache 命中，更省 token）。',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '交给子 Agent 的任务' },
          agent_type: {
            type: 'string',
            enum: ['Explore', 'Code'],
            description: 'Explore = 只读工具；Code = 完整文件工具',
            default: 'Explore',
          },
          fork: {
            type: 'boolean',
            description: 'fork=true 复用父会话历史前缀（省 token）；默认 false 用全新上下文',
            default: false,
          },
        },
        required: ['prompt'],
      },
    },
    executor: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
      const prompt = String(args.prompt ?? '');
      if (!prompt.trim()) return 'Error: prompt required';
      const agentType = String(args.agent_type ?? 'Explore') === 'Code' ? 'Code' : 'Explore';
      const fork = args.fork === true;

      const depth = depths.get(ctx.session) ?? 0;
      if (depth >= MAX_DEPTH) return `Error: subagent recursion depth limit (${MAX_DEPTH})`;

      const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const subSession: Session = {
        id,
        cwd: ctx.session.cwd,
        baseSystem: fork
          ? ctx.session.baseSystem
          : 'You are a subagent of a coding agent. Do the task and return a concise summary of findings/results. ' +
            'Do not ask questions; make reasonable assumptions.',
        messages: fork ? [...ctx.session.messages] : [],
        todos: [],
        startTime: Date.now(),
      };

      const registry = new ToolRegistry();
      if (agentType === 'Explore') {
        for (const t of fsTools()) {
          if (['read_file', 'glob', 'grep', 'list_files'].includes(t.schema.name)) registry.register(t);
        }
      } else {
        registry.registerAll(fsTools());
      }
      registry.register(bashTool());

      const subAgent = new Agent({
        config: ctx.config,
        llm: ctx.llm,
        registry,
        hooks: new HookRegistry(),
        permission: ctx.permission,
        session: subSession,
        transcript: new Transcript(path.join(ctx.session.cwd, '.transcripts'), id),
        memory: new MemoryStore(path.join(ctx.session.cwd, '.memory')),
        ask: ctx.ask,
        log: ctx.log,
        autoMemory: false,
        maxTurns: 30,
        workdirOverride: ctx.workdir,
      });

      depths.set(subSession, depth + 1);
      /* fork 模式：追加任务说明到父历史之后（前缀完全一致 → 命中 API 端 prompt cache） */
      const finalPrompt = fork ? `[Fork 子任务] ${prompt}\n基于上方父会话上下文继续，只输出本任务的结果摘要。` : prompt;
      const summary = await subAgent.run(finalPrompt);
      return summary || '(subagent returned no text)';
    },
  };
}
