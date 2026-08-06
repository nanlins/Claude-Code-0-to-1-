/**
 * 权限规则来源 —— 对齐真实 CC 的多来源规则合并（s03 深入）。
 *
 * CC 的规则来自 8 个来源，本实现支持前 3 个（教学可覆盖的核心）：
 *   1. user     ~/.claude/settings.json
 *   2. project  <workspace>/.claude/settings.json
 *   3. local    <workspace>/.claude/settings.local.json
 * 优先级（低 → 高）：user < project < local。
 * 高优先级来源覆盖低优先级。
 *
 * 规则格式（对齐 CC）：
 *   { "toolName": "Bash", "ruleBehavior": "deny" | "allow", "ruleContent": "pattern" }
 *   toolName 为工具名（如 Bash / Write / Read），ruleContent 为命令/路径包含匹配。
 */

import fs from 'node:fs';
import path from 'node:path';

export type RuleBehavior = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  toolName: string;
  ruleBehavior: RuleBehavior;
  ruleContent: string;
  source: 'user' | 'project' | 'local' | 'cliArg' | 'session';
}

export interface PermissionSettings {
  /** 工具级 allow/deny/ask 规则列表。 */
  rules: PermissionRule[];
  /** 工具级默认行为（如 "Bash": "allow"）。 */
  defaults: Record<string, RuleBehavior>;
  /** 额外：disabledTools（完全禁用）。 */
  disabledTools: string[];
}

export function loadPermissionSettings(
  workspaceDir: string,
  opts: {
    /** CLI 参数规则（--allowedTools / --deniedTools）。 */
    cliArgRules?: PermissionRule[];
    /** 会话内临时授权规则。 */
    sessionRules?: PermissionRule[];
  } = {},
): PermissionSettings {
  const sources: Array<{ source: PermissionRule['source']; file: string }> = [
    { source: 'user', file: path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.claude', 'settings.json') },
    { source: 'project', file: path.join(workspaceDir, '.claude', 'settings.json') },
    { source: 'local', file: path.join(workspaceDir, '.claude', 'settings.local.json') },
  ];

  const rules: PermissionRule[] = [];
  const defaults: Record<string, RuleBehavior> = {};
  const disabledTools = new Set<string>();

  for (const { source, file } of sources) {
    const parsed = parseSettingsFile(file);
    if (!parsed) continue;
    for (const [toolName, behavior] of Object.entries(parsed.permissions ?? {})) {
      defaults[toolName] = behavior;
    }
    for (const tool of parsed.disabledTools ?? []) {
      disabledTools.add(tool);
    }
    for (const [toolName, content] of Object.entries(parsed.denyRules ?? {})) {
      rules.push({ toolName, ruleBehavior: 'deny', ruleContent: String(content), source });
    }
    for (const [toolName, content] of Object.entries(parsed.askRules ?? {})) {
      rules.push({ toolName, ruleBehavior: 'ask', ruleContent: String(content), source });
    }
  }

  /* CLI 参数规则（优先级高于文件） */
  for (const r of opts.cliArgRules ?? []) {
    rules.push(r);
    if (r.ruleBehavior === 'deny') disabledTools.add(r.toolName);
  }

  /* 会话内临时授权（最高优先级） */
  for (const r of opts.sessionRules ?? []) {
    rules.push(r);
  }

  return { rules, defaults, disabledTools: [...disabledTools] };
}

function parseSettingsFile(file: string): {
  permissions?: Record<string, RuleBehavior>;
  disabledTools?: string[];
  denyRules?: Record<string, string | string[]>;
  askRules?: Record<string, string | string[]>;
} | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      permissions: raw.permissions as Record<string, RuleBehavior> | undefined,
      disabledTools: Array.isArray(raw.disabledTools) ? raw.disabledTools.map(String) : undefined,
      denyRules: raw.denyRules as Record<string, string | string[]> | undefined,
      askRules: raw.askRules as Record<string, string | string[]> | undefined,
    };
  } catch {
    return null; // 损坏忽略
  }
}

/** 检查规则列表：返回命中的行为（deny/ask）或 null。 */
export function matchRules(rules: PermissionRule[], toolName: string, argText: string): RuleBehavior | null {
  for (const r of rules) {
    if (r.toolName !== toolName) continue;
    if (argText.includes(r.ruleContent)) return r.ruleBehavior;
  }
  return null;
}

/** 工具名的宽松匹配（CC 的规则用工具显示名，如 Bash/Write/Read）。 */
export function toolNameKey(toolName: string): string {
  const map: Record<string, string> = {
    bash: 'Bash',
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    delete_file: 'Delete',
    glob: 'Glob',
    grep: 'Grep',
  };
  return map[toolName] ?? toolName;
}
