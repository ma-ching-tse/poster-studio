// Lark 开放平台 API 封装（个人应用直连版，替代原公司内网 lark-cli）。
// 域自适应：按用户贴的表格链接判断 feishu.cn / larksuite.com，两边 API 同构。
// 授权走 OAuth user_access_token（贴链接的人授权自己的号），token 存 httpOnly cookie，
// 服务端无状态，本地与 Vercel 通用。

export const AUTH_COOKIE = 'lark_auth';
export const STATE_COOKIE = 'lark_oauth_state';

// 「贴链接拉取」所需的用户权限；应用后台需开通同名用户身份权限
export const OAUTH_SCOPES = 'sheets:spreadsheet:readonly drive:drive:readonly offline_access';

export interface LarkAuth {
  domain: string;        // API 域，如 open.feishu.cn / open.larksuite.com
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;     // access_token 过期时刻（epoch ms）
}

// 表格链接 → { apiDomain, spreadsheetToken }；不认识的链接返回 null
export function parseSheetUrl(url: string): { domain: string; token: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const m = u.pathname.match(/\/sheets\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const host = u.hostname;
  let domain: string | null = null;
  if (/(^|\.)feishu\.cn$/.test(host)) domain = 'open.feishu.cn';
  else if (/(^|\.)larksuite\.com$/.test(host)) domain = 'open.larksuite.com';
  if (!domain) return null;
  return { domain, token: m[1] };
}

export function authorizeUrl(domain: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    app_id: process.env.LARK_APP_ID || '',
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    state,
  });
  return `https://${domain}/open-apis/authen/v1/authorize?${q}`;
}

interface OAuthTokenResp {
  code: number;
  error_description?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function oauthToken(domain: string, body: Record<string, string>): Promise<LarkAuth> {
  const res = await fetch(`https://${domain}/open-apis/authen/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.LARK_APP_ID,
      client_secret: process.env.LARK_APP_SECRET,
      ...body,
    }),
  });
  const data = (await res.json()) as OAuthTokenResp;
  if (data.code !== 0 || !data.access_token) {
    throw new Error(`Lark OAuth 失败（code ${data.code}）：${data.error_description || '未知错误'}`);
  }
  return {
    domain,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + ((data.expires_in ?? 7200) - 60) * 1000,
  };
}

export function exchangeCode(domain: string, code: string, redirectUri: string): Promise<LarkAuth> {
  return oauthToken(domain, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refreshAuth(auth: LarkAuth): Promise<LarkAuth> {
  if (!auth.refreshToken) throw new Error('没有 refresh_token，需要重新授权');
  return oauthToken(auth.domain, { grant_type: 'refresh_token', refresh_token: auth.refreshToken });
}

// 带用户 token 调 Lark API；业务错误统一抛 Error（code 携带在 message 里）
export async function larkGet<T>(auth: LarkAuth, path: string): Promise<T> {
  const res = await fetch(`https://${auth.domain}${path}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  const data = await res.json();
  if (data.code !== 0) {
    const err = new Error(`Lark API ${path} 失败（code ${data.code}）：${data.msg}`);
    (err as Error & { larkCode?: number }).larkCode = data.code;
    throw err;
  }
  return data.data as T;
}

export interface SheetTab { sheet_id: string; title: string; hidden?: boolean }

export async function listSheetTabs(auth: LarkAuth, spreadsheetToken: string): Promise<SheetTab[]> {
  const data = await larkGet<{ sheets: SheetTab[] }>(
    auth, `/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`);
  return (data.sheets || []).filter((s) => !s.hidden);
}

export async function readTabValues(
  auth: LarkAuth, spreadsheetToken: string, sheetId: string,
): Promise<unknown[][]> {
  const range = encodeURIComponent(`${sheetId}!A1:Z300`);
  const data = await larkGet<{ valueRange: { values: unknown[][] } }>(
    auth,
    `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${range}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`,
  );
  return data.valueRange?.values || [];
}
