// poster-kit — 模板运行时套件（框架层，所有模板共用）。
//
// 契约：
//   模板定义 window.renderPoster(data)（纯渲染，可反复调用）
//   套件提供 window.setData(payload)：
//     - 按 payload._size 切 body class（size-<id>），预览与导出同值
//     - 调 renderPoster
//     - ?edit=1 时给 [data-edit="路径"] 挂 contentEditable 直编，
//       编辑经 postMessage {type:'poster-update', data} 回传父页。
//       父页收到后只存 state 不回推 setData（回推会打断光标，KOL 教训）。
//     - ?edit=1 时 [data-edit-image="路径"] 变成点击上传：点图 → 文件选择器 →
//       data URL 写进数据并整体重渲（图片无光标，重渲安全），同样回传父页。
//   路径写法："title" / "rows.0.term"（rows 字段用行索引）。

(function () {
  const EDIT = new URLSearchParams(location.search).get('edit') === '1';
  let current = null;

  window.setData = function (payload) {
    current = payload;
    if (payload._size) document.body.className = 'size-' + payload._size;
    window.renderPoster(payload);
    if (EDIT) bindEditing();
  };

  function bindEditing() {
    document.querySelectorAll('[data-edit]').forEach((el) => {
      el.contentEditable = 'plaintext-only';
      el.addEventListener('input', () => {
        setByPath(current, el.dataset.edit, el.innerText);
        const { _size, ...data } = current;
        parent.postMessage({ type: 'poster-update', data }, '*');
      });
    });
    document.querySelectorAll('[data-edit-image]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.title = '点击上传图片';
    });
  }

  // 图片点击走文档级委托 + elementsFromPoint：装饰层（光晕/前景岩石等）盖在
  // 图片槽上面也能点中下层目标；正在直编的文字优先，不弹上传框
  if (EDIT) {
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-edit]')) return;
      const hit = document.elementsFromPoint(e.clientX, e.clientY)
        .find((n) => n.dataset && n.dataset.editImage !== undefined);
      if (hit) pickImage(hit.dataset.editImage);
    });
  }

  function pickImage(path) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { alert('图片超过 15MB，请压缩后再上传'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        setByPath(current, path, reader.result);
        window.setData(current);
        const { _size, ...data } = current;
        parent.postMessage({ type: 'poster-update', data }, '*');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // 末段支持 "key@n"：只改多行文本字段（\n 分隔）的第 n 行——
  // 模板把多行值拆成多个直编元素时用（如 savings 分级利率的上下两格）
  function setByPath(obj, pathSpec, value) {
    const parts = pathSpec.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    const last = parts[parts.length - 1];
    const at = last.indexOf('@');
    if (at === -1) { o[last] = value; return; }
    const key = last.slice(0, at);
    const lines = String(o[key]).split('\n');
    lines[Number(last.slice(at + 1))] = value;
    o[key] = lines.join('\n');
  }

  // iframe 预览走 postMessage；Puppeteer 导出走 window.setData 直调，两端同一契约
  addEventListener('message', (e) => {
    if (e.data && e.data.type === 'set-data') window.setData(e.data.data);
  });
})();
