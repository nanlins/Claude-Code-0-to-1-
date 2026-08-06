import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compactMessages,
  compactHistory,
  snipCompact,
  microCompact,
} from '../src/core/compact.js';
import { MockLlm } from '../src/llm/mock.js';
import type { Message } from '../src/types.js';

function msg(role: 'user' | 'assistant', content: Message['content']): Message {
  return { role, content };
}

test('snip keeps head and tail and never splits tool_use/tool_result pairs', () => {
  const messages: Message[] = [];
  messages.push(msg('user', 'start'));
  messages.push(msg('user', 'a'));
  // 把一对工具调用恰好放在头边界附近（head=3 处会切开）
  messages.push(msg('assistant', [{ type: 'tool_use', id: 't1', name: 'bash', input: { command: 'echo 1' } }]));
  messages.push(msg('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'out 1' }]));
  for (let i = 4; i < 58; i++) messages.push(msg('user', `m${i}`));
  const out = snipCompact(messages, { maxMessages: 50, keepHead: 3, keepRecentToolResults: 3, maxToolResultChars: 200000, thresholdChars: 50000, persistDir: '.' });
  assert.ok(out.length <= 52, `out.length=${out.length}`); // 边界保护最多 +2
  const placeholder = out.find((m) => typeof m.content === 'string' && m.content.includes('snipped'));
  assert.ok(placeholder, 'expected snip placeholder');
  // 配对完整性：任一 tool_use 与其 tool_result 必须同侧（同留或同裁）
  const kept = new Set<number>();
  const headEnd = out.findIndex((m) => typeof m.content === 'string' && m.content.includes('snipped'));
  const tailStart = headEnd + 1;
  for (let i = 0; i < headEnd; i++) kept.add(i);
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use' || b.type === 'tool_result') {
        // 只校验"保留侧"的配对：head 内的 tool_use 必须有对应 result 也在 head 内
        if (i < headEnd && b.type === 'tool_use') {
          const next = out[i + 1];
          assert.ok(Array.isArray(next?.content) && next.content.some((x) => x.type === 'tool_result'), `orphan tool_use at ${i}`);
        }
        if (i >= tailStart && b.type === 'tool_result') {
          const prev = out[i - 1];
          assert.ok(Array.isArray(prev?.content) && prev.content.some((x) => x.type === 'tool_use'), `orphan tool_result at ${i}`);
        }
      }
    }
  }
  void kept;
});

test('snip terminates on pure tool-pair sequences (stress)', () => {
  const messages: Message[] = [];
  for (let i = 0; i < 60; i++) {
    messages.push(msg('assistant', [{ type: 'tool_use', id: `t${i}`, name: 'bash', input: { command: `echo ${i}` } }]));
    messages.push(msg('user', [{ type: 'tool_result', tool_use_id: `t${i}`, content: `out ${i}` }]));
  }
  const out = snipCompact(messages, { maxMessages: 50, keepHead: 3, keepRecentToolResults: 3, maxToolResultChars: 200000, thresholdChars: 50000, persistDir: '.' });
  assert.ok(out.length < messages.length, 'should compact something');
});

test('micro keeps recent 3 tool results and compacts the rest', () => {
  const messages: Message[] = [];
  for (let i = 0; i < 5; i++) {
    messages.push(msg('user', [{ type: 'tool_result', tool_use_id: `r${i}`, content: 'x'.repeat(500) }]));
  }
  const out = microCompact(messages, { keepRecentToolResults: 3, maxMessages: 50, keepHead: 3, maxToolResultChars: 200000, thresholdChars: 50000, persistDir: '.' });
  const blocks = out.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const compacted = blocks.filter((b) => b.type === 'tool_result' && b.content.includes('compacted'));
  const full = blocks.filter((b) => b.type === 'tool_result' && b.content.length > 400);
  assert.equal(compacted.length, 2);
  assert.equal(full.length, 3);
});

test('budget persists large tool results to disk', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.compact-test-'));
  try {
    const big = 'B'.repeat(100_000);
    const messages: Message[] = [
      msg('assistant', [{ type: 'tool_use', id: 'big1', name: 'bash', input: { command: 'cat big' } }]),
      msg('user', [{ type: 'tool_result', tool_use_id: 'big1', content: big }]),
    ];
    const actions: string[] = [];
    const out = compactMessages(messages, {
      thresholdChars: 50000,
      persistDir: dir,
      maxToolResultChars: 10_000,
      onAction: (a) => actions.push(a),
    });
    const persisted = fs.readdirSync(dir).filter((f) => f.startsWith('tool_result_'));
    assert.ok(persisted.length >= 1);
    const block = (Array.isArray(out[out.length - 1].content) ? out[out.length - 1].content : [])[0];
    assert.ok(block.type === 'tool_result' && block.content.includes('<persisted-output'));
    assert.ok(actions.some((a) => a.includes('persisted')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compactHistory produces summary message + tail', async () => {
  const llm = new MockLlm({
    script: [
      {
        blocks: [
          { type: 'text', text: '<analysis>a</analysis>\n<summary>THE SUMMARY</summary>' },
        ],
      },
    ],
  });
  const messages: Message[] = [];
  for (let i = 0; i < 20; i++) messages.push(msg('user', `message ${i}`));
  const result = await compactHistory(messages, llm, { maxTokens: 1000, keepRecentMessages: 5 });
  assert.equal(result.summary, 'THE SUMMARY');
  assert.equal(result.messages[0].content, '[Conversation compacted. Summary:\nTHE SUMMARY]');
  assert.equal(result.messages.length, 6); // summary + 5 tail
});