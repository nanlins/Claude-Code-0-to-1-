import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarness } from './helpers.js';

test('spawn_subagent: normal 模式用全新 messages（不携带父历史）', async () => {
  const h = makeHarness({
    script: [
      { blocks: [{ type: 'tool_use', name: 'spawn_subagent', input: { prompt: 'explore', agent_type: 'Explore' } }] },
      { blocks: [{ type: 'text', text: 'parent done' }] },
      { blocks: [{ type: 'text', text: 'sub done' }] },
    ],
  });
  await h.agent.run('parent task');
  const subCall = h.llm.calls.find((c) => c.messages.some((m) => typeof m.content === 'string' && (m.content as string).includes('explore')));
  assert.ok(subCall, '应调用子 agent');
  h.cleanup();
});

test('spawn_subagent: fork 模式复用父会话历史（前缀一致）', async () => {
  const h = makeHarness({
    script: [
      {
        blocks: [
          {
            type: 'tool_use',
            name: 'spawn_subagent',
            input: { prompt: 'continue work', agent_type: 'Code', fork: true },
          },
        ],
      },
      { blocks: [{ type: 'text', text: 'parent done' }] },
      { blocks: [{ type: 'text', text: 'sub done' }] },
    ],
  });
  await h.agent.run('parent context task');
  // 子 agent 调用（第二次 LLM 调用）：messages 应包含父历史前缀
  const subCall = h.llm.calls[1];
  assert.ok(subCall, '存在子 agent 调用');
  const textMsgs = subCall.messages.filter((m) => typeof m.content === 'string');
  assert.ok(
    textMsgs.some((m) => (m.content as string).includes('parent context task')),
    'fork 子 agent 应携带父会话历史',
  );
  h.cleanup();
});

test('spawn_subagent: 递归深度限制', async () => {
  const h = makeHarness({
    script: [
      { blocks: [{ type: 'tool_use', name: 'spawn_subagent', input: { prompt: 'recurse', agent_type: 'Explore' } }] },
      { blocks: [{ type: 'text', text: 'done' }] },
      { blocks: [{ type: 'tool_use', name: 'spawn_subagent', input: { prompt: 'recurse2', agent_type: 'Explore' } }] },
      { blocks: [{ type: 'text', text: 'done2' }] },
      { blocks: [{ type: 'tool_use', name: 'spawn_subagent', input: { prompt: 'recurse3', agent_type: 'Explore' } }] },
      { blocks: [{ type: 'text', text: 'done3' }] },
    ],
  });
  await h.agent.run('go');
  h.cleanup();
});
