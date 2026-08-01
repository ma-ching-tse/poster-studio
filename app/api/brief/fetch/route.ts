import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE, STATE_COOKIE, LarkAuth,
  parseLarkUrl, authorizeUrl, refreshAuth, listSheetTabs, readTabValues,
  resolveWikiNode, readDocxGrid,
} from '@/lib/lark';
import { parseBriefTab } from '@/lib/brief-parse';

// 贴 Lark 链接（Sheets / Docs / Wiki）→ 拉取 → 归一化为 brief。
// 直连 Lark 开放平台（个人应用），OAuth user_access_token 存 httpOnly cookie；
// 未授权时返回 { needLogin, loginUrl }，前端开授权页并轮询本接口直到 cookie 就位。
// wiki 链接先解包成实际对象；表格一个标签 = 一期，文档整篇 = 一期。

const originOf = (req: NextRequest) => {
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};

function needLogin(req: NextRequest, domain: string) {
  const redirectUri = `${originOf(req)}/api/lark/callback`;
  const nonce = crypto.randomUUID();
  const res = NextResponse.json({ needLogin: true, loginUrl: authorizeUrl(domain, redirectUri, nonce) });
  res.cookies.set(STATE_COOKIE, JSON.stringify({ nonce, domain, redirectUri }), {
    httpOnly: true, sameSite: 'lax', secure: originOf(req).startsWith('https'), path: '/', maxAge: 600,
  });
  return res;
}

export async function POST(req: NextRequest) {
  if (!process.env.LARK_APP_ID || !process.env.LARK_APP_SECRET) {
    return NextResponse.json({ error: '服务端未配置 LARK_APP_ID / LARK_APP_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url : '';
  const link = parseLarkUrl(url);
  if (!link) {
    return NextResponse.json(
      { error: '仅支持 Lark 表格 / 文档 / Wiki 链接（…/sheets/、/docx/、/wiki/<token>）' },
      { status: 400 },
    );
  }

  // 取授权：cookie 里没有、域不符或刷新失败 → 走授权页
  let auth: LarkAuth | null = null;
  try {
    const raw = req.cookies.get(AUTH_COOKIE)?.value;
    if (raw) auth = JSON.parse(raw) as LarkAuth;
  } catch { auth = null; }
  if (!auth || auth.domain !== link.domain) return needLogin(req, link.domain);

  let refreshed = false;
  if (Date.now() >= auth.expiresAt) {
    try { auth = await refreshAuth(auth); refreshed = true; }
    catch { return needLogin(req, link.domain); }
  }

  try {
    // wiki 壳先解包成实际对象
    let kind: string = link.kind, token = link.token, wikiTitle = '';
    if (kind === 'wiki') {
      const node = await resolveWikiNode(auth, token);
      kind = node.objType; token = node.objToken; wikiTitle = node.title;
      if (kind !== 'sheet' && kind !== 'docx') {
        return NextResponse.json({ error: `这个 wiki 节点是 ${kind}，暂只支持表格和文档` }, { status: 422 });
      }
    }

    const briefs = [];
    if (kind === 'sheet') {
      for (const tab of await listSheetTabs(auth, token)) {
        const values = await readTabValues(auth, token, tab.sheet_id);
        const brief = parseBriefTab(values, tab.title);
        if (brief) briefs.push({ label: tab.title, brief });
      }
    } else {
      const grid = await readDocxGrid(auth, token);
      const label = wikiTitle || '文档提需';
      const brief = parseBriefTab(grid, label);
      if (brief) briefs.push({ label, brief });
    }
    if (!briefs.length) {
      return NextResponse.json(
        { error: '没有找到提需内容：需要包含 [meta] / [coins] / [langs] 区块标记（见提需表模板/示例文档）' },
        { status: 422 },
      );
    }
    const res = NextResponse.json({ briefs });
    if (refreshed) {
      res.cookies.set(AUTH_COOKIE, JSON.stringify(auth), {
        httpOnly: true, sameSite: 'lax', secure: originOf(req).startsWith('https'), path: '/',
        maxAge: 60 * 60 * 24 * 90,
      });
    }
    return res;
  } catch (err) {
    const code = (err as Error & { larkCode?: number }).larkCode;
    // token 失效/过期 → 重新授权；99991672/99991679 = token 缺权限（应用加了新
    // scope 后旧授权不带）→ 也重新授权，让用户按新 scope 重新同意
    if (code === 99991661 || code === 99991663 || code === 99991668 || code === 20005
      || code === 99991672 || code === 99991679) {
      return needLogin(req, link.domain);
    }
    if (code === 91403 || code === 1310213 || code === 1310249) {
      return NextResponse.json({ error: '你的 Lark 账号无权访问这个表格，先在 Lark 里确认能打开它' }, { status: 403 });
    }
    return NextResponse.json({ error: `拉取失败：${(err as Error).message}` }, { status: 502 });
  }
}
