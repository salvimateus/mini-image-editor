import { CoreError } from '../errors.ts';

/*
 * Size of the plain JPEG: the coefficients of a baseline MozJPEG file re-coded in one baseline scan with the standard
 * Huffman tables of the JPEG spec (Annex K). Only the byte count leaves this module; the saved file always comes
 * from MozJPEG.
 */

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Blocks per line and block lines with the MCU padding. */
  blocksW: number;
  blocksH: number;
  /** Blocks that hold image data: a non-interleaved scan codes only these. */
  usedW: number;
  usedH: number;
  /** 64 coefficients for each block, in zigzag order. */
  coefs: Int16Array;
}

interface Frame {
  width: number;
  height: number;
  hmax: number;
  vmax: number;
  mcusX: number;
  mcusY: number;
  comps: Component[];
}

interface DecodeTable {
  lookup: Uint16Array;
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  vals: Uint8Array;
}

export interface HuffSpec {
  bits: Uint8Array;
  vals: Uint8Array;
}

interface EncodeTable {
  code: Uint16Array;
  size: Uint8Array;
}

/** Annex K tables: DC luma, DC chroma, AC luma, AC chroma. Each holds every symbol of 8-bit data. */
const DC_VALUES = Array.from({ length: 12 }, (_, i) => i);
const STD_DC_LUMA: HuffSpec = { bits: Uint8Array.of(0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0), vals: Uint8Array.from(DC_VALUES) };
const STD_DC_CHROMA: HuffSpec = { bits: Uint8Array.of(0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0), vals: Uint8Array.from(DC_VALUES) };
const STD_AC_LUMA: HuffSpec = {
  bits: Uint8Array.of(0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d),
  vals: Uint8Array.of(
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1,
    0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
    0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85,
    0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
    0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
    0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
    0xfa,
  ),
};
const STD_AC_CHROMA: HuffSpec = {
  bits: Uint8Array.of(0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77),
  vals: Uint8Array.of(
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42,
    0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19,
    0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83,
    0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8,
    0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
    0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
    0xfa,
  ),
};
/** The standard tables by Huffman slot: DC 0/1 and AC 2/3. */
export const STANDARD_TABLES: readonly HuffSpec[] = [STD_DC_LUMA, STD_DC_CHROMA, STD_AC_LUMA, STD_AC_CHROMA];

const LOOKUP_BITS = 9;
function fail(message: string): never {
  throw new CoreError('encode-failed', `JPEG re-coding: ${message}`);
}

function bitLength(value: number): number {
  return value === 0 ? 0 : 32 - Math.clz32(value);
}

// ----- parse and decode the baseline file -----

function buildDecodeTable(spec: HuffSpec): DecodeTable {
  const lookup = new Uint16Array(1 << LOOKUP_BITS);
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const count = spec.bits[len - 1];
    valptr[len] = k;
    mincode[len] = code;
    for (let i = 0; i < count; i++, k++, code++) {
      if (len <= LOOKUP_BITS) {
        const shift = LOOKUP_BITS - len;
        const base = code << shift;
        for (let fill = 0; fill < 1 << shift; fill++) lookup[base + fill] = (len << 8) | spec.vals[k];
      }
    }
    maxcode[len] = count > 0 ? code - 1 : -1;
    code <<= 1;
  }
  // Sentinel: no code is longer than 16 bits.
  maxcode[17] = 0x7fffffff;
  return { lookup, maxcode, valptr, mincode, vals: spec.vals };
}

