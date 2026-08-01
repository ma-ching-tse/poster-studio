// 提需导入（brief）契约 — 「贴 Lark 提需文档」的数据接口。
//   路 1：粘贴 brief JSON 直接导入；
//   路 2：贴 Lark Sheets 链接，服务端拉表并规则解析为同一 schema（app/api/brief/fetch）。
// 样例见 src/templates/listing/brief.sample.json。
//
// schema：
//   {
//     template: 'listing',            // registry 模板 id 或模板目录名（dir；上币拆分后 listing 按 category 路由到合约/现货条目）
//     source:   '……',                 // 可选，来源备注（哪期/哪个文档）
//     shared:   { coins: [...] },     // 所有语言共用的字段值
//     langs:    { EN: { title, datetime }, CN: {...} },  // 每语言字段值，盖在 shared 之上
//     warnings: ['……'],               // 可选，解析器发现的脏数据提示（原样带给确认页）
//   }
// 语言键接受提需文档口径（CN/TW/JP/VN…），由 LANG_ALIASES 归一到 manifest 口径。
// 校验规则全部派生自 manifest（registry 单一事实源）：字段合法性走 validate.js
// 的 validateData，语言合法性看 lang 字段的 options —— 这里不新增任何手抄清单。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./validate'));
  else root.PosterBrief = factory(root.PosterValidate);
})(typeof self !== 'undefined' ? self : this, function ({ validateData }) {

  // 提需文档语言代号 → manifest 语言代号（文档口径不稳定：CNt/VT 都出现过）
  const LANG_ALIASES = {
    CN: 'zh-CN', TW: 'zh-TW', CNt: 'zh-TW', HK: 'zh-TW',
    JP: 'JA', VN: 'VI', VT: 'VI',
  };
  const normalizeLang = (code) => LANG_ALIASES[String(code).trim()] || String(code).trim();

  // 语言种子：把 data 里「提需/运营没提供」的字段灌上该语言的预置文案。
  // listing 走 categories[类别].titles[lang]（只赋标题）；其余模板走 i18n
  // （具名字段直赋 + values/patterns 对 rows 文本列做值翻译）。
  // skip = 已由提需明确提供、不该被种子覆盖的字段 key 集合。
  function seedLangData(manifest, data, skip) {
    skip = skip || new Set();
    const lang = data.lang;
    const conf = manifest.categories?.[data.category];
    if (conf) {
      if (!skip.has('title') && conf.titles[lang] !== undefined) data.title = conf.titles[lang];
      return;
    }
    const seed = manifest.i18n?.[lang];
    if (!seed) return;
    const { values = {}, patterns = [], ...fields } = seed;
    for (const [k, v] of Object.entries(fields)) if (!skip.has(k)) data[k] = v;
    const tr = (s) => {
      if (values[s] !== undefined) return values[s];
      for (const [re, rep] of patterns) {
        if (new RegExp(re).test(s)) return s.replace(new RegExp(re), rep);
      }
      return s;
    };
    for (const f of manifest.fields) {
      if (f.type !== 'rows' || skip.has(f.key)) continue;
      for (const row of data[f.key] || []) {
        for (const col of f.columns) {
          if (col.type === 'text' && typeof row[col.key] === 'string') row[col.key] = tr(row[col.key]);
        }
      }
    }
  }

  // 解析 + 校验一份 brief。永不 throw；结果分四类：
  //   errors   致命，不能应用；warnings 提示（含 brief 自带的脏数据标注）；
  //   skipped  单语言不合格（跳过该语言，不拦全局）；ok [{lang, data}] 可应用的成稿。
  function checkBrief(manifest, brief) {
    const errors = [], warnings = [], ok = [], skipped = [];
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      return { errors: ['brief 必须是 JSON 对象'], warnings, ok, skipped };
    }
    for (const w of Array.isArray(brief.warnings) ? brief.warnings : []) {
      warnings.push(`来源标注：${w}`);
    }
    const langField = manifest.fields.find((f) => f.key === 'lang' && f.type === 'enum');
    if (!langField) errors.push(`模板 ${manifest.id} 没有 lang 字段，不支持提需导入`);
    if (!brief.langs || typeof brief.langs !== 'object' || !Object.keys(brief.langs).length) {
      errors.push('langs 缺失或为空');
    }
    if (errors.length) return { errors, warnings, ok, skipped };

    // 只收 manifest 认识的字段；未知键提示后丢弃，不让脏键混进渲染数据
    const known = new Set(manifest.fields.map((f) => f.key));
    const pick = (payload, label) => {
      const out = {};
      for (const [k, v] of Object.entries(payload || {})) {
        if (k === 'lang') continue; // 语言由键名决定，payload 里的 lang 一律不认
        if (!known.has(k)) { warnings.push(`${label}：未知字段 ${k}，已忽略`); continue; }
        out[k] = v;
      }
      return out;
    };

    const shared = pick(brief.shared, 'shared');
    const seen = new Set();
    for (const [raw, payload] of Object.entries(brief.langs)) {
      const lang = normalizeLang(raw);
      if (!langField.options.includes(lang)) {
        skipped.push({ lang: raw, reason: `语言 ${raw} 不在模板语言池 [${langField.options.join(', ')}]` });
        continue;
      }
      if (seen.has(lang)) {
        skipped.push({ lang: raw, reason: `语言 ${raw}（=${lang}）重复，保留先出现的一份` });
        continue;
      }
      // 成稿 = fixture 打底 ⊕ shared ⊕ 该语言字段（同 langData 快照口径），
      // 再对提需没提供的字段播语言种子（预置文案），与控制台切语言口径一致
      const picked = pick(payload, raw);
      const data = structuredClone(manifest.fixture);
      Object.assign(data, structuredClone(shared), structuredClone(picked));
      data.lang = lang;
      seedLangData(manifest, data, new Set([...Object.keys(shared), ...Object.keys(picked)]));
      const err = validateData(manifest, data);
      if (err) { skipped.push({ lang: raw, reason: err }); continue; }
      seen.add(lang);
      ok.push({ lang, data });
    }
    if (!ok.length) errors.push('没有任何语言通过校验');
    return { errors, warnings, ok, skipped };
  }

  return { LANG_ALIASES, normalizeLang, checkBrief, seedLangData };
});
