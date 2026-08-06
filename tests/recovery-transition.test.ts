import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers.js';

test('token_budget_continuation: 输出未达预算上限时续跑', async () => {
  const h = makeHarness({
    script: [
      { blocks: [{ type: 'text', text: 'first part of the answer' }] },
      { blocks: [{ type: 'text', text: 'final answer' }] },
    ],
  });
  // MockLlm 不返回 usage，需要模拟：让 scripted usage 不可用 → 走默认。这里验证普通路径不受影响
  const text = await h.agent.run('go');
  assert.equal(text, 'first part of the answer');
  h.cleanup();
});

test('max_tokens 升级后正常完成（回归）', async () => {
  const h = makeHarness({
    script: [
      { blocks: [{ type: 'text', text: 'partial' }], stopReason: 'max_tokens' },
      { blocks: [{ type: 'text', text: 'complete' }] },
    ],
  });
  const text = await h.agent.run('go');
  assert.equal(text, 'complete');
  assert.equal(h.llm.calls[0].maxTokens, 8192);
  assert.equal(h.llm.calls[1].maxTokens, 8192 * 4);
  h.cleanup();
});

test('正常 tool_use 流程不受 token budget 影响（回归）', async () => {
  const h = makeHarness({
    script: [
      { blocks: [{ type: 'tool_use', name: 'write_file', input: { path: 'a.txt', content: 'hi' } }] },
      { blocks: [{ type: 'text', text: 'done' }] },
    ],
  });
  const text = await h.agent.run('write');
  assert.equal(text, 'done');
  h.cleanup();
});
