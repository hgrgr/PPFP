/**
 * A small reader for legacy Excel files (.xls, BIFF8 inside a Compound File), enough to read
 * the cells of a data sheet: numbers and text. Formatting, formulas' source and dates' formats
 * are ignored, so a date cell comes back as its Excel serial number. Written for the New York
 * Fed's ACM term premium file, which is published only as .xls.
 */

export type XlsCell = number | string;
export interface XlsSheet {
  name: string;
  /** rows[r][c]; missing cells are undefined */
  rows: XlsCell[][];
}

const ENDOFCHAIN = 0xfffffffe;

/** The bytes of the stream called `name` (e.g. "Workbook") in a Compound File. */
export function cfbStream(buf: Buffer, name: string): Buffer | null {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw new Error('not an OLE compound file');
  const ssz = 1 << buf.readUInt16LE(30);
  const msz = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48);
  const cutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  let difSect = buf.readUInt32LE(68);
  const sector = (n: number) => buf.subarray((n + 1) * ssz, (n + 2) * ssz);
  // The FAT's sectors: 109 in the header, the rest in the DIFAT chain
  const fatSects: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s < ENDOFCHAIN - 1) fatSects.push(s);
  }
  for (let guard = 0; difSect < ENDOFCHAIN - 1 && guard < 1e5; guard++) {
    const d = sector(difSect);
    for (let i = 0; i < ssz / 4 - 1; i++) {
      const s = d.readUInt32LE(i * 4);
      if (s < ENDOFCHAIN - 1) fatSects.push(s);
    }
    difSect = d.readUInt32LE(ssz - 4);
  }
  const fat: number[] = [];
  for (const s of fatSects) {
    const d = sector(s);
    for (let i = 0; i < ssz / 4; i++) fat.push(d.readUInt32LE(i * 4));
  }
  const chain = (start: number, next: number[]) => {
    const out: number[] = [];
    for (let s = start; s < ENDOFCHAIN - 1 && out.length < next.length + 1; s = next[s]) out.push(s);
    return out;
  };
  const read = (start: number) => Buffer.concat(chain(start, fat).map(sector));
  const dir = read(dirStart);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = dir.readUInt16LE(o + 64);
    entries.push({ name: dir.subarray(o, o + Math.max(0, len - 2)).toString('utf16le'), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const e = entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
  if (!e) return null;
  if (e.size >= cutoff) return read(e.start).subarray(0, e.size);
  // Small streams live in the mini stream (the root entry's data), in 64-byte mini sectors
  const root = read(entries[0].start);
  const miniFat: number[] = [];
  const mf = read(miniFatStart);
  for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  return Buffer.concat(chain(e.start, miniFat).map((s) => root.subarray(s * msz, (s + 1) * msz))).subarray(0, e.size);
}

/** Decodes an RK number (a compressed double or integer). */
function rk(v: number): number {
  const div = v & 1 ? 100 : 1;
  if (v & 2) return (v >> 2) / div;
  const b = Buffer.alloc(8);
  b.writeUInt32LE(v & 0xfffffffc, 4);
  return b.readDoubleLE(0) / div;
}

/** Reads text that may run on into CONTINUE records, each of which restarts with a flags byte. */
class Pieces {
  private i = 0;
  private o = 0;
  constructor(private parts: Buffer[]) {}
  get done() {
    return this.i >= this.parts.length;
  }
  private cur() {
    while (this.i < this.parts.length && this.o >= this.parts[this.i].length) {
      this.i++;
      this.o = 0;
    }
    return this.parts[this.i];
  }
  u8() {
    const b = this.cur();
    return b[this.o++];
  }
  u16() {
    return this.u8() | (this.u8() << 8);
  }
  u32() {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    for (let k = 0; k < n; k++) this.u8();
  }
  chars(n: number, wide: boolean): string {
    let s = '';
    let w = wide;
    for (let k = 0; k < n; k++) {
      // Characters running into the next record: it starts with its own flags byte
      if (this.i < this.parts.length && this.o >= this.parts[this.i].length) {
        this.i++;
        this.o = 0;
        w = (this.u8() & 1) === 1;
      }
      s += String.fromCharCode(w ? this.u16() : this.u8());
    }
    return s;
  }
}

function unicodeString(p: Pieces): string {
  const cch = p.u16();
  const flags = p.u8();
  const rich = flags & 8 ? p.u16() : 0;
  const ext = flags & 4 ? p.u32() : 0;
  const s = p.chars(cch, (flags & 1) === 1);
  p.skip(rich * 4 + ext);
  return s;
}

/** Every sheet's cells. */
export function readXls(buf: Buffer): XlsSheet[] {
  const wb = cfbStream(buf, 'Workbook') ?? cfbStream(buf, 'Book');
  if (!wb) throw new Error('no Workbook stream');
  const recs: { type: number; data: Buffer; at: number }[] = [];
  for (let o = 0; o + 4 <= wb.length; ) {
    const type = wb.readUInt16LE(o);
    const len = wb.readUInt16LE(o + 2);
    recs.push({ type, data: wb.subarray(o + 4, o + 4 + len), at: o });
    o += 4 + len;
  }
  const sst: string[] = [];
  const sheets: { name: string; pos: number }[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x0085) {
      const cch = r.data[6];
      const wide = (r.data[7] & 1) === 1;
      const name = wide ? r.data.subarray(8, 8 + cch * 2).toString('utf16le') : r.data.subarray(8, 8 + cch).toString('latin1');
      sheets.push({ name, pos: r.data.readUInt32LE(0) });
    } else if (r.type === 0x00fc) {
      const parts = [r.data.subarray(8)];
      for (let j = i + 1; j < recs.length && recs[j].type === 0x003c; j++) parts.push(recs[j].data);
      const p = new Pieces(parts);
      const n = r.data.readUInt32LE(4);
      for (let k = 0; k < n && !p.done; k++) sst.push(unicodeString(p));
    }
  }
  return sheets.map((s) => {
    const rows: XlsCell[][] = [];
    const set = (row: number, col: number, v: XlsCell) => ((rows[row] ??= [])[col] = v);
    let i = recs.findIndex((r) => r.at === s.pos);
    for (i = i < 0 ? recs.length : i + 1; i < recs.length && recs[i].type !== 0x000a; i++) {
      const { type, data: d } = recs[i];
      if (type === 0x0203) set(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
      else if (type === 0x027e) set(d.readUInt16LE(0), d.readUInt16LE(2), rk(d.readInt32LE(6)));
      else if (type === 0x00bd) {
        const row = d.readUInt16LE(0);
        const first = d.readUInt16LE(2);
        const n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) set(row, first + k, rk(d.readInt32LE(4 + k * 6 + 2)));
      } else if (type === 0x00fd) set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
      else if (type === 0x0204) set(d.readUInt16LE(0), d.readUInt16LE(2), unicodeString(new Pieces([d.subarray(6)])));
      else if (type === 0x0006 && d.readUInt16LE(12) !== 0xffff) set(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
    }
    return { name: s.name, rows };
  });
}

/** Excel's serial day number (1900 system) as "YYYY-MM-DD". */
export function excelDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}