class BitReader {
  private buf = 0;
  private cnt = 0;
  private pos: number;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array, pos: number) {
    this.data = data;
    this.pos = pos;
  }

  private fill(): void {
    while (this.cnt <= 24) {
      let byte = 0;
      if (this.pos < this.data.length) {
        byte = this.data[this.pos];
        if (byte === 0xff) {
          const next = this.data[this.pos + 1];
          if (next === 0x00) this.pos += 2;
          else byte = 0; // a marker: the scan data ended, feed zeros
        } else {
          this.pos++;
        }
      }
      this.buf = ((this.buf << 8) | byte) >>> 0;
      this.cnt += 8;
    }
  }

  peek(n: number): number {
    if (this.cnt < n) this.fill();
    return (this.buf >>> (this.cnt - n)) & ((1 << n) - 1);
  }

  skip(n: number): void {
    if (this.cnt < n) this.fill();
    this.cnt -= n;
    this.buf = this.cnt === 0 ? 0 : (this.buf & (2 ** this.cnt - 1)) >>> 0;
  }

  read(n: number): number {
    if (n === 0) return 0;
    const value = this.peek(n);
    this.skip(n);
    return value;
  }

  decode(table: DecodeTable): number {
    const bits = this.peek(LOOKUP_BITS);
    const entry = table.lookup[bits];
    if (entry !== 0) {
      this.skip(entry >> 8);
      return entry & 0xff;
    }
    let code = bits;
    let len = LOOKUP_BITS;
    this.skip(LOOKUP_BITS);
    while (code > table.maxcode[len]) {
      code = (code << 1) | this.read(1);
      len++;
      if (len > 16) fail('bad Huffman code');
    }
    return table.vals[table.valptr[len] + code - table.mincode[len]];
  }
}

function extend(value: number, size: number): number {
  return value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

interface Parsed {
  frame: Frame;
  /** APPn, COM and DQT segments, each with its marker, copied as they are. */
  keep: Uint8Array[];
}

function parseFrame(seg: Uint8Array): Frame {
  if (seg[0] !== 8) fail('only 8-bit samples are supported');
  const height = u16(seg, 1);
  const width = u16(seg, 3);
  const count = seg[5];
  if (width === 0 || height === 0 || (count !== 1 && count !== 3)) fail('unsupported frame');
  const raw: { id: number; h: number; v: number; tq: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 3;
    raw.push({ id: seg[at], h: seg[at + 1] >> 4, v: seg[at + 1] & 15, tq: seg[at + 2] });
  }
  const hmax = Math.max(...raw.map((c) => c.h));
  const vmax = Math.max(...raw.map((c) => c.v));
  const mcusX = Math.ceil(width / (8 * hmax));
  const mcusY = Math.ceil(height / (8 * vmax));
  const comps = raw.map((c): Component => {
    const blocksW = mcusX * c.h;
    const blocksH = mcusY * c.v;
    return {
      ...c,
      blocksW,
      blocksH,
      usedW: Math.ceil(Math.ceil((width * c.h) / hmax) / 8),
      usedH: Math.ceil(Math.ceil((height * c.v) / vmax) / 8),
      coefs: new Int16Array(blocksW * blocksH * 64),
    };
  });
  return { width, height, hmax, vmax, mcusX, mcusY, comps };
}

function parseHuffman(seg: Uint8Array, dc: (DecodeTable | null)[], ac: (DecodeTable | null)[]): void {
  let at = 0;
  while (at < seg.length) {
    const tc = seg[at] >> 4;
    const th = seg[at] & 15;
    if (th > 3 || tc > 1) fail('bad Huffman table id');
    const bits = seg.slice(at + 1, at + 17);
    const total = bits.reduce((sum, n) => sum + n, 0);
    const vals = seg.slice(at + 17, at + 17 + total);
    (tc === 0 ? dc : ac)[th] = buildDecodeTable({ bits, vals });
    at += 17 + total;
  }
}

/** Each block of a scan, in coding order: MCU order for an interleaved scan, raster order of used blocks for one component. */
function forEachBlock(frame: Frame, comps: readonly number[], visit: (ci: number, block: number) => void): void {
  if (comps.length === 1) {
    const ci = comps[0];
    const comp = frame.comps[ci];
    for (let by = 0; by < comp.usedH; by++) {
      for (let bx = 0; bx < comp.usedW; bx++) {
        visit(ci, by * comp.blocksW + bx);
      }
    }
    return;
  }
  for (let my = 0; my < frame.mcusY; my++) {
    for (let mx = 0; mx < frame.mcusX; mx++) {
      for (const ci of comps) {
        const comp = frame.comps[ci];
        for (let v = 0; v < comp.v; v++) {
          for (let h = 0; h < comp.h; h++) visit(ci, (my * comp.v + v) * comp.blocksW + mx * comp.h + h);
        }
      }
    }
  }
}

function parseBaseline(bytes: Uint8Array): Parsed {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('not a JPEG file');
  const keep: Uint8Array[] = [];
  const dc: (DecodeTable | null)[] = [null, null, null, null];
  const ac: (DecodeTable | null)[] = [null, null, null, null];
  let frame: Frame | null = null;
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) fail('bad marker');
    while (bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16(bytes, pos);
    const seg = bytes.subarray(pos + 2, pos + length);
    const start = pos - 2;
    pos += length;
    if (marker === 0xc0 || marker === 0xc1) frame = parseFrame(seg);
    else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) fail('only a baseline file can be re-coded');
    else if (marker === 0xc4) parseHuffman(seg, dc, ac);
    else if (marker === 0xdd) {
      if (u16(seg, 0) !== 0) fail('restart intervals are not supported');
    } else if (marker === 0xdb || marker === 0xfe || (marker >= 0xe0 && marker <= 0xef)) keep.push(bytes.subarray(start, pos));
    else if (marker === 0xda) {
      if (!frame) fail('scan before frame');
      decodeScan(bytes, pos, seg, frame, dc, ac);
      return { frame, keep };
    }
  }
  fail('no scan');
}

