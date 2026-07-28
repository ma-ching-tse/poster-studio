// 上线时间的单一事实源与派生规则 — UMD（sheet-parser / 控制台 / 海报模板共用）。
// 规则（Ringo 2026-07-15 定）：数据只存一份 UTC 原始值（datetimeUtc，"YYYY-MM-DD HH:mm"），
// 各语言显示由模板派生：zh-CN / zh-TW 显示 +8 小时并后缀 (UTC+8)，其余语言原样后缀 (UTC)。
// 运营只填/只改 UTC 一份，九个语言的时间自动对。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosterTime = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ZH_PLUS8 = new Set(['zh-CN', 'zh-TW']);

  // 宽容解析："2026-07-14 11:00"，容忍尾部已有 "(UTC…)" 后缀（手输兜底）
  function parseUtc(str) {
    const m = String(str || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  }

  const pad = (n) => String(n).padStart(2, '0');

  // 加小时（跨日/跨月用 Date.UTC 结转，与本机时区无关）
  function shift(t, hours) {
    const ms = Date.UTC(t.y, t.mo - 1, t.d, t.h + hours, t.mi);
    const d = new Date(ms);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(),
    };
  }

  const fmt = (t) => `${t.y}-${pad(t.mo)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}`;

  // UTC 原始值 + 语言 → 海报显示文本；解析不了就原样返回（运营写了非标准文本时不吞）
  function display(utcStr, lang) {
    const t = parseUtc(utcStr);
    if (!t) return String(utcStr || '');
    return ZH_PLUS8.has(lang)
      ? `${fmt(shift(t, 8))} (UTC+8)`
      : `${fmt(t)} (UTC)`;
  }

  // 提需原文（任意语言的时间串，可能带 (UTC+8) 后缀）→ UTC 原始值；解析不了返回 null
  function toUtc(rawStr) {
    const t = parseUtc(rawStr);
    if (!t) return null;
    const m = String(rawStr).match(/UTC\s*([+-]\d{1,2})/i);
    return fmt(m ? shift(t, -Number(m[1])) : t);
  }

  return { display, toUtc, parseUtc, ZH_PLUS8 };
});
