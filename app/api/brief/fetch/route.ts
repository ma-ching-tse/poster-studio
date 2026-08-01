import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE, STATE_COOKIE, LarkAuth,
  parseSheetUrl, authorizeUrl, refreshAuth, listSheetTabs, readTabValues,
} from '@/lib/lark';
import { parseBriefTab } from '@/lib/brief-parse';

// 贴 Lark Sheets 链接 → 拉表 → 归一化为 brief。
// 直连 Lark 开放平台（个人应用），OAuth user_access_token 存 httpOnly cookie；
// 未授权时返回 { needLogin, loginUrl }，前端开授权页并轮询本接口直到 cookie 就位。
// 一个工作表标签 = 一期，多期时返回多个 briefs 由前端出期数选择。

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
  const sheet = parseSheetUrl(url);
  if (!sheet) {
    return NextResponse.json({ error: '仅支持 Lark Sheets 链接（…/sheets/<token>）' }, { status: 400 });
  }

  // 取授权：cookie 里没有、域不符或刷新失败 → 走授权页
  let auth: LarkAuth | null = null;
  try {
    const raw = req.cookies.get(AUTH_COOKIE)?.value;
    if (raw) auth = JSON.parse(raw) as LarkAuth;
  } catch { auth = null; }
  if (!auth || auth.domain !== sheet.domain) return needLogin(req, sheet.domain);

  let refreshed = false;
  if (Date.now() >= auth.expiresAt) {
    try { auth = await refreshAuth(auth); refreshed = true; }
    catch { return needLogin(req, sheet.domain); }
  }

  try {
    const tabs = await listSheetTabs(auth, sheet.token);
    const briefs = [];
    for (const tab of tabs) {
      const values = await readTabValues(auth, sheet.token, tab.sheet_id);
      const brief = parseBriefTab(values, tab.title);
      if (brief) briefs.push({ label: tab.title, brief });
    }
    if (!briefs.length) {
      return NextResponse.json(
        { error: '表里没有找到提需页：需要包含 [meta] / [coins] / [langs] 区块标记（见提需表模板）' },
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
    // token 失效类错误 → 重新授权；无权访问 / 文档不存在给明确提示
    if (code === 99991661 || code === 99991663 || code === 99991668 || code === 20005) {
      return needLogin(req, sheet.domain);
    }
    if (code === 91403 || code === 1310213 || code === 1310249) {
      return NextResponse.json({ error: '你的 Lark 账号无权访问这个表格，先在 Lark 里确认能打开它' }, { status: 403 });
    }
    return NextResponse.json({ error: `拉取失败：${(err as Error).message}` }, { status: 502 });
  }
}
