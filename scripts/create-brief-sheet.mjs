// 一次性脚本：用应用身份（tenant_access_token）创建「Poster Studio 提需表」，
// 写入使用说明页 + 一个可复制的示例期，并开租户内链接可编辑。
// 需要应用后台已开通应用身份权限：sheets:spreadsheet + drive:drive。
// 用法：node scripts/create-brief-sheet.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const APP_ID = env.LARK_APP_ID, APP_SECRET = env.LARK_APP_SECRET;
if (!APP_ID || !APP_SECRET) throw new Error('.env.local 缺 LARK_APP_ID / LARK_APP_SECRET');

async function api(domain, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`https://${domain}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`${path} → code ${data.code}: ${data.msg}`);
  return data.data;
}

// tenant_access_token/internal 的返回不在 data 里，单独取
async function getToken(domain) {
  const res = await fetch(`https://${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`取 token 失败 code ${data.code}: ${data.msg}`);
  return data.tenant_access_token;
}

const GUIDE = [
  ['Poster Studio 提需表 · 使用说明'],
  [''],
  ['一个工作表标签 = 一期海报提需；标签名会显示为期数选项，建议用日期命名，如「0814 股票专区」。'],
  ['新增一期：右键复制「示例期」标签 → 改内容即可。本说明页不含 [langs] 标记，导入时会被自动忽略。'],
  [''],
  ['每期包含三个区块，区块以 A 列的标记行开头，遇到空行结束：'],
  ['[meta]', 'key | value 两列。template 固定 listing；category 可选值：合约 / 现货首发 / 现货非首发；datetimeUtc 填 UTC 时间（中文海报显示时自动 +8）；source 是备注，选填。'],
  ['[coins]', '第一行是表头（ticker、name），下面每行一个币种，最多 12 个。图标不用填，导入后在控制台点海报上的币图上传。'],
  ['[langs]', '第一行是表头（lang + 字段名如 title），下面每行一个语言。语言代号用 EN / CN / TW / JP / VN / ES / PT / DE / FR。'],
  [''],
  ['用法：在 Poster Studio 控制台「导入提需」里粘贴本表链接 → 首次会弹 Lark 授权 → 选期 → 确认导入。'],
];

const SAMPLE = [
  ['[meta]'],
  ['template', 'listing'],
  ['source', '0814 股票专区（示例，可改）'],
  ['category', '合约'],
  ['datetimeUtc', '2026-08-14 11:00'],
  [''],
  ['[coins]'],
  ['ticker', 'name'],
  ['FIG', 'Figma Inc.'],
  ['IONS', 'Ionis Pharmaceuticals Inc.'],
  ['FRMI', 'Fermi Inc.'],
  [''],
  ['[langs]'],
  ['lang', 'title'],
  ['EN', 'New Listings｜Stock Futures'],
  ['CN', '合约上新｜股票专区'],
  ['TW', '合約上新｜股票專區'],
  ['VN', 'Niêm Yết Mới｜Stock Futures'],
  ['JP', '新規上場｜株式先物'],
  ['ES', 'Nuevos Listados｜Futuros de Acciones'],
  ['PT', 'Novas Listagens｜Futuros de Ações'],
  ['DE', 'Neue Listings｜Aktien-Futures'],
  ['FR', 'Nouveaux Listings｜Futures sur Actions'],
];

const pad = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(w - r.length).fill('')]);
};

for (const domain of ['open.feishu.cn', 'open.larksuite.com']) {
  try {
    const token = await getToken(domain);
    const ss = await api(domain, '/open-apis/sheets/v3/spreadsheets', {
      method: 'POST', token, body: { title: 'Poster Studio 提需表' },
    });
    const { spreadsheet_token: st, url } = ss.spreadsheet;

    const tabs = await api(domain, `/open-apis/sheets/v3/spreadsheets/${st}/sheets/query`, { token });
    const first = tabs.sheets[0].sheet_id;

    await api(domain, `/open-apis/sheets/v2/spreadsheets/${st}/sheets_batch_update`, {
      method: 'POST', token,
      body: { requests: [
        { updateSheet: { properties: { sheetId: first, title: '使用说明' } } },
        { addSheet: { properties: { title: '示例期', index: 1 } } },
      ] },
    });
    const tabs2 = await api(domain, `/open-apis/sheets/v3/spreadsheets/${st}/sheets/query`, { token });
    const sample = tabs2.sheets.find((s) => s.title === '示例期').sheet_id;

    for (const [sheetId, rows] of [[first, GUIDE], [sample, SAMPLE]]) {
      const values = pad(rows);
      await fetch(`https://${domain}/open-apis/sheets/v2/spreadsheets/${st}/values`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ valueRange: { range: `${sheetId}!A1:${String.fromCharCode(64 + values[0].length)}${values.length}`, values } }),
      }).then((r) => r.json()).then((d) => { if (d.code !== 0) throw new Error(`写值失败 code ${d.code}: ${d.msg}`); });
    }

    // 租户内链接可编辑，方便直接打开维护
    await api(domain, `/open-apis/drive/v2/permissions/${st}/public?type=sheet`, {
      method: 'PATCH', token, body: { link_share_entity: 'tenant_editable' },
    }).catch((e) => console.warn('设置链接共享失败（不影响使用，可在表里手动开共享）：', e.message));

    console.log(`✓ 建表成功（${domain}）`);
    console.log(`  链接：${url}`);
    process.exit(0);
  } catch (err) {
    console.error(`✗ ${domain}：${err.message}`);
  }
}
process.exit(1);
