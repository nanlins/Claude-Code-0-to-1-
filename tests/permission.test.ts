import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionGate } from '../src/core/permission.js';
import { makeHarness } from './helpers.js';

test('gate 1: deny list blocks dangerous bash immediately', async () => {
  const h = makeHarness();
  const gate = new PermissionGate({ mode: 'auto', ask: async () => true });
  const d = await gate.check('bash', { command: 'rm -rf /' }, { workdir: h.workdir });
  assert.equal(d.allow, false);
  const d2 = await gate.check('bash', { command: 'sudo apt install x' }, { workdir: h.workdir });
  assert.equal(d2.allow, false);
  h.cleanup();
});

test('classifier: safe read command allowed in ask mode without asking', async () => {
  let asked = 0;
  const gate = new PermissionGate({ mode: 'ask', ask: async () => { asked += 1; return true; } });
  const d = await gate.check('bash', { command: 'git status' }, { workdir: '.' });
  assert.equal(d.allow, true);
  assert.equal(asked, 0);
});

test('classifier: dangerous command asks in ask mode, auto-approves in auto mode', async () => {
  const h = makeHarness();
  let asked = 0;
  const gate = new PermissionGate({ mode: 'ask', ask: async () => { asked += 1; return true; } });
  const d = await gate.check('bash', { command: 'del temp.txt' }, { workdir: h.workdir });
  assert.equal(d.allow, true);
  assert.equal(asked, 1);

  const autoGate = new PermissionGate({ mode: 'auto', ask: async () => false });
  const d2 = await autoGate.check('bash', { command: 'del temp.txt' }, { workdir: h.workdir });
  assert.equal(d2.allow, true);
  h.cleanup();
});

test('write tools: path escape denied always; in-workspace allowed in auto', async () => {
  const h = makeHarness();
  const gate = new PermissionGate({ mode: 'auto', ask: async () => true });
  const out = await gate.check('write_file', { path: '../escape.txt', content: 'x' }, { workdir: h.workdir });
  assert.equal(out.allow, false);
  const inside = await gate.check('write_file', { path: 'ok.txt', content: 'x' }, { workdir: h.workdir });
  assert.equal(inside.allow, true);
  h.cleanup();
});

test('read-only tools always allowed even in deny mode', async () => {
  const h = makeHarness();
  const gate = new PermissionGate({ mode: 'deny', ask: async () => false });
  const d = await gate.check('read_file', { path: 'x.txt' }, { workdir: h.workdir });
  assert.equal(d.allow, true);
  h.cleanup();
});