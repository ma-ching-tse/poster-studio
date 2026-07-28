// Manifest 数据校验 — UMD：服务端 registry 与浏览器控制台共用这一份，
// 不允许出现第二份手抄的校验规则（registry 单一事实源的延伸）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosterValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Flatten fields including rows columns, for validation.
  function* walkFields(fields) {
    for (const f of fields) {
      yield f;
      if (f.type === 'rows') yield* walkFields(f.columns);
    }
  }

  // Validate a data payload against a manifest. Returns an error string or null.
  // Enforces the review lesson from the KOL project: enum membership (e.g. bg
  // variants) is checked HERE, server-side, from the manifest — a delisted
  // option removed from a manifest is dead everywhere at once.
  function validateData(manifest, data) {
    if (!data || typeof data !== 'object') return 'data must be an object';
    for (const f of manifest.fields) {
      const v = data[f.key];
      if (v === undefined || v === null) {
        if (f.optional) continue;
        return `missing field: ${f.key}`;
      }
      if (f.type === 'enum' && !f.options.includes(v)) return `${f.key}: "${v}" not in [${f.options.join(', ')}]`;
      if (f.type === 'text' && typeof v !== 'string') return `${f.key}: expected string`;
      if (f.type === 'image' && typeof v !== 'string') return `${f.key}: expected data URL or path string`;
      if (f.type === 'rows') {
        if (!Array.isArray(v)) return `${f.key}: expected array`;
        if (f.min && v.length < f.min) return `${f.key}: needs at least ${f.min} rows`;
        if (f.max && v.length > f.max) return `${f.key}: at most ${f.max} rows`;
        for (const row of v) {
          for (const col of f.columns) {
            const cv = row[col.key];
            if (cv === undefined || cv === null) {
              if (col.optional) continue;
              return `${f.key}[].${col.key}: missing`;
            }
            if (col.type === 'enum' && !col.options.includes(cv)) return `${f.key}[].${col.key}: "${cv}" invalid`;
          }
        }
      }
    }
    return null;
  }

  return { walkFields, validateData };
});
