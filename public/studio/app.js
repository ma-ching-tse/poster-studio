// Poster Studio 控制台 — 全部 UI 从 /api/templates（registry/manifest）派生，
// 前端不维护任何模板/尺寸/选项清单。
//
// 控件规则（按字段类型）：
//   text  -> 海报上直编（poster-kit 的 contentEditable，经 poster-update 回传）
//   enum  -> 侧栏分段按钮；manifest 带 defaults 时只显示已选子集，
//            label 旁 + 弹下拉 checkbox 对全量 options 增删（至少留一个）
//   rows  -> 侧栏 +/- 行（新行克隆 fixture 对应行或末行）
//   image -> 海报上点击图片上传（poster-kit data-edit-image；data URL 经 poster-update 回传存 state，服务端零存储）
//
// 直编回传只存 state 不回推 setData —— 回推会重建 DOM 打断光标（KOL 教训）。

let templates = [];
// sel: enum 字段的已选子集（key -> 值数组）；managing: 下拉菜单展开中的字段 key；
// langData: 每语言一份稿子快照（方案 A 运营按语言手填——切语言 = 切稿子，
// 首次切到某语言时从当前稿复制，之后各语言独立编辑，导出按已选语言各出各的）
const state = { template: null, size: null, data: null, sel: {}, managing: null, langData: {} };

// 点空白处收起下拉（点菜单内部或 + 按钮不算）
document.addEventListener('click', (e) => {
  if (state.managing && !e.target.closest('.dropdown, .label-btn')) {
    state.managing = null;
    renderSidebar();
  }
});

const $ = (id) => document.getElementById(id);
const manifest = () => templates.find(t => t.id === state.template);

async function init() {
  templates = await (await fetch('/api/templates')).json();
  buildGallery();
  route();
}

