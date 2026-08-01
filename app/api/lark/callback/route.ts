import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, STATE_COOKIE, exchangeCode } from '@/lib/lark';

// Lark OAuth 回调：code 换 user_access_token 存 httpOnly cookie。
// 控制台页签在轮询 /api/brief/fetch，cookie 就位后那边自动继续，本页只负责提示关闭。

const page = (title: string, detail: string) => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<body style="font:15px/1.7 system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color:#222">
<div style="text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#666">${detail}</p></div>`;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  let saved: { nonce: string; domain: string; redirectUri: string } | null = null;
  try {
    const raw = req.cookies.get(STATE_COOKIE)?.value;
    if (raw) saved = JSON.parse(raw);
  } catch { saved = null; }

  if (!code || !saved || saved.nonce !== state) {
    return new NextResponse(page('授权校验失败', '请回到 Poster Studio 重新点「解析」发起授权'), {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const auth = await exchangeCode(saved.domain, code, saved.redirectUri);
    const res = new NextResponse(page('授权成功 ✓', '回到 Poster Studio 页签，导入会自动继续；本页可以关闭了'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    res.cookies.set(AUTH_COOKIE, JSON.stringify(auth), {
      httpOnly: true, sameSite: 'lax', secure: saved.redirectUri.startsWith('https'), path: '/',
      maxAge: 60 * 60 * 24 * 90,
    });
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return new NextResponse(page('授权失败', (err as Error).message), {
      status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
