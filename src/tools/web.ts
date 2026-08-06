/**
 * Web 工具 —— web_search（联网搜索）+ web_extractor（网页抓取）。
 *
 * web_search：DuckDuckGo HTML 接口（免费、无需 API key），返回标题+链接+摘要。
 * web_extractor：fetch 指定 URL，HTML 转纯文本（去 script/style/标签），限制大小与超时。
 *
 * 安全：
 *   - 只允许 http/https 协议（防 file:// 等本地文件读取）
 *   - 输出大小上限（默认 8K 字符），防打满上下文
 *   - 抓取结果属于"外部内容"，由 security.ts 的注入扫描兜底
 */
import type { ToolContext, ToolDef } from '../types.js';

const MAX_TEXT = 8_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}
/* ---------- web_search（Bing HTML 接口，国内可访问） ---------- */

export async function webSearch(query: string, maxResults = 5): Promise<string> {
  if (!query.trim()) return '（无效查询）';
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-hans`;
  const html = await fetchText(url);
  const results = parseBingResults(html, maxResults);
  if (results.length === 0) return '未找到搜索结果（或接口暂不可用）。';
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n');
}

function parseBingResults(html: string, max: number): WebSearchResult[] {
  const out: WebSearchResult[] = [];
  // Bing 结果结构：<li class="b_algo"> 包含 <h2><a href="...">title</a></h2> 与 <p>snippet</p>
  const blocks = html.split(/<li class="b_algo"/g).slice(1);
  for (const block of blocks) {
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({
      title: stripTags(linkMatch[2]).trim().slice(0, 120),
      url: linkMatch[1],
      snippet: snippetMatch ? stripTags(snippetMatch[1]).trim().slice(0, 300) : '',
    });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------- web_extractor ---------- */

export async function webExtractor(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return '（仅支持 http/https 链接）';
  }
  const html = await fetchText(trimmed);
  const text = htmlToText(html);
  if (!text.trim()) return '（未能从该页面提取到文本内容）';
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n...[内容过长已截断]' : text;
}

/* ---------- 内部工具 ---------- */

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) anvil-agent/0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return '';
    const buf = await resp.arrayBuffer();
    // 优先按响应编码解码，否则 UTF-8
    let text = '';
    try {
      text = new TextDecoder().decode(buf);
    } catch {
      text = new TextDecoder('utf-8').decode(buf);
    }
    return text.slice(0, 2_000_000);
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** 导出供测试。 */
export function parseBingResultsForTest(html: string, max: number): WebSearchResult[] {
  return parseBingResults(html, max);
}

/** 导出供测试。 */
export function htmlToTextForTest(html: string): string {
  return htmlToText(html);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* ---------- 工具注册 ---------- */

export function webTools(): ToolDef[] {
  return [
    {
      schema: {
        name: 'web_search',
        description: '联网搜索（DuckDuckGo，免费）。返回标题+链接+摘要。适合查询实时信息、最新新闻、训练数据截止后的知识。',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'integer', description: '返回条数（默认 5）', default: 5 },
          },
          required: ['query'],
        },
      },
      executor: async (args: Record<string, unknown>): Promise<string> => {
        const query = String(args.query ?? '');
        const max = typeof args.max_results === 'number' ? args.max_results : 5;
        try {
          return await webSearch(query, max);
        } catch (err) {
          return `搜索失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      concurrencySafe: true,
    },
    {
      schema: {
        name: 'web_extractor',
        description: '抓取指定 URL 的网页内容并转为文本（仅 http/https）。适合阅读文章全文、产品参数等。',
        input_schema: {
          type: 'object',
          properties: { url: { type: 'string', description: '要抓取的完整 URL' } },
          required: ['url'],
        },
      },
      executor: async (args: Record<string, unknown>): Promise<string> => {
        const url = String(args.url ?? '');
        try {
          return await webExtractor(url);
        } catch (err) {
          return `抓取失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      concurrencySafe: true,
    },
  ];
}
