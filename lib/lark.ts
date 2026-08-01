// Lark 开放平台 API 封装（个人应用直连版，替代原公司内网 lark-cli）。
// 域自适应：按用户贴的表格链接判断 feishu.cn / larksuite.com，两边 API 同构。
// 授权走 OAuth user_access_token（贴链接的人授权自己的号），token 存 httpOnly cookie，
// 服务端无状态，本地与 Vercel 通用。

export const AUTH_COOKIE = 'lark_auth';
export const STATE_COOKIE = 'lark_oauth_state';

// 「贴链接拉取」所需的用户权限；应用后台需开通同名用户身份权限
export const OAUTH_SCOPES =
  'sheets:spreadsheet:readonly drive:drive:readonly wiki:wiki:readonly docx:document:readonly offline_access';

export interface LarkAuth {
  domain: string;        // API 域，如 open.feishu.cn / open.larksuite.com
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;     // access_token 过期时刻（epoch ms）
}

// Lark 链接 → { apiDomain, kind, token }。支持表格 /sheets/、文档 /docx/、
// wiki 壳 /wiki/（节点里包的实际是表格或文档，拉取时再解包）。不认识返回 null。
export type LarkLinkKind = 'sheet' | 'docx' | 'wiki';

export function parseLarkUrl(url: string): { domain: string; kind: LarkLinkKind; token: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const m = u.pathname.match(/\/(sheets|docx|wiki)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const host = u.hostname;
  let domain: string | null = null;
  if (/(^|\.)feishu\.cn$/.test(host)) domain = 'open.feishu.cn';
  else if (/(^|\.)larksuite\.com$/.test(host)) domain = 'open.larksuite.com';
  if (!domain) return null;
  const kind: LarkLinkKind = m[1] === 'sheets' ? 'sheet' : (m[1] as LarkLinkKind);
  return { domain, kind, token: m[2] };
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

// wiki 节点 → 实际对象（sheet / docx / …）
export async function resolveWikiNode(
  auth: LarkAuth, nodeToken: string,
): Promise<{ objType: string; objToken: string; title: string }> {
  const data = await larkGet<{ node: { obj_type: string; obj_token: string; title: string } }>(
    auth, `/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}&obj_type=wiki`);
  return { objType: data.node.obj_type, objToken: data.node.obj_token, title: data.node.title };
}

export interface SheetTab { sheet_id: string; title: string; hidden?: boolean }

export async function listSheetTabs(auth: LarkAuth, spreadsheetToken: string): Promise<SheetTab[]> {
  const data = await larkGet<{ sheets: SheetTab[] }>(
    auth, `/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`);
  return (data.sheets || []).filter((s) => !s.hidden);
}

// —— 文档（docx）→ 值网格 ——
// 把文档按阅读顺序摊平成与表格同构的 values 网格：文本/标题行 → 单元素行，
// 表格 → 行数组，空行跳过（文档里的空段落不承担「区块结束」语义，区块以下一个
// 标记行收尾）。这样 [meta]/[coins]/[langs] 的解析器对表格和文档完全复用。

interface DocxBlock {
  block_id: string;
  block_type: number;
  children?: string[];
  table?: { cells?: string[]; property?: { row_size: number; column_size: number } };
  image?: { token?: string };
  [key: string]: unknown;
}

// 嵌入图片在网格里的占位形式；解析出 token 后可经 drive media 接口下载成 data URL
export const IMG_MARK = /^\[\[img:([A-Za-z0-9_-]+)\]\]$/;
const imgMark = (token: string) => `[[img:${token}]]`;

// 各种文本类 block（text/heading1..9/bullet/ordered/quote/todo…）的内容都长这样：
// { elements: [{ text_run: { content } }, …] }，逐个属性探测比枚举类型编号稳
function blockText(block: DocxBlock): string | null {
  for (const v of Object.values(block)) {
    if (v && typeof v === 'object' && Array.isArray((v as { elements?: unknown[] }).elements)) {
      const els = (v as { elements: { text_run?: { content?: string } }[] }).elements;
      return els.map((e) => e.text_run?.content ?? '').join('');
    }
  }
  return null;
}

export async function readDocxGrid(auth: LarkAuth, docId: string): Promise<unknown[][]> {
  const blocks: DocxBlock[] = [];
  let pageToken = '';
  do {
    const data = await larkGet<{ items: DocxBlock[]; page_token?: string; has_more?: boolean }>(
      auth,
      `/open-apis/docx/v1/documents/${docId}/blocks?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`,
    );
    blocks.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token || '' : '';
  } while (pageToken);

  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  // 块 → 内容：文本块取文字，图片块（27）给 [[img:token]] 占位
  const blockContent = (b: DocxBlock | undefined): string | null => {
    if (!b) return null;
    if (b.block_type === 27 && b.image?.token) return imgMark(b.image.token);
    return blockText(b);
  };
  const cellText = (cellId: string): string =>
    (byId.get(cellId)?.children || [])
      .map((id) => blockContent(byId.get(id)) ?? '')
      .join('\n').trim();

  const grid: unknown[][] = [];
  const walk = (id: string) => {
    const b = byId.get(id);
    if (!b) return;
    if (b.block_type === 31 && b.table?.cells && b.table.property) {
      const { column_size: cols } = b.table.property;
      for (let i = 0; i < b.table.cells.length; i += cols) {
        grid.push(b.table.cells.slice(i, i + cols).map(cellText));
      }
      return; // 表格子块已消费，不再下钻
    }
    const content = blockContent(b);
    if (content !== null && content.trim() !== '') grid.push([content.trim()]);
    for (const child of b.children || []) walk(child);
  };
  // 根块 = 文档本身（block_id 与文档 id 同）；兜底取第一个 page 块
  const root = byId.get(docId) || blocks.find((b) => b.block_type === 1);
  if (root) for (const child of root.children || []) walk(child);
  return grid;
}

// 文档嵌入图片 → data URL（币种图标很小，直接内联进 brief）
export async function downloadMediaDataUrl(auth: LarkAuth, fileToken: string): Promise<string> {
  const res = await fetch(`https://${auth.domain}/open-apis/drive/v1/medias/${fileToken}/download`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  const ct = (res.headers.get('content-type') || '').split(';')[0];
  if (ct === 'application/json') {
    const data = await res.json().catch(() => ({}));
    throw new Error(`下载图片失败（code ${data.code ?? res.status}）：${data.msg ?? '未知错误'}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${ct || 'image/png'};base64,${buf.toString('base64')}`;
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
