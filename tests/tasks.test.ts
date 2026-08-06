import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskSystem } from '../src/tools/tasks.js';

function freshSystem(): { system: TaskSystem; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tasks-'));
  return { system: new TaskSystem(path.join(dir, '.tasks')), dir };
}

test('create/claim/complete with blockedBy dependency graph', async () => {
  const { system, dir } = freshSystem();
  const t1 = system.create('setup db');
  const t2 = system.create('write api', 'needs db', [t1.id]);

  assert.equal(system.canStart(t2.id), false);
  assert.ok((await system.claim(t2.id, 'alice')).includes('blocked by'));

  assert.equal(await system.claim(t1.id, 'alice'), `Claimed ${t1.id}`);
  assert.ok((await system.complete(t1.id)).startsWith('Completed'));
  assert.equal(system.canStart(t2.id), true);

  assert.equal(await system.claim(t2.id, 'bob'), `Claimed ${t2.id}`);
  assert.equal(await system.complete(t2.id), `Completed ${t2.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('owner conflict is rejected', async () => {
  const { system, dir } = freshSystem();
  const t = system.create('task');
  await system.claim(t.id, 'alice');
  assert.ok((await system.claim(t.id, 'bob')).includes('already claimed by alice'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('complete unlocks dependents', async () => {
  const { system, dir } = freshSystem();
  const a = system.create('a');
  const b = system.create('b', '', [a.id]);
  await system.claim(a.id, 'x');
  const res = await system.complete(a.id);
  assert.ok(res.includes('Unlocked'));
  assert.ok(res.includes(b.id));
  fs.rmSync(dir, { recursive: true, force: true });
});
