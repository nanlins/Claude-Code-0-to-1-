import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisService } from '../src/core/redis.js';

test('RedisService: 未连接时降级为无缓存', async () => {
  const redis = new RedisService({ url: 'redis://localhost:1' }); // 无效端口
  const connected = await redis.connect();
  assert.equal(connected, false);
  assert.equal(redis.isConnected(), false);
  // 未连接时 getToolCache 返回 null
  const cached = await redis.getToolCache('test', { a: 1 });
  assert.equal(cached, null);
});

test('RedisService: 未连接时 setToolCache 不抛错', async () => {
  const redis = new RedisService({ url: 'redis://localhost:1' });
  await assert.doesNotReject(async () => {
    await redis.setToolCache('test', { a: 1 }, 'result');
  });
});

test('RedisService: 未连接时 checkRateLimit 返回 true', async () => {
  const redis = new RedisService({ url: 'redis://localhost:1' });
  const allowed = await redis.checkRateLimit();
  assert.equal(allowed, true);
});

test('RedisService: 未连接时 listSessions 返回空数组', async () => {
  const redis = new RedisService({ url: 'redis://localhost:1' });
  const sessions = await redis.listSessions();
  assert.deepEqual(sessions, []);
});

test('RedisService: close 未连接时不抛错', async () => {
  const redis = new RedisService({ url: 'redis://localhost:1' });
  await assert.doesNotReject(async () => {
    await redis.close();
  });
});
