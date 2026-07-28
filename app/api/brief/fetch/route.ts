import { NextResponse } from 'next/server';

// 原版通过服务端 lark-cli 拉取 Lark Sheets 并归一化为 brief。
// 该服务端实现未能从部署恢复；贴链接暂不可用，请用「粘贴 JSON」导入。
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url : '';
  if (!/^https?:\/\/[^/]+\/.*sheets\//.test(url)) {
    return NextResponse.json({ error: '仅支持 Lark Sheets 链接（…/sheets/<token>）' }, { status: 400 });
  }
  return NextResponse.json(
    { error: 'Lark 拉取功能未随源码恢复，请在 Lark 中导出数据后改用粘贴 JSON 导入' },
    { status: 501 }
  );
}
