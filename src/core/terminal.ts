/**
 * 终端 UI —— ANSI 颜色工具 + 像素机器人吉祥物 + 格式化。
 * 深色青蓝色主题（Claude Code 风格）。
 */

/* ---------- ANSI 颜色 ---------- */

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // 前景色
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // 青蓝色主题
  teal: '\x1b[38;5;44m',      // 青蓝
  aqua: '\x1b[38;5;80m',      // 亮青
  cyanDim: '\x1b[38;5;37m',   // 暗青
  gray: '\x1b[38;5;245m',
  darkGray: '\x1b[38;5;240m',
  orange: '\x1b[38;5;215m',
  pink: '\x1b[38;5;211m',
  purple: '\x1b[38;5;141m',
  // 背景
  bgDark: '\x1b[48;5;235m',   // 深色背景
  bgTeal: '\x1b[48;5;44m',
  bgGray: '\x1b[48;5;240m',
  bgRed: '\x1b[48;5;124m',
  // 控制
  clear: '\x1b[2J\x1b[H',
  clearLine: '\x1b[2K',
  savePos: '\x1b[s',
  restorePos: '\x1b[u',
  showCursor: '\x1b[?25h',
  hideCursor: '\x1b[?25l',
};

/** 上移 n 行。 */
export function up(n: number): string {
  return `\x1b[${n}A`;
}
/** 清空 n 行。 */
export function clearLines(n: number): string {
  return `\x1b[${n}A\x1b[${n}J`;
}

/* ---------- 像素锤子吉祥物（愤怒锤头 + 无辜笑脸，反差萌） ---------- */

/* 背景：深灰黑（磨砂）；前景：亮黄（8-bit 像素风）。 */
const BG = '\x1b[48;5;233m';
const YELLOW = '\x1b[38;5;226m';

/** 20 行 × 30 列。空格=深背景，其他字符=亮黄图案。
 *  锤头(上8行)：骂人气泡 [ # # *，星号冲出右上；
 *  手柄(中6行)：45°斜右下断续短块；
 *  脸(下5行)：o o 无辜眼睛 + ‿ 微笑 + 小圆点。 */
export const ROBOT_ART = [
  '            ##########            ',
  '         #####      #####         ',
  '       ####              ####     ',
  '      [####  #      #      ####*  ',
  '    ####     #      #       ####  ',
  '   ####              ####         ',
  '   ####            ####           ',
  '    #######     ####              ',
  '      ############                ',
  '            ##                    ',
  '             ##                   ',
  '              ##                  ',
  '               ##                 ',
  '                ##                ',
  '                 ##               ',
  '                  ##              ',
  '                   ##             ',
  '                    o   o         ',
  '                       ‿          ',
  '                        .         ',
];

/** 渲染像素锤子：空格=深背景块，图案字符=亮黄。 */
export function renderRobot(): string[] {
  return ROBOT_ART.map((row) => {
    let out = BG;
    for (const ch of row) {
      if (ch === ' ') out += ' ';
      else out += YELLOW + ch + BG;
    }
    return out + C.reset;
  });
}

/**
 * 渲染启动横幅：机器人在左，信息在右（并排）。
 * 返回可直接打印的行数组。
 */
export function renderBanner(opts: { model: string; mode: string; workdir: string; version: string; mock: boolean }): string[] {
  const art = renderRobot();
  const info: Array<[string, string]> = [
    ['NAME', C.aqua + C.bold + ' 小锤 Anvil' + C.reset + ' ' + C.dim + opts.version + C.reset],
    ['MODEL', C.white + opts.model + (opts.mock ? C.yellow + ' (MOCK)' + C.reset : C.reset)],
    ['MODE', C.teal + opts.mode + C.reset],
    ['WORKDIR', C.dim + opts.workdir + C.reset],
  ];

  const infoRows = info.map(([k, v]) => {
    return '  ' + C.dim + k.padEnd(8) + C.reset + v;
  });

  /* 机器人 9 行，信息 4 行，中间留白对齐 */
  const lines: string[] = [];
  const artWidth = 15;
  for (let i = 0; i < 9; i++) {
    const artRow = art[i] ?? '';
    const infoRow = infoRows[i] ?? '';
    lines.push(artRow.padEnd(artWidth) + infoRow);
  }
  return lines;
}

/* ---------- 分隔线 ---------- */

export function divider(title?: string, width = 60): string {
  if (!title) return C.darkGray + '─'.repeat(width) + C.reset;
  const side = Math.max(1, Math.floor((width - title.length - 2) / 2));
  return C.darkGray + '─'.repeat(side) + ' ' + C.teal + title + C.reset + C.darkGray + ' ' + '─'.repeat(width - side - title.length - 2) + C.reset;
}

/* ---------- 标签 ---------- */

export function badge(text: string, color = C.teal): string {
  return C.bgDark + ' ' + color + C.bold + text + C.reset + C.bgDark + ' ' + C.reset;
}

export function toolLabel(name: string): string {
  return C.cyan + C.bold + name + C.reset;
}

export function cmdLabel(cmd: string): string {
  return C.yellow + cmd + C.reset;
}

export function fileLabel(path: string): string {
  return C.green + C.underline + path + C.reset;
}

export function errorLabel(msg: string): string {
  return C.red + C.bold + msg + C.reset;
}

/* ---------- diff 渲染 ---------- */

/** 渲染统一 diff（+ 绿 / - 红 / @@ 青）。 */
export function renderDiff(diffText: string): string[] {
  return diffText.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return C.teal + line + C.reset;
    }
    if (line.startsWith('+')) return C.green + line + C.reset;
    if (line.startsWith('-')) return C.red + line + C.reset;
    return C.gray + line + C.reset;
  });
}