// —— 画廊 / 生成器双视图（hash 路由）——
// 空 hash = 画廊（按 manifest.line 产品线分组）；#/t/<id> = 该模板的生成器。
// 返回画廊不清 state：误触返回再进来，稿子还在。
function route() {
  const id = decodeURIComponent((location.hash.match(/^#\/t\/(.+)$/) || [])[1] || '');
  const t = templates.find(t => t.id === id);
  document.body.classList.toggle('in-studio', !!t);
  if (t && state.template !== t.id) selectTemplate(t.id);
}
addEventListener('hashchange', route);
$('back').onclick = () => { location.hash = '#/'; };

// 卡片缩略图 = 模板 iframe 灌 fixture 后按卡宽 zoom 缩放的实时预览，
// 不维护缩略图文件——新模板进 registry 即自动出现在画廊。
function buildGallery() {
  const CARD_W = 220;
  const groups = new Map(); // 产品线 -> 模板列表（按 registry 顺序）
  for (const t of templates) {
    const line = t.line || '其他';
    if (!groups.has(line)) groups.set(line, []);
    groups.get(line).push(t);
  }
  for (const [line, list] of groups) {
    const col = document.createElement('div');
    col.className = 'line';
    const title = document.createElement('div');
    title.className = 'line-title';
    title.textContent = line;
    col.appendChild(title);
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const t of list) {
      const s = t.sizes[0];
      const card = document.createElement('div');
      card.className = 'card';
      card.onclick = () => { location.hash = `#/t/${t.id}`; };
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      const iframe = document.createElement('iframe');
      iframe.width = s.viewW;
      iframe.height = s.viewH;
      iframe.style.zoom = String(CARD_W / s.viewW);
      iframe.onload = () => iframe.contentWindow.postMessage(
        { type: 'set-data', data: { ...t.fixture, _size: s.id } }, '*');
      iframe.src = `/src/templates/${t.id}/poster.html`;
      thumb.appendChild(iframe);
      card.append(thumb, Object.assign(document.createElement('div'),
        { className: 'card-name', textContent: t.name }));
      cards.appendChild(card);
    }
    col.appendChild(cards);
    $('lines').appendChild(col);
  }
}

function selectTemplate(id) {
  state.template = id;
  state.data = structuredClone(manifest().fixture);
  state.size = manifest().sizes[0].id;
  state.sel = {};
  state.managing = null;
  state.langData = {};
  renderSidebar();
  loadPreview();
}

// 切语言：当前稿存快照，再载入目标语言的稿。
// 首次切到某语言时，从原文稿（fixture 语言）派生再套 i18n 种子——
// 若从中间语言接力派生，值翻译会失配（活期 匹配不上 Flexible→フレキシブル）
function setLang(v) {
  if (v === state.data.lang) return;
  state.langData[state.data.lang] = structuredClone(state.data);
  if (state.langData[v]) {
    state.data = state.langData[v];
  } else {
    state.data = structuredClone(state.langData[manifest().fixture.lang] ?? state.data);
    state.data.lang = v;
    seedLang(v);
  }
  state.data.lang = v;
}

// 当前类别配置（listing 用 categories 分合约/现货；无 categories 的模板返回 null）
function catConf() {
  const cats = manifest().categories;
  return cats ? cats[state.data.category] : null;
}

// 切类别（合约/现货首发/现货非首发）：重置为该类别语言集 + 重灌默认标题；
// 保留 coins/时间等语言无关字段（清 langData，各语言下次访问按新类别重新播种）
function setCategory(v) {
  if (v === state.data.category) return;
  state.data.category = v;
  const conf = manifest().categories[v];
  state.sel.lang = [...conf.langs];
  state.langData = {};
  if (!conf.langs.includes(state.data.lang)) state.data.lang = conf.langs[0];
  seedLang(state.data.lang);
}

// 语言种子逻辑在 src/shared/brief.js（seedLangData），与提需导入共用同一口径
function seedLang(v) {
  state.data.lang = v;
  PosterBrief.seedLangData(manifest(), state.data);
}

function renderSidebar() {
  const m = manifest();
  $('studio-title').textContent = m.name; // 模板在画廊选定，侧栏标题即模板名
  $('import').hidden = !m.brief; // 提需导入是模板级开关（manifest.brief），savings 等模板不出入口
  seg($('size-seg'), m.sizes.map(s => ({ value: s.id, label: s.id })),
    state.size, (v) => { state.size = v; loadPreview(); });

  const box = $('field-groups');
  box.innerHTML = '';
  for (const f of m.fields) {
    if (f.hidden) continue; // manifest 标 hidden 的字段不出侧栏控件（数据照常渲染/校验）
    if (f.type === 'enum') {
      // lang 的可选池随当前类别走（categories[类别].langs），而非全量 options
      const pool = (f.key === 'lang' && catConf()) ? catConf().langs : f.options;
      // 初始已选子集 = manifest defaults（限定在池内，空则全池），+ 下拉可增删
      const sel = f.defaults
        ? (state.sel[f.key] ??= (f.defaults.filter(o => pool.includes(o)).length
            ? f.defaults.filter(o => pool.includes(o)) : [...pool]))
        : null;
      const open = state.managing === f.key;
      const action = sel && {
        label: '＋',
        onClick: () => { state.managing = open ? null : f.key; renderSidebar(); },
      };
      box.appendChild(group(f.label, (el) => {
        seg(el, (sel || pool).map(o => ({ value: o, label: o })), state.data[f.key],
          (v) => {
            if (f.key === 'lang') setLang(v);
            else if (f.key === 'category') setCategory(v);
            else state.data[f.key] = v;
            renderSidebar(); pushData();
          });
      }, action, open && ((panel) => {
        // 下拉：池内 options 的 checkbox 增删已选；当前值被删掉就落回子集首项
        for (const o of pool) {
          const item = document.createElement('label');
          item.className = 'dd-item';
          const cb = Object.assign(document.createElement('input'),
            { type: 'checkbox', checked: sel.includes(o) });
          cb.onchange = () => {
            const i = sel.indexOf(o);
            if (i >= 0) { if (sel.length > 1) sel.splice(i, 1); } else sel.push(o);
            sel.sort((a, b) => f.options.indexOf(a) - f.options.indexOf(b));
            if (!sel.includes(state.data[f.key])) {
              if (f.key === 'lang') setLang(sel[0]); else state.data[f.key] = sel[0];
              pushData();
            }
            renderSidebar();
          };
          item.append(cb, o);
          panel.appendChild(item);
        }
      })));
    }
    if (f.type === 'text' && f.input) {
      // 侧栏文本输入（manifest input 标记；如 UTC 时间——单一事实源不在海报上直编）。
      // shared 标记：改一次写穿所有语言稿（语言无关字段，如 datetimeUtc）
      box.appendChild(group(f.label, (el) => {
        const inp = Object.assign(document.createElement('input'), {
          type: 'text', className: 'text-input', value: state.data[f.key] ?? '',
        });
        inp.onchange = () => {
          state.data[f.key] = inp.value;
          if (f.shared) for (const d of Object.values(state.langData)) d[f.key] = inp.value;
          pushData();
        };
        el.appendChild(inp);
      }));
    }
    // image 字段不出侧栏控件：海报上点击图片直接上传（poster-kit 的 data-edit-image）
    if (f.type === 'rows') {
      box.appendChild(group(`${f.label}（${state.data[f.key].length}）`, (el) => {
        el.append(
          btn('+', () => {
            const rows = state.data[f.key];
            if (f.max && rows.length >= f.max) return;
            const proto = manifest().fixture[f.key];
            rows.push(structuredClone(proto[Math.min(rows.length, proto.length - 1)]));
            renderSidebar(); pushData();
          }),
          btn('−', () => {
            const rows = state.data[f.key];
            if (rows.length <= (f.min || 1)) return;
            rows.pop();
            renderSidebar(); pushData();
          }),
        );
      }));
    }
  }
}

function group(label, fill, action, dropdown) {
  const div = document.createElement('div');
  div.className = 'group';
  div.innerHTML = `<label>${label}</label><div class="seg"></div>`;
  if (action) {
    const a = document.createElement('button');
    a.className = 'label-btn';
    a.textContent = action.label;
    a.onclick = action.onClick;
    div.querySelector('label').appendChild(a);
  }
  if (dropdown) {
    const panel = document.createElement('div');
    panel.className = 'dropdown';
    dropdown(panel);
    div.appendChild(panel);
  }
  fill(div.querySelector('.seg'));
  return div;
}

function seg(el, options, active, onPick) {
  el.innerHTML = '';
  for (const o of options) el.appendChild(btn(o.label, () => onPick(o.value), o.value === active));
  return el;
}

function btn(label, onClick, active = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('active', active);
  b.onclick = onClick;
  return b;
}

// —— 预览 iframe ——
function sizeDef() { return manifest().sizes.find(s => s.id === state.size); }

function loadPreview() {
  const s = sizeDef();
  const iframe = $('preview');
  iframe.width = s.viewW;
  iframe.height = s.viewH;
  fitStage(s);
  iframe.onload = () => pushData();
  iframe.src = `/src/templates/${state.template}/poster.html?edit=1`;
}

function fitStage(s) {
  // 布局级 zoom 重新光栅化，不用 transform:scale 的位图拉伸（KOL 教训）
  const zoom = Math.min(1.6,
    (innerWidth - 260 - 96) / s.viewW, (innerHeight - 96) / s.viewH);
  $('stage').style.zoom = String(Math.max(zoom, 0.3));
}
addEventListener('resize', () => state.template && fitStage(sizeDef()));

function pushData() {
  $('preview').contentWindow.postMessage(
    { type: 'set-data', data: { ...state.data, _size: state.size } }, '*');
}

addEventListener('message', (e) => {
  if (e.data?.type === 'poster-update') state.data = e.data.data; // 不回推，保光标
});

// 导出文件名：manifest.exportName 模式串（{字段}=数据值、{size}=尺寸 id），没给就走通用命名
function exportName(data, sizeId) {
  const pat = manifest().exportName || `bitmart-${state.template}-{size}`;
  return pat.replace(/\{(\w+)\}/g, (_, k) =>
    (k === 'size' ? sizeId : String(data[k] ?? '').trim()) || k) + '.png';
}

// zip 包名：exportName 模式去掉 {lang}/{size} 两轴后取值（如 savings-USDT.zip）
function zipName() {
  const pat = manifest().exportName || `bitmart-${state.template}`;
  return pat.replace(/\{(lang|size)\}/g, '')
    .replace(/\{(\w+)\}/g, (_, k) => String(state.data[k] ?? '').trim() || k)
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '') + '.zip';
}

async function renderPng(sizeId, data) {
  // Sites 版嵌在同源 shell 中，由浏览器本地完成截图；旧 Express 版仍走 /api/render。
  // 这是唯一的运行时分叉，模板、manifest 与控制台逻辑继续共用。
  if (window.parent !== window && typeof window.parent.renderPosterStudioPng === 'function') {
    const size = manifest().sizes.find((s) => s.id === sizeId);
    return window.parent.renderPosterStudioPng({
      template: state.template, size, data,
    });
  }
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template: state.template, size: sizeId, data }),
  });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return new Uint8Array(await res.arrayBuffer());
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

