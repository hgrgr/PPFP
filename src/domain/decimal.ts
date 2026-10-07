/**
 * Exact fixed-point decimal on top of BigInt.
 *
 * Money and quantities must never go through floating point. Every value is
 * stored as an integer scaled by 10^SCALE. Results of multiplication and
 * division are rounded half away from zero back to SCALE digits.
 *
 * Kept dependency-free on purpose so the whole domain layer can be unit
 * tested without installing anything.
 */

const SCALE = 12;
const FACTOR = 10n ** BigInt(SCALE);

export type DecInput = Dec | string | number | bigint;

function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('Division by zero');
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r * 2n >= ad) q += 1n;
  return negative ? -q : q;
}

function parse(text: string): bigint {
  const s = text.trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
    throw new SyntaxError(`Invalid decimal: "${text}"`);
  }
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] || '0';
  const fracPart = m[3] ?? '';
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  // digits as an integer, with `fracPart.length - exp` decimal places
  const digits = BigInt(intPart + fracPart);
  const places = fracPart.length - exp;
  let raw: bigint;
  if (places <= SCALE) {
    raw = digits * 10n ** BigInt(SCALE - places);
  } else {
    raw = divRound(digits, 10n ** BigInt(places - SCALE));
  }
  return sign * raw;
}

export class Dec {
  static readonly SCALE = SCALE;
  static readonly ZERO = new Dec(0n);
  static readonly ONE = new Dec(FACTOR);

  private constructor(readonly raw: bigint) {}

  static of(v: DecInput): Dec {
    if (v instanceof Dec) return v;
    if (typeof v === 'bigint') return new Dec(v * FACTOR);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new RangeError(`Non-finite number: ${v}`);
      if (Number.isSafeInteger(v)) return new Dec(BigInt(v) * FACTOR);
      return new Dec(parse(v.toPrecision(15)));
    }
    return new Dec(parse(v));
  }

  /** Accepts null/undefined/'' and returns fallback (default zero). */
  static maybe(v: DecInput | null | undefined, fallback: Dec = Dec.ZERO): Dec {
    if (v === null || v === undefined || v === '') return fallback;
    return Dec.of(v);
  }

  static fromRaw(raw: bigint): Dec {
    return new Dec(raw);
  }

  static sum(values: Iterable<DecInput>): Dec {
    let acc = 0n;
    for (const v of values) acc += Dec.of(v).raw;
    return new Dec(acc);
  }

  static max(a: DecInput, b: DecInput): Dec {
    const x = Dec.of(a), y = Dec.of(b);
    return x.gte(y) ? x : y;
  }

  static min(a: DecInput, b: DecInput): Dec {
    const x = Dec.of(a), y = Dec.of(b);
    return x.lte(y) ? x : y;
  }

  add(v: DecInput): Dec { return new Dec(this.raw + Dec.of(v).raw); }
  sub(v: DecInput): Dec { return new Dec(this.raw - Dec.of(v).raw); }
  mul(v: DecInput): Dec { return new Dec(divRound(this.raw * Dec.of(v).raw, FACTOR)); }
  div(v: DecInput): Dec { return new Dec(divRound(this.raw * FACTOR, Dec.of(v).raw)); }
  neg(): Dec { return new Dec(-this.raw); }
  abs(): Dec { return this.raw < 0n ? this.neg() : this; }

  cmp(v: DecInput): -1 | 0 | 1 {
    const o = Dec.of(v).raw;
    return this.raw < o ? -1 : this.raw > o ? 1 : 0;
  }
  eq(v: DecInput): boolean { return this.cmp(v) === 0; }
  lt(v: DecInput): boolean { return this.cmp(v) < 0; }
  lte(v: DecInput): boolean { return this.cmp(v) <= 0; }
  gt(v: DecInput): boolean { return this.cmp(v) > 0; }
  gte(v: DecInput): boolean { return this.cmp(v) >= 0; }
  isZero(): boolean { return this.raw === 0n; }
  isNeg(): boolean { return this.raw < 0n; }
  isPos(): boolean { return this.raw > 0n; }

  /** Round to `dp` decimal places, half away from zero. */
  round(dp: number): Dec {
    if (dp >= SCALE) return this;
    const unit = 10n ** BigInt(SCALE - dp);
    return new Dec(divRound(this.raw, unit) * unit);
  }

  /** Round toward zero to `dp` decimal places. */
  truncate(dp: number): Dec {
    if (dp >= SCALE) return this;
    const unit = 10n ** BigInt(SCALE - dp);
    return new Dec((this.raw / unit) * unit);
  }

  /** Plain string without exponent and without trailing zeros. */
  toString(): string {
    const neg = this.raw < 0n;
    const a = neg ? -this.raw : this.raw;
    const int = a / FACTOR;
    let frac = (a % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + int.toString() + (frac ? '.' + frac : '');
  }

  toFixed(dp: number): string {
    const r = this.round(dp);
    const neg = r.raw < 0n;
    const a = neg ? -r.raw : r.raw;
    const int = a / FACTOR;
    if (dp <= 0) return (neg && int !== 0n ? '-' : '') + int.toString();
    const frac = (a % FACTOR).toString().padStart(SCALE, '0').slice(0, dp);
    const isZero = int === 0n && /^0*$/.test(frac);
    return (neg && !isZero ? '-' : '') + int.toString() + '.' + frac;
  }

  toNumber(): number {
    return Number(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

export const D = Dec.of;
