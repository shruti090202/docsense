import { describe, expect, it } from 'vitest';
import { emiFlat, emiReducing, round2 } from '../src/finance/emi.js';

describe('emiReducing', () => {
  it('matches the textbook value for 10L @ 10% over 60 months', () => {
    expect(round2(emiReducing(1_000_000, 10, 60))).toBe(21247.04);
  });
  it('matches a home-loan style case: 50L @ 8.5% over 240 months', () => {
    expect(round2(emiReducing(5_000_000, 8.5, 240))).toBe(43391.16);
  });
  it('falls back to straight division at 0%', () => {
    expect(emiReducing(120_000, 0, 12)).toBe(10_000);
  });
  it('rejects non-positive inputs', () => {
    expect(() => emiReducing(0, 10, 12)).toThrow(RangeError);
    expect(() => emiReducing(1000, 10, 0)).toThrow(RangeError);
  });
});

describe('emiFlat', () => {
  it('charges interest on the full principal for the whole tenure', () => {
    // 1L @ 12% flat for 12 months: interest 12,000 -> (100,000 + 12,000) / 12
    expect(round2(emiFlat(100_000, 12, 12))).toBe(9333.33);
  });
});
