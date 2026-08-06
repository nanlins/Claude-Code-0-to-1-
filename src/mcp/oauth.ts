/**
 * MCP OAuth 2.0 + PKCE —— 远程 MCP server 认证（对齐 CC 的 auth.ts）。
 *
 * 流程：
 *   1. 发现 OAuth 元数据（RFC 8414 / RFC 9728）
 *   2. 生成 PKCE code_verifier + code_challenge
 *   3. 本地回调服务器接收授权码
 *   4. 用授权码换取 access_token / refresh_token
 *   5. 令牌持久化到 .mcp/tokens.json（过期前自动刷新）
 *
 * 教学简化：不实现跨应用访问（XAA），令牌存明文 JSON（生产应加密）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

export interface OAuthConfig {
  /** OAuth authorization endpoint。 */
  authorizationEndpoint: string;
  /** OAuth token endpoint。 */
  tokenEndpoint: string;
  /** Client ID（公开客户端）。 */
  clientId: string;
  /** 回调端口（默认 19836）。 */
  callbackPort?: number;
  /** 请求的 scope。 */
  scope?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix ms
}

export interface OAuthDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

/** 发现 OAuth 元数据（RFC 8414）。 */
export async function discoverOAuth(serverUrl: string): Promise<OAuthDiscovery | null> {
  const base = new URL(serverUrl);
  const wellKnown = `${base.origin}/.well-known/oauth-authorization-server`;
  try {
    const resp = await fetch(wellKnown, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as OAuthDiscovery;
    if (data.authorization_endpoint && data.token_endpoint) return data;
    return null;
  } catch {
    return null;
  }
}

/** 生成 PKCE code_verifier 和 code_challenge。 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** 执行完整 OAuth 授权流程（打开浏览器 → 等待回调 → 换取令牌）。 */
export async function authorize(config: OAuthConfig): Promise<OAuthTokens> {
  const { verifier, challenge } = generatePkce();
  const port = config.callbackPort ?? 19836;
  const redirectUri = `http://localhost:${port}/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  /* 启动本地回调服务器 */
  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch');
        reject(new Error('OAuth state mismatch'));
        server.close();
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end('No code');
        reject(new Error('OAuth no authorization code'));
        server.close();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>授权成功</h1><p>可以关闭此页面。</p>');
      resolve(code);
      server.close();
    });
    server.listen(port, () => {
      /* 打开浏览器 */
      const authUrl = new URL(config.authorizationEndpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      if (config.scope) authUrl.searchParams.set('scope', config.scope);
      const openUrl = authUrl.toString();
      console.error(`[oauth] 请在浏览器中打开以下链接完成授权:\n${openUrl}`);
      /* 尝试自动打开浏览器 */
      import('node:child_process').then(({ exec }) => {
        const cmd = process.platform === 'win32' ? `start "" "${openUrl}"` : `open "${openUrl}"`;
        exec(cmd, () => {});
      });
    });
    /* 超时 120s */
    setTimeout(() => {
      reject(new Error('OAuth authorization timeout (120s)'));
      server.close();
    }, 120_000);
  });

  const code = await codePromise;

  /* 用授权码换取令牌 */
  const tokenResp = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResp.ok) {
    throw new Error(`OAuth token exchange failed: ${tokenResp.status} ${await tokenResp.text()}`);
  }
  const tokenData = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
  };
}

/** 刷新令牌。 */
export async function refreshTokens(config: OAuthConfig, tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error('No refresh token available');
  const resp = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`OAuth refresh failed: ${resp.status}`);
  const data = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

/* ---------- 令牌持久化 ---------- */

export class TokenStore {
  private file: string;

  constructor(persistDir: string) {
    fs.mkdirSync(persistDir, { recursive: true });
    this.file = path.join(persistDir, 'tokens.json');
  }

  load(serverName: string): OAuthTokens | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const all = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, OAuthTokens>;
      return all[serverName] ?? null;
    } catch {
      return null;
    }
  }

  save(serverName: string, tokens: OAuthTokens): void {
    let all: Record<string, OAuthTokens> = {};
    if (fs.existsSync(this.file)) {
      try {
        all = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch {
        /* 损坏则重建 */
      }
    }
    all[serverName] = tokens;
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), 'utf8');
  }

  /** 获取有效令牌（过期前 5 分钟自动刷新）。 */
  async getValidToken(serverName: string, config: OAuthConfig): Promise<string | null> {
    const tokens = this.load(serverName);
    if (!tokens) return null;
    if (Date.now() < tokens.expiresAt - 5 * 60 * 1000) return tokens.accessToken;
    /* 过期 → 刷新 */
    try {
      const refreshed = await refreshTokens(config, tokens);
      this.save(serverName, refreshed);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }
}
