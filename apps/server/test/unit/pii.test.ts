import { verhoeffGenerate } from '@docsense/shared';
import { describe, expect, it } from 'vitest';
import { PiiMasker, detectPii, unmask } from '../../src/privacy/pii.js';

const validAadhaar = (base: string) => base + verhoeffGenerate(base);
const AADHAAR = validAadhaar('53187204691');
const AADHAAR_GROUPED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;
const AADHAAR_INVALID = AADHAAR.slice(0, 11) + String((Number(AADHAAR[11]) + 1) % 10);

function types(text: string) {
  return detectPii(text).map((m) => [m.type, m.value]);
}

describe('detectPii positive cases', () => {
  it.each([
    ['PAN in prose', 'holding PAN AKLPM4821R issued', [['PAN', 'AKLPM4821R']]],
    ['PAN company holder type', 'PAN: AABCT1234F', [['PAN', 'AABCT1234F']]],
    ['IFSC', 'IFSC code HDFC0001234 of the branch', [['IFSC', 'HDFC0001234']]],
    ['IFSC with digits in branch code', 'IFSC: SBIN0A12B34', [['IFSC', 'SBIN0A12B34']]],
    ['Aadhaar plain', `Aadhaar ${AADHAAR}.`, [['AADHAAR', AADHAAR]]],
    ['Aadhaar grouped by spaces', `Aadhaar number ${AADHAAR_GROUPED} is`, [['AADHAAR', AADHAAR_GROUPED]]],
    ['Aadhaar grouped by hyphens', `UID ${AADHAAR.slice(0, 4)}-${AADHAAR.slice(4, 8)}-${AADHAAR.slice(8)} end`, [['AADHAAR', `${AADHAAR.slice(0, 4)}-${AADHAAR.slice(4, 8)}-${AADHAAR.slice(8)}`]]],
    ['phone plain', 'call 9820144710 today', [['PHONE', '9820144710']]],
    ['phone with +91 and space', 'mobile +91 98201 44710', [['PHONE', '+91 98201 44710']]],
    ['phone with +91 and hyphens', 'tel +91-81234-56780', [['PHONE', '+91-81234-56780']]],
    ['phone with leading zero', 'landline-style 09876543210', [['PHONE', '09876543210']]],
    ['email', 'write to rohan.mehra@example.co.in for', [['EMAIL', 'rohan.mehra@example.co.in']]],
    ['email with plus tag', 'x+loans@mail.example.com', [['EMAIL', 'x+loans@mail.example.com']]],
    ['account number with label', 'credited to account number 30412298765 held', [['ACCOUNT', '30412298765']]],
    ['A/c No. label', 'A/c No. 110022334455 at', [['ACCOUNT', '110022334455']]],
    ['Acct # label', 'Acct # 5020011122233', [['ACCOUNT', '5020011122233']]],
    ['account with spaces', 'Account No: 5020 0111 2223 3', [['ACCOUNT', '5020 0111 2223 3']]],
  ])('%s', (_name, text, expected) => {
    expect(types(text)).toEqual(expected);
  });

  it('finds several identifiers in one passage in document order', () => {
    const text = `Borrower PAN AKLPM4821R, Aadhaar ${AADHAAR_GROUPED}, phone 9820144710, email a@b.io, account number 30412298765, IFSC MRDN0004521.`;
    expect(types(text).map((t) => t[0])).toEqual(['PAN', 'AADHAAR', 'PHONE', 'EMAIL', 'ACCOUNT', 'IFSC']);
  });
});