function decodeScan(bytes: Uint8Array, dataPos: number, seg: Uint8Array, frame: Frame, dc: (DecodeTable | null)[], ac: (DecodeTable | null)[]): void {
  const count = seg[0];
  if (count !== frame.comps.length) fail('only one interleaved scan is supported');
  const order: number[] = [];
  const dcTables: DecodeTable[] = [];
  const acTables: DecodeTable[] = [];
  for (let i = 0; i < count; i++) {
    const id = seg[1 + i * 2];
    const ci = frame.comps.findIndex((c) => c.id === id);
    if (ci < 0) fail('scan names an unknown component');
    const d = dc[seg[2 + i * 2] >> 4];
    const a = ac[seg[2 + i * 2] & 15];
    if (!d || !a) fail('scan uses a missing Huffman table');
    order.push(ci);
    dcTables[ci] = d;
    acTables[ci] = a;
  }
  const at = 1 + count * 2;
  if (seg[at] !== 0 || seg[at + 1] !== 63 || seg[at + 2] !== 0) fail('not a sequential scan');
  const reader = new BitReader(bytes, dataPos);
  const pred = new Int32Array(frame.comps.length);
  forEachBlock(frame, order, (ci, block) => {
    const coefs = frame.comps[ci].coefs;
    const base = block * 64;
    const t = reader.decode(dcTables[ci]);
    if (t > 11) fail('bad DC value');
    pred[ci] += t === 0 ? 0 : extend(reader.read(t), t);
    coefs[base] = pred[ci];
    const acTable = acTables[ci];
    for (let k = 1; k < 64; ) {
      const rs = reader.decode(acTable);
      const r = rs >> 4;
      const s = rs & 15;
      if (s === 0) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) fail('bad AC run');
      coefs[base + k] = extend(reader.read(s), s);
      k++;
    }
  });
}

function buildEncodeTable(spec: HuffSpec): EncodeTable {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let next = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < spec.bits[len - 1]; i++, k++, next++) {
      code[spec.vals[k]] = next;
      size[spec.vals[k]] = len;
    }
    next <<= 1;
  }
  return { code, size };
}

// ----- output -----

class ByteSink {
  private data = new Uint8Array(1 << 16);
  length = 0;

