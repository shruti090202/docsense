import { describe, expect, it } from 'vitest';
import { verhoeffGenerate, verhoeffValidate } from '../src/privacy/verhoeff.js';

describe('verhoeff', () => {
  it('validates the canonical reference value 2363', () => {
    expect(verhoeffValidate('2363')).toBe(true);
    expect(verhoeffGenerate('236')).toBe('3');
  });

  it('round-trips generated check digits', () => {
    for (const base of ['53187204691', '62039471852', '12345678901', '99999999999', '1']) {
      expect(verhoeffValidate(base + verhoeffGenerate(base))).toBe(true);
    }
  });

  it('detects single-digit substitutions and adjacent transpositions', () => {
    const valid = '53187204691' + verhoeffGenerate('53187204691');
    const swapped = valid.slice(0, 3) + valid[4] + valid[3] + valid.slice(5);
    expect(verhoeffValidate(swapped)).toBe(false);
    const substituted = valid.slice(0, 6) + String((Number(valid[6]) + 1) % 10) + valid.slice(7);
    expect(verhoeffValidate(substituted)).toBe(false);
  });

  it('rejects non-digit input', () => {
    expect(verhoeffValidate('12a4')).toBe(false);
    expect(verhoeffValidate('')).toBe(false);
    expect(() => verhoeffGenerate('12 3')).toThrow(RangeError);
  });
});
