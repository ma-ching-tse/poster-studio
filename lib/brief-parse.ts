// 提需表 → brief JSON 解析器（规则解析，表结构自控所以不走 LLM）。
// 表结构约定（一个工作表标签 = 一期，标签名即期数 label）：
//   A 列出现 [meta] / [coins] / [langs] 标记行，划出三个区块：
//   [meta]  下方为 key | value 行（template / source / category / datetimeUtc…）
//   [coins] 下方第一行为表头（ticker / name…），随后每行一个币种
//   [langs] 下方第一行为表头（lang + 各字段 key，如 title），随后每行一个语言
//   区块遇到空行或下一个标记结束。语言代号用提需口径（EN/CN/TW/JP/VN…），
//   由前端 brief.js 的 LANG_ALIASES 归一，这里原样透传。
// 产出 schema 与 public/src/shared/brief.js 一致；脏数据进 warnings 不拦断。

const MARKERS = ['meta', 'coins', 'langs'] as const;
type Marker = (typeof MARKERS)[number];

export interface ParsedBrief {
  template: string;
  source?: string;
  shared: Record<string, unknown>;
  langs: Record<string, Record<string, string>>;
  warnings: string[];
}

const cell = (row: unknown[], i: number): string =>
  row && row[i] != null ? String(row[i]).trim() : '';

const markerOf = (row: unknown[]): Marker | null => {
  const m = cell(row, 0).toLowerCase().match(/^\[(\w+)\]$/);
  return m && (MARKERS as readonly string[]).includes(m[1]) ? (m[1] as Marker) : null;
};

const isBlank = (row: unknown[]): boolean => !row || row.every((c) => c == null || String(c).trim() === '');

// 单个工作表 → brief；不含 [langs] 标记视为非提需页，返回 null
export function parseBriefTab(values: unknown[][], tabTitle: string): ParsedBrief | null {
  // 切区块
  const blocks: Partial<Record<Marker, unknown[][]>> = {};
  let current: Marker | null = null;
  for (const row of values) {
    const marker = markerOf(row);
    if (marker) { current = marker; blocks[marker] = []; continue; }
    if (current) {
      if (isBlank(row)) { current = null; continue; }
      blocks[current]!.push(row);
    }
  }
  if (!blocks.langs) return null;

  const warnings: string[] = [];

  // [meta]：key | value
  const meta: Record<string, string> = {};
  for (const row of blocks.meta || []) {
    const k = cell(row, 0);
    if (k) meta[k] = cell(row, 1);
  }
  const { template = 'listing', source, ...sharedMeta } = meta;

  const shared: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sharedMeta)) if (v !== '') shared[k] = v;

  // [coins]：表头 + 数据行
  const coinRows = blocks.coins || [];
  if (coinRows.length > 1) {
    const header = coinRows[0].map((h) => String(h ?? '').trim());
    const coins = coinRows.slice(1).flatMap((row) => {
      const coin: Record<string, string> = {};
      header.forEach((h, i) => { if (h) coin[h] = cell(row, i); });
      if (!coin.ticker && !coin.name) return [];
      return [{ icon: '', ...coin }];
    });
    if (coins.length) shared.coins = coins;
  } else if (blocks.coins) {
    warnings.push(`「${tabTitle}」[coins] 区块没有数据行，已忽略`);
  }

  // [langs]：表头（lang + 字段 key）+ 每语言一行
  const langRows = blocks.langs!;
  const langs: ParsedBrief['langs'] = {};
  if (langRows.length > 1) {
    const header = langRows[0].map((h) => String(h ?? '').trim());
    const langCol = header.findIndex((h) => h.toLowerCase() === 'lang');
    if (langCol === -1) {
      warnings.push(`「${tabTitle}」[langs] 表头缺少 lang 列，无法解析语言`);
    } else {
      for (const row of langRows.slice(1)) {
        const lang = cell(row, langCol);
        if (!lang) continue;
        const payload: Record<string, string> = {};
        header.forEach((h, i) => {
          if (!h || i === langCol) return;
          const v = cell(row, i);
          if (v !== '') payload[h] = v;
        });
        langs[lang] = payload;
      }
    }
  }
  if (!Object.keys(langs).length) warnings.push(`「${tabTitle}」[langs] 没有解析到任何语言行`);

  return { template, ...(source ? { source } : {}), shared, langs, warnings };
}
