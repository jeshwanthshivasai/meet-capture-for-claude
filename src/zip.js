// Minimal ZIP writer (store method, no compression, UTF-8 names).
// No third-party code: easy to audit, nothing to trust but this file.
(function (root) {
  const NS = (root.MCC = root.MCC || {});

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  const enc = new TextEncoder();

  // Plain ZIP (no ZIP64): at most 65,535 entries and 4 GiB. Far beyond any meeting export, but
  // fail loudly rather than write a count that wraps around and confuses extractors.
  const MAX_ENTRIES = 0xffff;
  const MAX_BYTES = 0xffffffff;

  /**
   * @param {{path: string, data: string|Uint8Array}[]} files  Mutated: each entry's data is set to
   *   null once encoded, so the strings can be collected. Don't reuse the array.
   * @returns {Uint8Array[]} chunks; wrap in a Blob in the browser.
   */
  function makeZip(files, now = new Date()) {
    if (files.length > MAX_ENTRIES) throw new Error(`Too many files for one ZIP (${files.length}). Export fewer meetings at a time.`);
    const { time, date } = dosDateTime(now);
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.path);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      f.data = null; // release the string; the bytes are what we keep from here on
      if (offset + 30 + name.length + data.length > MAX_BYTES) throw new Error('The archive would exceed 4 GB. Export fewer meetings at a time.');
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);        // version needed
      local.setUint16(6, 0x0800, true);    // flag: UTF-8 names
      local.setUint16(8, 0, true);         // method: store
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);           // version made by
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    if (offset + cdSize + 22 > MAX_BYTES) throw new Error('The archive would exceed 4 GB. Export fewer meetings at a time.');
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return chunks.concat(central, [new Uint8Array(end.buffer)]);
  }

  NS.makeZip = makeZip;
  NS.crc32 = crc32;
})(typeof globalThis !== 'undefined' ? globalThis : this);