// —— 导入提需（brief）——
// 粘贴归一化 JSON → PosterBrief.checkBrief（校验全部派生自 manifest）→
// 确认报告（错误/警告/跳过语言/成稿预览表）→ 应用：按语言灌进 langData。
// 主按钮单态机：没有解析结果时是「解析」，解析通过后变「应用导入」；改动输入即打回。
let briefChecked = null; // { template, result } — 最近一次通过解析的结果

$('import').onclick = () => { $('import-modal').hidden = false; $('brief-input').focus(); };
$('brief-cancel').onclick = closeImport;
$('import-modal').onclick = (e) => { if (e.target.id === 'import-modal') closeImport(); };

function closeImport() {
  $('import-modal').hidden = true;
  resetBriefGo();
}

function resetBriefGo() {
  briefChecked = null;
  $('brief-go').textContent = '解析';
  $('brief-report').hidden = true;
  $('brief-report').innerHTML = '';
}

$('brief-input').oninput = () => briefChecked && resetBriefGo();

$('brief-go').onclick = () => {
  if (briefChecked) {
    applyBrief(briefChecked);
    closeImport();
    return;
  }
  const input = $('brief-input').value.trim();
  const box = $('brief-report');
  box.hidden = false;
  box.innerHTML = '';
  if (/^https?:\/\//.test(input)) return fetchBrief(input); // 链接 → 服务端拉取
  let brief;
  try {
    brief = JSON.parse(input);
  } catch (err) {
    reportLine(box, 'brief-err', '✕ 不是 Lark 链接，按 JSON 解析也失败：' + err.message);
    return;
  }
  runBriefCheck(brief);
};

// 贴链接：服务端 lark-cli 拉取 + 归一化。未登录时打开授权页并轮询等完成；
// 一个表里有多期（多个文案列）时先出期数选择。
let fetching = false;
async function fetchBrief(url) {
  if (fetching) return;
  fetching = true;
  const box = $('brief-report');
  const go = $('brief-go');
  go.disabled = true;
  go.textContent = '拉取中…';
  try {
    for (let attempt = 0; attempt <= 40; attempt++) {
      const res = await fetch('/api/brief/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) { reportLine(box, 'brief-err', '✕ ' + body.error); return; }
      if (body.needLogin) {
        if (attempt === 0) {
          window.open(body.loginUrl, '_blank');
          reportLine(box, 'brief-warn', '⚠ 需要 Lark 授权：已在新标签页打开授权页（被拦截就点下面的链接），完成后这里会自动继续…');
          const a = Object.assign(document.createElement('a'), {
            href: body.loginUrl, target: '_blank', textContent: '打开 Lark 授权页',
          });
          a.className = 'brief-warn';
          box.appendChild(a);
          go.textContent = '等待授权…';
        }
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      box.innerHTML = '';
      if (body.briefs.length === 1) {
        runBriefCheck(body.briefs[0].brief);
      } else {
        reportLine(box, 'brief-sum', `该表包含 ${body.briefs.length} 期，选择要导入的一期：`);
        const seg = document.createElement('div');
        seg.className = 'seg';
        for (const { label, brief } of body.briefs) {
          seg.appendChild(btn(label, () => { box.innerHTML = ''; runBriefCheck(brief); }));
        }
        box.appendChild(seg);
      }
      return;
    }
    reportLine(box, 'brief-err', '✕ 等待授权超时（2 分钟），完成登录后请重新点解析');
  } catch (err) {
    reportLine(box, 'brief-err', '✕ 拉取失败：' + err.message);
  } finally {
    fetching = false;
    go.disabled = false;
    if (!briefChecked) go.textContent = '解析';
  }
}

// 校验一份 brief 并出确认报告（粘贴 JSON 和贴链接两条路都汇到这里）
function runBriefCheck(brief) {
  const box = $('brief-report');
  const m = templates.find(t => t.id === brief.template);
  if (!m) {
    reportLine(box, 'brief-err', `✕ 未知模板：${brief.template}（可用：${templates.filter(t => t.brief).map(t => t.id).join(', ')}）`);
    return;
  }
  if (!m.brief) {
    reportLine(box, 'brief-err', `✕ 模板 ${m.id} 未开启提需导入（manifest 无 brief 标记）`);
    return;
  }
  const result = PosterBrief.checkBrief(m, brief);
  renderBriefReport(box, m, result);
  if (!result.errors.length) {
    briefChecked = { template: m.id, result };
    $('brief-go').textContent = `应用导入（${result.ok.length} 个语言）`;
  }
}

function reportLine(box, cls, text) {
  const p = document.createElement('div');
  p.className = cls;
  p.textContent = text;
  box.appendChild(p);
}

function renderBriefReport(box, m, r) {
  r.errors.forEach(e => reportLine(box, 'brief-err', '✕ ' + e));
  r.warnings.forEach(w => reportLine(box, 'brief-warn', '⚠ ' + w));
  r.skipped.forEach(s => reportLine(box, 'brief-warn', `⚠ 跳过 ${s.lang}：${s.reason}`));
  if (!r.ok.length) return;
  // rows 字段摘要（如 币种：Figma Inc.、Ionis…）——各语言共用，取第一个成稿
  const first = r.ok[0].data;
  for (const f of m.fields) {
    if (f.type !== 'rows') continue;
    const col = f.columns.find(c => c.type === 'text');
    reportLine(box, 'brief-sum', `${f.label}（${first[f.key].length}）：${first[f.key].map(row => row[col.key]).join('、')}`);
  }
  // 语言 × 文本字段预览表
  const textFields = m.fields.filter(f => f.type === 'text');
  const table = document.createElement('table');
  table.className = 'brief-table';
  const head = table.insertRow();
  for (const label of ['语言', ...textFields.map(f => f.label)]) {
    head.appendChild(Object.assign(document.createElement('th'), { textContent: label }));
  }
  for (const { lang, data } of r.ok) {
    const tr = table.insertRow();
    tr.insertCell().textContent = lang;
    for (const f of textFields) tr.insertCell().textContent = data[f.key];
  }
  box.appendChild(table);
}

// 应用：整组语言稿覆盖 langData（导入 = 开新一期，不与旧稿合并），
// 已选语言子集按 brief 覆盖，当前稿切到原文语言（fixture.lang）优先。
function applyBrief({ template, result }) {
  if (state.template !== template) selectTemplate(template);
  location.hash = `#/t/${template}`; // brief 可能切模板，hash 同步（route 见 state 已一致，不会重置稿子）
  const m = manifest();
  const langField = m.fields.find(f => f.key === 'lang');
  state.langData = {};
  for (const { lang, data } of result.ok) state.langData[lang] = structuredClone(data);
  const langs = result.ok.map(o => o.lang)
    .sort((a, b) => langField.options.indexOf(a) - langField.options.indexOf(b));
  if (langField.defaults) state.sel.lang = [...langs];
  const first = langs.includes(m.fixture.lang) ? m.fixture.lang : langs[0];
  state.data = structuredClone(state.langData[first]);
  renderSidebar();
  pushData();
}

// —— 导出 ——
// 语言字段带 defaults（多语言模板）：已选语言 × 全部尺寸打成一个 zip；
// 否则：当前数据全部尺寸各下一张。
$('export').onclick = async () => {
  const b = $('export');
  b.disabled = true;
  try {
    const m = manifest();
    if (m.fields.some(f => f.key === 'lang' && f.defaults)) {
      state.langData[state.data.lang] = structuredClone(state.data); // 当前稿也入快照
      const files = [];
      for (const lang of state.sel.lang) {
        const data = structuredClone(state.langData[lang] ?? state.data); // 没编辑过的语言用当前稿
        data.lang = lang;
        for (const s of m.sizes) {
          b.textContent = `渲染 ${lang} / ${s.id}…`;
          files.push({ name: exportName(data, s.id), data: await renderPng(s.id, data) });
        }
      }
      downloadBlob(zipStore(files), zipName());
    } else {
      for (const s of m.sizes) {
        const png = await renderPng(s.id, state.data);
        downloadBlob(new Blob([png], { type: 'image/png' }), exportName(state.data, s.id));
      }
    }
    b.textContent = '已导出 ✓';
  } catch (err) {
    alert('导出失败：' + err.message);
  } finally {
    b.disabled = false;
    setTimeout(() => { b.textContent = '导出'; }, 2000);
  }
};

init();
