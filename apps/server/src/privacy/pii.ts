import { verhoeffValidate, type PiiMap, type PiiType } from '@docsense/shared';

export interface PiiMatch {
  type: PiiType;
  start: number;
  end: number;
  value: string;
}

export interface MaskResult {
  text: string;
  map: PiiMap;
  counts: Record<PiiType, number>;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 5 letters (4th = holder type), 4 digits, 1 letter
const PAN = /(?<![A-Z0-9])[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z](?![A-Z0-9])/g;
const IFSC = /(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/g;
// 12 digits, optionally grouped 4-4-4, first digit 2-9; confirmed by the Verhoeff checksum
const AADHAAR = /(?<![\d-])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?![\d-])/g;
const PHONE = /(?<![\d.])(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d.])/g;
const ACCOUNT =
  /(?:account|a\/c|acct)\.?\s*(?:number|num|no\.?|#)?\s*[:\-]?\s*(\d[\d\s-]{7,24}\d)(?![\d])/gi;

// currency markers immediately before a number mean it is an amount, not a phone number
const AMOUNT_PREFIX = /(?:₹|rs\.?|inr|rupees)\s*$/i;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function collect(text: string, re: RegExp, type: PiiType, group = 0): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[group];
    if (value === undefined) continue;
    const offset = group === 0 ? 0 : m[0].indexOf(value);
    const start = m.index + offset;
    out.push({ type, start, end: start + value.length, value });
  }
  return out;
}

export function detectPii(text: string): PiiMatch[] {
  const candidates: PiiMatch[] = [
    ...collect(text, EMAIL, 'EMAIL'),
    ...collect(text, PAN, 'PAN'),
    ...collect(text, IFSC, 'IFSC'),
    ...collect(text, AADHAAR, 'AADHAAR').filter((m) => verhoeffValidate(digitsOnly(m.value))),
    ...collect(text, ACCOUNT, 'ACCOUNT', 1).filter((m) => {
      const n = digitsOnly(m.value).length;
      return n >= 9 && n <= 18;
    }),
    ...collect(text, PHONE, 'PHONE').filter((m) => !AMOUNT_PREFIX.test(text.slice(Math.max(0, m.start - 8), m.start))),
  ];

  // Longest/earliest span wins so an Aadhaar is never partially re-matched as a phone number.
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: PiiMatch[] = [];
  let cursor = -1;
  for (const c of candidates) {
    if (c.start < cursor) continue;
    accepted.push(c);
    cursor = c.end;
  }
  return accepted;
}

function normalise(type: PiiType, value: string): string {
  switch (type) {
    case 'EMAIL':
      return value.toLowerCase();
    case 'PAN':
    case 'IFSC':
      return value.toUpperCase();
    default: {
      const digits = digitsOnly(value);
      // +91 / leading 0 are dialling prefixes, not part of the identity
      return type === 'PHONE' ? digits.slice(-10) : digits;
    }
  }
}

export class PiiMasker {
  private readonly byKey = new Map<string, string>();
  private readonly counters: Record<PiiType, number> = {
    AADHAAR: 0,
    PAN: 0,
    IFSC: 0,
    ACCOUNT: 0,
    PHONE: 0,
    EMAIL: 0,
  };
  readonly map: PiiMap = {};

  // A masker can be seeded so a follow-up question reuses the placeholders issued at upload time.
  constructor(existing?: PiiMap) {
    if (!existing) return;
    for (const [placeholder, original] of Object.entries(existing)) {
      const type = placeholder.slice(1, placeholder.indexOf('_')) as PiiType;
      const n = Number(placeholder.slice(placeholder.indexOf('_') + 1, -1));
      if (!(type in this.counters) || !Number.isInteger(n)) continue;
      this.map[placeholder] = original;
      this.byKey.set(`${type}:${normalise(type, original)}`, placeholder);
      this.counters[type] = Math.max(this.counters[type], n);
    }
  }

  private placeholderFor(type: PiiType, value: string): string {
    const key = `${type}:${normalise(type, value)}`;
    const known = this.byKey.get(key);
    if (known) return known;
    this.counters[type] += 1;
    const placeholder = `[${type}_${this.counters[type]}]`;
    this.byKey.set(key, placeholder);
    this.map[placeholder] = value;
    return placeholder;
  }

  mask(text: string): MaskResult {
    const matches = detectPii(text);
    const counts: Record<PiiType, number> = { AADHAAR: 0, PAN: 0, IFSC: 0, ACCOUNT: 0, PHONE: 0, EMAIL: 0 };
    let out = '';
    let last = 0;
    for (const m of matches) {
      out += text.slice(last, m.start) + this.placeholderFor(m.type, m.value);
      counts[m.type] += 1;
      last = m.end;
    }
    out += text.slice(last);
    return { text: out, map: { ...this.map }, counts };
  }
}

export function unmask(text: string, map: PiiMap): string {
  let out = text;
  for (const [placeholder, original] of Object.entries(map)) {
    const bare = placeholder.slice(1, -1);
    out = out.split(placeholder).join(original);
    // models occasionally drop the brackets; only replace whole tokens
    out = out.replace(new RegExp(`(?<![A-Z0-9_])${bare}(?![A-Z0-9_])`, 'g'), original);
  }
  return out;
}
