import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/modelRouter.js';

function makeRouter(): ModelRouter {
  return new ModelRouter({
    flashModel: 'deepseek-v4-flash',
    defaultModel: 'deepseek-v4-pro',
    proModel: 'deepseek-v4-max',
  });
}

test('route: 简单查询 → flash', () => {
  const r = makeRouter();
  const d = r.route({ userMessage: '列出所有文件' });
  assert.equal(d.tier, 'flash');
  assert.equal(d.model, 'deepseek-v4-flash');
});

test('route: 复杂任务关键词 → pro', () => {
  const r = makeRouter();
  const d = r.route({ userMessage: '重构这个模块的架构' });
  assert.equal(d.tier, 'pro');
  assert.equal(d.model, 'deepseek-v4-max');
});

test('route: 只读工具 → flash', () => {
  const r = makeRouter();
  const d = r.route({ toolNames: ['read_file', 'glob'] });
  assert.equal(d.tier, 'flash');
});

test('route: 多工具写入 → pro', () => {
  const r = makeRouter();
  const d = r.route({ toolNames: ['write_file', 'edit_file', 'bash'] });
  assert.equal(d.tier, 'pro');
});

test('route: 长上下文 → pro', () => {
  const r = makeRouter();
  const d = r.route({ contextLength: 100_000 });
  assert.equal(d.tier, 'pro');
});

test('route: 多轮对话后期 → pro', () => {
  const r = makeRouter();
  const d = r.route({ turnCount: 15 });
  assert.equal(d.tier, 'pro');
});

test('route: 默认 → default', () => {
  const r = makeRouter();
  const d = r.route({ userMessage: '帮我写个函数' });
  assert.equal(d.tier, 'default');
  assert.equal(d.model, 'deepseek-v4-pro');
});

test('forceTier: 强制指定', () => {
  const r = makeRouter();
  r.forceTier('flash');
  const d = r.route({ userMessage: '重构架构' });
  assert.equal(d.tier, 'flash');
  assert.equal(d.reason, '用户强制指定');
});

test('forceTier: 清除后恢复自动路由', () => {
  const r = makeRouter();
  r.forceTier('flash');
  r.forceTier(null);
  const d = r.route({ userMessage: '重构架构' });
  assert.equal(d.tier, 'pro');
});

test('route: 无 flashModel 时回退 default', () => {
  const r = new ModelRouter({ defaultModel: 'gpt-4' });
  const d = r.route({ userMessage: '列出文件' });
  assert.equal(d.tier, 'flash');
  assert.equal(d.model, 'gpt-4'); // 回退到 default
});