describe('detectPii negative cases', () => {
  it.each([
    ['loan amount with commas', 'a sum of Rs. 5,00,000 (Rupees Five Lakh only)'],
    ['plain rupee amount of 10 digits', 'Rs. 9500000000 sanctioned'],
    ['INR-prefixed 10 digit amount', 'INR 8000000000 outstanding'],
    ['12-digit number failing the checksum', `reference ${AADHAAR_INVALID} noted`],
    ['12-digit number starting with 1', 'ref 123456789012 noted'],
    ['13-digit number that embeds a phone-like run', 'invoice 9820144710123 issued'],
    ['date', 'executed on 12/03/2026 at Mumbai'],
    ['section numbers', 'see Section 5.2 and Clause 7.3.1'],
    ['percentage', 'interest at 14.50% per annum'],
    ['PAN-like word with wrong holder type', 'code ABCDE1234F is not a PAN'],
    ['lowercase pan-shaped text', 'aklpm4821r'],
    ['IFSC-shaped with non-zero fifth char', 'HDFC1001234'],
    ['plain number without account context', 'the figure 30412298765 appears'],
    ['phone starting with 5', '5820144710'],
    ['email without TLD', 'user@localhost'],
    ['CIN-like string', 'CIN U65999MH2010PLC123456'],
    ['GST rate text', 'GST at 18% applies'],
    ['pin code', 'Mumbai 400053'],
  ])('%s', (_name, text) => {
    expect(detectPii(text)).toEqual([]);
  });
});

describe('PiiMasker', () => {
  it('replaces identifiers with typed, numbered placeholders and returns the map', () => {
    const masker = new PiiMasker();
    const { text, map, counts } = masker.mask(`PAN AKLPM4821R, phone 9820144710, PAN AKLPM4821R again, other PAN BQRPI7734K.`);
    expect(text).toBe('PAN [PAN_1], phone [PHONE_1], PAN [PAN_1] again, other PAN [PAN_2].');
    expect(map).toEqual({ '[PAN_1]': 'AKLPM4821R', '[PHONE_1]': '9820144710', '[PAN_2]': 'BQRPI7734K' });
    expect(counts.PAN).toBe(3);
    expect(counts.PHONE).toBe(1);
  });

  it('treats formatting variants of the same identifier as one placeholder', () => {
    const masker = new PiiMasker();
    const { text } = masker.mask(`${AADHAAR} and ${AADHAAR_GROUPED}; +91 98201 44710 and 9820144710; a@B.io and A@b.IO`);
    expect(text).toBe('[AADHAAR_1] and [AADHAAR_1]; [PHONE_1] and [PHONE_1]; [EMAIL_1] and [EMAIL_1]');
  });

  it('keeps numbering stable across pages of the same document', () => {
    const masker = new PiiMasker();
    masker.mask('page one PAN AKLPM4821R');
    const second = masker.mask('page two PAN BQRPI7734K and PAN AKLPM4821R');
    expect(second.text).toBe('page two PAN [PAN_2] and PAN [PAN_1]');
  });

  it('can be seeded from an earlier map so questions reuse upload-time placeholders', () => {
    const seeded = new PiiMasker({ '[PAN_1]': 'AKLPM4821R', '[PHONE_3]': '9820144710' });
    const { text, map } = seeded.mask('Is AKLPM4821R the borrower and 9820144710 the number? New one: ZZZPQ9999Z');
    expect(text).toBe('Is [PAN_1] the borrower and [PHONE_3] the number? New one: [PAN_2]');
    expect(map['[PAN_2]']).toBe('ZZZPQ9999Z');
  });

  it('never leaves raw identifiers in masked output', () => {
    const raw = `PAN AKLPM4821R Aadhaar ${AADHAAR_GROUPED} phone +91 98201 44710 email rohan@example.com account number 30412298765 IFSC MRDN0004521`;
    const { text } = new PiiMasker().mask(raw);
    for (const secret of ['AKLPM4821R', AADHAAR, '44710', 'rohan@example.com', '30412298765', 'MRDN0004521']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('unmask', () => {
  const map = { '[PAN_1]': 'AKLPM4821R', '[PHONE_1]': '9820144710' };

  it('restores originals for bracketed placeholders', () => {
    expect(unmask('Borrower [PAN_1] can be reached at [PHONE_1].', map)).toBe('Borrower AKLPM4821R can be reached at 9820144710.');
  });

  it('restores originals when a model drops the brackets but not inside other tokens', () => {
    expect(unmask('The PAN_1 belongs to the borrower; XPAN_1 stays.', map)).toBe('The AKLPM4821R belongs to the borrower; XPAN_1 stays.');
  });

  it('is a no-op with an empty map', () => {
    expect(unmask('nothing here [PAN_9]', {})).toBe('nothing here [PAN_9]');
  });
});
