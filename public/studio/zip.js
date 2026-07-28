// 极简 ZIP 打包（STORE 不压缩——PNG 本身已压缩，再压无益）。
// 只做导出打包这一件事，避免为此引第三方依赖。
// 结构：每文件 Local File Header + 数据，末尾 Central Directory + EOCD。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name: string, data: Uint8Array }] -> Blob(application/zip)
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); // local file header signature
    h.setUint16(4, 20, true);         // version needed
    h.setUint16(8, 0, true);          // method 0 = STORE
    h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true); // compressed = uncompressed（STORE）
    h.setUint32(22, f.data.length, true);
    h.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(h.buffer), name, f.data);
    central.push({ name, crc, size: f.data.length, offset });
    offset += 30 + name.length + f.data.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); // central directory signature
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, c.size, true);
    h.setUint32(24, c.size, true);
    h.setUint16(28, c.name.length, true);
    h.setUint32(42, c.offset, true);
    chunks.push(new Uint8Array(h.buffer), c.name);
    offset += 46 + c.name.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, offset - cdStart, true);
  eocd.setUint32(16, cdStart, true);
  chunks.push(new Uint8Array(eocd.buffer));

  return new Blob(chunks, { type: 'application/zip' });
}