  private grow(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  byte(value: number): void {
    this.grow(1);
    this.data[this.length++] = value;
  }

  bytes(values: ArrayLike<number>): void {
    this.grow(values.length);
    this.data.set(values, this.length);
    this.length += values.length;
  }

  marker(marker: number, payload: ArrayLike<number>): void {
    this.bytes([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
    this.bytes(payload);
  }
}

class BitWriter {
  private buf = 0;
  private cnt = 0;
  private readonly sink: ByteSink;

  constructor(sink: ByteSink) {
    this.sink = sink;
  }

  put(value: number, size: number): void {
    if (size === 0) return;
    this.buf = (this.buf << size) | (value & ((1 << size) - 1));
    this.cnt += size;
    while (this.cnt >= 8) {
      const byte = (this.buf >>> (this.cnt - 8)) & 0xff;
      this.sink.byte(byte);
      if (byte === 0xff) this.sink.byte(0);
      this.cnt -= 8;
      this.buf &= (1 << this.cnt) - 1;
    }
  }

  flush(): void {
    if (this.cnt > 0) this.put((1 << (8 - this.cnt)) - 1, 8 - this.cnt);
  }
}

/** Writes the one interleaved baseline scan; Huffman slots are DC 0/1 and AC 2/3, slot 0/2 for the first component. */
class BaselineCoder {
  private readonly writer: BitWriter;
  private readonly tables: readonly EncodeTable[];
  private readonly lastDc: Int32Array;

  constructor(writer: BitWriter, tables: readonly EncodeTable[], components: number) {
    this.writer = writer;
    this.tables = tables;
    this.lastDc = new Int32Array(components);
  }

  private symbol(slot: number, value: number): void {
    const table = this.tables[slot];
    const size = table.size[value];
    if (size === 0) fail('symbol missing from the Huffman table');
    this.writer.put(table.code[value], size);
  }

  private magnitude(value: number): { nbits: number; bits: number } {
    const abs = Math.abs(value);
    return { nbits: bitLength(abs), bits: value < 0 ? value - 1 : value };
  }

  block(coefs: Int16Array, base: number, ci: number): void {
    const slot = ci === 0 ? 0 : 1;
    const dc = this.magnitude(coefs[base] - this.lastDc[ci]);
    this.lastDc[ci] = coefs[base];
    this.symbol(slot, dc.nbits);
    this.writer.put(dc.bits, dc.nbits);
    let r = 0;
    for (let k = 1; k < 64; k++) {
      const value = coefs[base + k];
      if (value === 0) {
        r++;
        continue;
      }
      while (r > 15) {
        this.symbol(slot + 2, 0xf0);
        r -= 16;
      }
      const ac = this.magnitude(value);
      this.symbol(slot + 2, (r << 4) + ac.nbits);
      this.writer.put(ac.bits, ac.nbits);
      r = 0;
    }
    if (r > 0) this.symbol(slot + 2, 0);
  }
}

function dhtPayload(entries: { tc: number; th: number; spec: HuffSpec }[]): number[] {
  const out: number[] = [];
  for (const { tc, th, spec } of entries) {
    out.push((tc << 4) | th, ...spec.bits, ...spec.vals);
  }
  return out;
}

function sofPayload(frame: Frame): number[] {
  const out = [8, frame.height >> 8, frame.height & 0xff, frame.width >> 8, frame.width & 0xff, frame.comps.length];
  for (const c of frame.comps) out.push(c.id, (c.h << 4) | c.v, c.tq);
  return out;
}

function sosPayload(frame: Frame): number[] {
  const out = [frame.comps.length];
  frame.comps.forEach((c, ci) => out.push(c.id, ci === 0 ? 0x00 : 0x11));
  out.push(0, 63, 0);
  return out;
}

/**
 * The byte count of the coefficients of a baseline JPEG in one baseline scan with the standard Huffman tables.
 * Throws `encode-failed` on a file that it cannot read.
 */
export function plainJpegSize(bytes: Uint8Array): number {
  const { frame, keep } = parseBaseline(bytes);
  const slots = frame.comps.length === 3 ? [0, 1] : [0];
  const sink = new ByteSink();
  sink.bytes([0xff, 0xd8]);
  for (const seg of keep) sink.bytes(seg);
  sink.marker(0xc0, sofPayload(frame));
  const specs = STANDARD_TABLES;
  sink.marker(0xc4, dhtPayload([...slots.map((th) => ({ tc: 0, th, spec: specs[th] })), ...slots.map((th) => ({ tc: 1, th, spec: specs[th + 2] }))]));
  sink.marker(0xda, sosPayload(frame));
  const writer = new BitWriter(sink);
  const coder = new BaselineCoder(writer, specs.map(buildEncodeTable), frame.comps.length);
  forEachBlock(frame, frame.comps.map((_, i) => i), (ci, block) => coder.block(frame.comps[ci].coefs, block * 64, ci));
  writer.flush();
  sink.bytes([0xff, 0xd9]);
  return sink.length;
}
