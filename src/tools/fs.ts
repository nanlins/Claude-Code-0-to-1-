/**
 * 文件工具集 —— 全部走 safePath 强约束（比教学版更重投入的安全第一）。
 * glob / grep 用原生 JS 实现（不依赖 shell 的 ls/rg），Windows 下行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isInside } from '../core/permission.js';
import { FILE_UNCHANGED_STUB } from '../core/readFileState.js';
import type { ToolContext, ToolDef } from '../types.js';

export function safePath(workdir: string, p: string): string {
  const resolved = path.resolve(workdir, p);
  if (!isInside(workdir, resolved)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

const readSchema = z.object({
  path: z.string().min(1, 'path is required'),
  limit: z.number().int().positive().optional(),
});

const writeSchema = z.object({
  path: z.string().min(1, 'path is required'),
  content: z.string(),
});

const editSchema = z.object({
  path: z.string().min(1, 'path is required'),
  old_text: z.string().min(1, 'old_text is required'),
  new_text: z.string(),
});

const deleteSchema = z.object({
  path: z.string().min(1, 'path is required'),
});

const listSchema = z.object({
  path: z.string().optional(),
});

const globSchema = z.object({
  pattern: z.string().min(1, 'pattern is required'),
});

const grepSchema = z.object({
  pattern: z.string().min(1, 'pattern is required'),
  path: z.string().optional(),
  literal: z.boolean().optional(),
  caseInsensitive: z.boolean().optional(),
});

/* ---------- read / write / edit / delete ---------- */

async function execRead(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const p = safePath(ctx.workdir, String(args.path ?? ''));
  const limit = typeof args.limit === 'number' ? args.limit : undefined;

  if (ctx.readFileState && ctx.readFileState.isUnchanged(p)) {
    return FILE_UNCHANGED_STUB;
  }

  const raw = await fs.promises.readFile(p, 'utf8');
  ctx.readFileState?.markRead(p);
  const lines = raw.split(/\r?\n/);
  if (limit !== undefined && limit < lines.length) {
    return lines.slice(0, limit).join('\n') + `\n... (${lines.length - limit} more lines)`;
  }
  return raw;
}

async function execWrite(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const p = safePath(ctx.workdir, String(args.path ?? ''));
  const content = String(args.content ?? '');
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${args.path}`;
}

async function execEdit(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const p = safePath(ctx.workdir, String(args.path ?? ''));
  const oldText = String(args.old_text ?? '');
  const newText = String(args.new_text ?? '');
  const original = await fs.promises.readFile(p, 'utf8');
  const idx = original.indexOf(oldText);
  if (idx < 0) return `Error: old_text not found in ${args.path}`;
  const updated = original.slice(0, idx) + newText + original.slice(idx + oldText.length);
  await fs.promises.writeFile(p, updated, 'utf8');
  return `Edited ${args.path}: replaced 1 occurrence`;
}

async function execDelete(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const p = safePath(ctx.workdir, String(args.path ?? ''));
  if (!fs.existsSync(p)) return `Error: not found: ${args.path}`;
  await fs.promises.unlink(p);
  return `Deleted ${args.path}`;
}

async function execList(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const p = safePath(ctx.workdir, String(args.path ?? '.'));
  const entries = await fs.promises.readdir(p, { withFileTypes: true });
  const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.sort().join('\n') || '(empty)';
}

/* ---------- glob / grep（原生实现） ---------- */

function globToRegExp(pattern: string): RegExp {
  const p = pattern
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/\\\\]')
    .replace(/\./g, '\\.');
  return new RegExp(`^${p}$`);
}

async function walk(dir: string, base: string, visit: (rel: string, full: string) => void | Promise<void>, depth = 0): Promise<void> {
  if (depth > 14) return;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.tasks' || e.name === '.team') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      await walk(full, base, visit, depth + 1);
    } else {
      await visit(rel, full);
    }
  }
}

async function execGlob(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const pattern = String(args.pattern ?? '');
  if (!pattern) return 'Error: pattern required';
  const matcher = globToRegExp(pattern);
  const hits: string[] = [];
  await walk(ctx.workdir, ctx.workdir, (rel) => {
    if (matcher.test(rel)) hits.push(rel);
  });
  return hits.length ? hits.slice(0, 500).join('\n') : '（无匹配）';
}

async function execGrep(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const pattern = String(args.pattern ?? '');
  const startPath = String(args.path ?? '.');
  const literal = args.literal === true;
  const caseInsensitive = args.caseInsensitive === true;
  if (!pattern) return 'Error: pattern required';
  const rx = literal ? null : new RegExp(pattern, caseInsensitive ? 'i' : '');
  const needle = literal ? pattern.toLowerCase() : '';
  const startFull = safePath(ctx.workdir, startPath);
  const isFile = fs.existsSync(startFull) && fs.statSync(startFull).isFile();
  const hits: string[] = [];

  const testFile = async (full: string, rel: string) => {
    let raw: string;
    try {
      raw = await fs.promises.readFile(full, 'utf8');
    } catch {
      return;
    }
    if (raw.includes('\u0000')) return; // binary
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = rx ? rx.test(line) : line.toLowerCase().includes(needle);
      if (match) {
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
        if (hits.length >= 200) break;
      }
    }
  };

  if (isFile) {
    await testFile(startFull, startPath);
  } else {
    await walk(startFull, startFull, (rel, full) => testFile(full, rel));
  }
  return hits.length ? hits.join('\n') : '（无匹配）';
}

/* ---------- 注册 ---------- */

export function fsTools(): ToolDef[] {
  return [
    {
      schema: {
        name: 'read_file',
        description: '从工作区读取文件（可选行数限制）。',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区的路径' },
            limit: { type: 'integer', description: '最多读取的行数' },
          },
          required: ['path'],
        },
      },
      validator: readSchema,
      executor: execRead,
      concurrencySafe: true,
      maxResultSizeChars: Number.POSITIVE_INFINITY,
    },
    {
      schema: {
        name: 'write_file',
        description: '把内容写入文件（自动创建所需目录）。',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区的路径' },
            content: { type: 'string', description: '要写入的内容' },
          },
          required: ['path', 'content'],
        },
      },
      validator: writeSchema,
      executor: execWrite,
    },
    {
      schema: {
        name: 'edit_file',
        description: '在文件中把一处 old_text 替换为 new_text。',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_text: { type: 'string' },
            new_text: { type: 'string' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      validator: editSchema,
      executor: execEdit,
    },
    {
      schema: {
        name: 'delete_file',
        description: '从工作区删除一个文件（需要审批）。',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      validator: deleteSchema,
      executor: execDelete,
    },
    {
      schema: {
        name: 'list_files',
        description: '列出目录中的条目。',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', default: '.' } },
        },
      },
      validator: listSchema,
      executor: execList,
      concurrencySafe: true,
    },
    {
      schema: {
        name: 'glob',
        description: '按 glob 模式查找文件（支持 * ? **）。',
        input_schema: {
          type: 'object',
          properties: { pattern: { type: 'string', description: '例如 src/**/*.ts' } },
          required: ['pattern'],
        },
      },
      validator: globSchema,
      executor: execGlob,
      concurrencySafe: true,
    },
    {
      schema: {
        name: 'grep',
        description: '在文件中搜索文本（正则或字面量）。',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', default: '.', description: '文件或目录' },
            literal: { type: 'boolean', default: false },
            caseInsensitive: { type: 'boolean', default: false },
          },
          required: ['pattern'],
        },
      },
      validator: grepSchema,
      executor: execGrep,
      concurrencySafe: true,
    },
  ];
}