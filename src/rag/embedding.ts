/**
 * Embedding 层 —— 可插拔的向量生成。
 *
 * 两个实现：
 *   1. OpenAiCompatibleEmbedder：调用 OpenAI 兼容的 /v1/embeddings 端点
 *      （OpenAI / DeepSeek / 硅基流动 / DashScope 等）
 *   2. LocalHashEmbedder：零依赖兜底 —— 字符 n-gram 哈希特征 + L2 归一化。
 *      离线可用、中文友好，质量低于真实 embedding，用于演示与测试。
 */

export interface EmbeddingProvider {
  /** 批量生成文本向量。 */
  embed(texts: string[]): Promise<number[][]>;
  /** 向量维度。 */
  dim(): number;
  /** 是否为本地兜底实现。 */
  isLocal(): boolean;
}

/* ---------- OpenAI 兼容 API 实现 ---------- */

export interface ApiEmbedderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class OpenAiCompatibleEmbedder implements EmbeddingProvider {
  private dims = 0;

  constructor(private opts: ApiEmbedderOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ model: this.opts.model, input: texts }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`embedding API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      const data = (await resp.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      const vectors = data.data.map((d) => d.embedding);
      if (vectors.length > 0) this.dims = vectors[0].length;
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }

  dim(): number {
    return this.dims;
  }

  isLocal(): boolean {
    return false;
  }
}

/* ---------- 本地哈希兜底实现（零依赖） ---------- */

const LOCAL_DIM = 384;

function hashToken(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 字符 n-gram 切分（中文按单字，拉丁按词/子串）。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  // 中文字符与 CJK 符号按单字
  for (const ch of lower) {
    if (/[\u4e00-\u9fff]/.test(ch)) tokens.push(ch);
  }
  // 拉丁词
  const words = lower.match(/[a-z0-9_]+/g) ?? [];
  for (const w of words) tokens.push(w);
  // 二元组（近邻信息）—— 注意缓存长度，避免循环中数组增长导致指数膨胀
  const n = tokens.length;
  for (let i = 0; i < n - 1; i++) tokens.push(`${tokens[i]}_${tokens[i + 1]}`);
  return tokens;
}

export class LocalHashEmbedder implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Float64Array(LOCAL_DIM);
      const tokens = tokenize(text);
      for (const t of tokens) {
        const idx = hashToken(t) % LOCAL_DIM;
        vec[idx] += 1;
      }
      // L2 归一化
      let norm = 0;
      for (let i = 0; i < LOCAL_DIM; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < LOCAL_DIM; i++) vec[i] /= norm;
      return Array.from(vec);
    });
  }

  dim(): number {
    return LOCAL_DIM;
  }

  isLocal(): boolean {
    return true;
  }
}

/* ---------- 工厂 ---------- */

export interface EmbedderConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export function createEmbedder(cfg: EmbedderConfig = {}): EmbeddingProvider {
  if (cfg.baseUrl && cfg.apiKey && cfg.model) {
    return new OpenAiCompatibleEmbedder({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
    });
  }
  return new LocalHashEmbedder();
}

/* ---------- 相似度工具 ---------- */

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
