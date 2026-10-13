import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { excelDate, readXls } from '../xls';

const rec = (type: number, data: Buffer) => {
  const h = Buffer.alloc(4);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(data.length, 2);
  return Buffer.concat([h, data]);
};
const u16 = (...v: number[]) => Buffer.from(new Uint16Array(v).buffer);
const u32 = (...v: number[]) => Buffer.from(new Uint32Array(v).buffer);
const f64 = (v: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v);
  return b;
};
const cell = (row: number, col: number) => u16(row, col, 0);
const rk = (v: number) => u32(((v * 100) << 2) | 3); // integer ×100 form
/** BIFF8 short string: cch, flags, chars */
const str16 = (s: string, wide = false) => Buffer.concat([u16(s.length), Buffer.from([wide ? 1 : 0]), wide ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'latin1')]);

/** A Compound File holding one "Workbook" stream, laid out on 512-byte sectors. */
function cfb(workbook: Buffer): Buffer {
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const wb = pad(Buffer.concat([workbook, Buffer.alloc(Math.max(0, 4096 - workbook.length))]));
  const n = wb.length / 512;
  const header = Buffer.alloc(512, 0);
  u32(0xe011cfd0, 0xe11ab1a1).copy(header, 0);
  header.writeUInt16LE(0x3e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44); // one FAT sector
  header.writeUInt32LE(1, 48); // directory at sector 1
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(0xfffffffe, 60);
  header.writeUInt32LE(0xfffffffe, 68);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 76 + i * 4);
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < n; i++) fat.writeUInt32LE(i === n - 1 ? 0xfffffffe : 3 + i, (2 + i) * 4);
  const dir = Buffer.alloc(512, 0);
  const entry = (i: number, name: string, type: number, start: number, size: number) => {
    const o = i * 128;
    Buffer.from(`${name}\0`, 'utf16le').copy(dir, o);
    dir.writeUInt16LE((name.length + 1) * 2, o + 64);
    dir[o + 66] = type;
    dir.writeUInt32LE(0xffffffff, o + 68);
    dir.writeUInt32LE(0xffffffff, o + 72);
    dir.writeUInt32LE(i === 0 ? 1 : 0xffffffff, o + 76);
    dir.writeUInt32LE(start, o + 116);
    dir.writeUInt32LE(size, o + 120);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0);
  entry(1, 'Workbook', 2, 2, wb.length); // padded past the 4096-byte mini stream cutoff
  return Buffer.concat([header, fat, dir, wb]);
}

function workbook(): Buffer {
  // SST: "DATE", "ACMY10", then "31-Jan-2025" split across a CONTINUE (which restarts with a flags byte)
  const sstHead = Buffer.concat([u32(3, 3), str16('DATE'), str16('ACMY10'), u16(11), Buffer.from([0]), Buffer.from('31-Ja', 'latin1')]);
  const cont = Buffer.concat([Buffer.from([0]), Buffer.from('n-2025', 'latin1')]);
  const bof = rec(0x0809, u16(0x600, 0x10, 0, 0, 0, 0, 0, 0));
  const sheetName = Buffer.concat([Buffer.from([9, 0]), Buffer.from('ACM Month', 'latin1')]);
  const globals = (pos: number) => Buffer.concat([bof, rec(0x0085, Buffer.concat([u32(pos), u16(0), sheetName])), rec(0x00fc, sstHead), rec(0x003c, cont), rec(0x000a, Buffer.alloc(0))]);
  const sheet = Buffer.concat([
    rec(0x0809, u16(0x600, 0x10, 0, 0, 0, 0, 0, 0)),
    rec(0x00fd, Buffer.concat([cell(0, 0), u32(0)])),
    rec(0x00fd, Buffer.concat([cell(0, 1), u32(1)])),
    rec(0x0204, Buffer.concat([cell(0, 2), str16('기간', true)])),
    rec(0x00fd, Buffer.concat([cell(1, 0), u32(2)])),
    rec(0x0203, Buffer.concat([cell(1, 1), f64(4.5)])),
    rec(0x027e, Buffer.concat([cell(1, 2), rk(0.25)])),
    // MULRK: row 2, cols 1–2
    rec(0x00bd, Buffer.concat([u16(2, 1), u16(0), rk(4.75), u16(0), rk(-0.5), u16(2)])),
    rec(0x0203, Buffer.concat([cell(2, 0), f64(45688)])),
    // A formula whose cached result is a number
    rec(0x0006, Buffer.concat([cell(3, 1), f64(3.25), u16(0, 0, 0, 0, 0)])),
    rec(0x000a, Buffer.alloc(0)),
  ]);
  const pos = globals(0).length;
  return Buffer.concat([globals(pos), sheet]);
}

describe('readXls', () => {
  it('reads strings (split across records), numbers, RK, MULRK and formula results', () => {
    const [s] = readXls(cfb(workbook()));
    assert.equal(s.name, 'ACM Month');
    assert.deepEqual(s.rows[0], ['DATE', 'ACMY10', '기간']);
    assert.deepEqual(s.rows[1], ['31-Jan-2025', 4.5, 0.25]);
    assert.equal(s.rows[2][1], 4.75);
    assert.equal(s.rows[2][2], -0.5);
    assert.equal(excelDate(s.rows[2][0] as number), '2025-01-31');
    assert.equal(s.rows[3][1], 3.25);
  });

  it('refuses a file that is not a compound file', () => {
    assert.throws(() => readXls(Buffer.from('DATE,ACMY10\n')), /compound/);
  });
});
