/**
 * Diff 生成 —— 简单统一 diff（逐行对比 old/new）。
 * 用于展示 AI 修改文件的变更（Claude Code 风格）。
 */
import path from 'node:path';

/** 生成统一 diff 格式。 */
export function generateDiff(oldText: string, newText: string, filePath = 'file'): string {
  if (oldText === newText) return '';

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  /* 简单 LCS 式逐行 diff（教学简化：找公共前缀和后缀） */
  let prefixLen = 0;
  while (prefixLen < oldLines.length && prefixLen < newLines.length && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const removed = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const added = newLines.slice(prefixLen, newLines.length - suffixLen);

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  const startLine = prefixLen + 1;
  lines.push(`@@ -${startLine},${removed.length} +${startLine},${added.length} @@`);
  for (const l of removed) lines.push('-' + l);
  for (const l of added) lines.push('+' + l);
  return lines.join('\n');
}

/** 从文件路径提取相对路径。 */
export function relPath(workdir: string, full: string): string {
  return path.relative(workdir, full).split(path.sep).join('/');
}
