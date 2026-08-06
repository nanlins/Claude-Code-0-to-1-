import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageBus } from '../src/tools/teams.js';

function freshBus(): { bus: MessageBus; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-team-'));
  return { bus: new MessageBus(dir), dir };
}

test('send / drain round trip (append-only, drain-on-read)', async () => {
  const { bus, dir } = freshBus();
  bus.ensureAgent('alice');
  bus.send({ type: 'message', from: 'lead', to: 'alice', text: 'hello alice' });
  const msgs = await bus.drain('alice');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, 'hello alice');
  assert.equal((await bus.drain('alice')).length, 0); // drained
  fs.rmSync(dir, { recursive: true, force: true });
});

test('broadcast reaches all agents', async () => {
  const { bus, dir } = freshBus();
  bus.ensureAgent('alice');
  bus.ensureAgent('bob');
  bus.send({ type: 'broadcast', from: 'lead', to: '*', text: 'all hands' });
  assert.equal((await bus.drain('alice')).length, 1);
  assert.equal((await bus.drain('bob')).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('protocol: plan approval request/response pairs by request_id', async () => {
  const { bus, dir } = freshBus();
  bus.ensureAgent('lead');
  bus.ensureAgent('bob');
  const requestId = 'req_123';
  bus.send({ type: 'plan_approval_request', from: 'bob', to: 'lead', requestId, text: 'refactor auth' });
  const leadMsgs = await bus.drain('lead');
  assert.equal(leadMsgs[0].type, 'plan_approval_request');
  assert.equal(leadMsgs[0].requestId, requestId);
  bus.send({ type: 'plan_approval_response', from: 'lead', to: 'bob', requestId, text: 'approved' });
  const bobMsgs = await bus.drain('bob');
  assert.equal(bobMsgs[0].type, 'plan_approval_response');
  assert.equal(bobMsgs[0].requestId, requestId);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shutdown handshake: request → ack response', async () => {
  const { bus, dir } = freshBus();
  bus.ensureAgent('alice');
  bus.send({ type: 'shutdown_request', from: 'lead', to: 'alice', requestId: 'sd_1', text: 'wrap up' });
  const msgs = await bus.drain('alice');
  assert.equal(msgs[0].type, 'shutdown_request');
  bus.send({ type: 'shutdown_response', from: 'alice', to: 'lead', requestId: 'sd_1', text: 'clean shutdown ack' });
  const lead = await bus.drain('lead');
  assert.equal(lead[0].type, 'shutdown_response');
  fs.rmSync(dir, { recursive: true, force: true });
});
