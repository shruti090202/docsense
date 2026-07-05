import { describe, expect, it } from 'vitest';
import { fee, money, months, percent } from '../src/lib/format.js';
import { buildMatcher, escapeHtml, normalise } from '../src/lib/highlight.js';
import { piiSummary, unmask } from '../src/lib/pii.js';
import { reducer, type LoadedDoc, type State } from '../src/state/store.js';

describe('unmask', () => {
  const map = { '[PAN_1]': 'AKLPM4821R', '[PHONE_1]': '98201 44710' };
  it('restores placeholders with and without brackets', () => {
    expect(unmask('PAN [PAN_1], phone [PHONE_1]', map)).toBe('PAN AKLPM4821R, phone 98201 44710');
    expect(unmask('the PAN_1 is', map)).toBe('the AKLPM4821R is');
    expect(unmask('XPAN_1 stays', map)).toBe('XPAN_1 stays');
  });
  it('summarises what was masked', () => {
    expect(piiSummary(map)).toBe('1 pan, 1 phone');
    expect(piiSummary({ '[EMAIL_1]': 'a', '[EMAIL_2]': 'b' })).toBe('2 emails');
    expect(piiSummary({})).toBe('no personal identifiers found');
  });
});

describe('highlight matcher', () => {
  const chunk = '9. PREPAYMENT AND FORECLOSURE\nThe Borrower may prepay or foreclose the Loan subject to payment of a prepayment charge of 4% of the principal outstanding plus applicable taxes.';
  const m = buildMatcher(chunk);
  it('matches text-layer runs that appear in the chunk regardless of whitespace and case', () => {
    expect(m.matches('The Borrower may prepay or foreclose the Loan subject to payment of a prepayment charge of 4% of')).toBe(true);
    expect(m.matches('  the principal outstanding plus applicable   taxes.')).toBe(true);
    expect(m.matches('9. PREPAYMENT AND FORECLOSURE')).toBe(true);
  });
  it('ignores short runs and unrelated lines', () => {
    expect(m.matches('Page 3 of 5')).toBe(false);
    expect(m.matches('the')).toBe(false);
    expect(m.matches('Interest shall accrue on the Loan at a fixed rate of 14% per annum')).toBe(false);
  });
  it('normalises and escapes', () => {
    expect(normalise('  A  b\nC ')).toBe('a b c');
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
  });
});

describe('formatters', () => {
  it('formats Indian currency, percentages, tenure and fees', () => {
    expect(money(500000, true)).toBe('₹5,00,000');
    expect(money(17088.81)).toBe('₹17,088.81');
    expect(money(null)).toBe('—');
    expect(percent(17.97)).toBe('17.97%');
    expect(months(36)).toBe('36 months (3 yrs)');
    expect(months(84)).toBe('84 months (7 yrs)');
    expect(months(18)).toBe('18 months (1 yr 6 mo)');
    expect(fee({ amount: null, percent: 2, notFound: false })).toBe('2%');
    expect(fee({ amount: 500, percent: null, notFound: false })).toBe('₹500.00');
    expect(fee({ amount: 0, percent: 0, notFound: false })).toBe('Nil');
    expect(fee({ amount: null, percent: null, notFound: true })).toBe('Not stated');
  });
});

describe('store reducer', () => {
  const doc = (id: string): LoadedDoc => ({
    id,
    title: id,
    sourceType: 'pdf',
    kind: 'loan',
    pageCount: 1,
    chunkCount: 1,
    isSample: false,
    piiMap: {},
    file: new Blob(),
    warnings: [],
    terms: null,
    cost: null,
    contractFacts: null,
    outline: null,
    risks: null,
    analysis: 'idle',
    chat: [],
    highlight: null,
  });
  const empty: State = { docs: {}, order: [], view: { kind: 'home' }, toast: null };

  it('adds documents, switches view and keeps order stable on re-add', () => {
    let s = reducer(empty, { type: 'doc/add', doc: doc('a') });
    s = reducer(s, { type: 'doc/add', doc: doc('b') });
    s = reducer(s, { type: 'doc/add', doc: { ...doc('a'), piiMap: { '[PAN_1]': 'X' } } });
    expect(s.order).toEqual(['a', 'b']);
    expect(s.view).toEqual({ kind: 'document', id: 'a' });
    expect(s.docs['a']!.piiMap).toEqual({ '[PAN_1]': 'X' });
  });

  it('removes a document and falls back to home when it was active', () => {
    let s = reducer(empty, { type: 'doc/add', doc: doc('a') });
    s = reducer(s, { type: 'doc/remove', id: 'a' });
    expect(s.order).toEqual([]);
    expect(s.view).toEqual({ kind: 'home' });
  });

  it('updates chat messages in place', () => {
    let s = reducer(empty, { type: 'doc/add', doc: doc('a') });
    s = reducer(s, { type: 'chat/append', id: 'a', message: { id: 'm1', role: 'assistant', content: '', pending: true } });
    s = reducer(s, { type: 'chat/update', id: 'a', messageId: 'm1', patch: { content: 'done', pending: false, cached: true } });
    expect(s.docs['a']!.chat[0]).toMatchObject({ content: 'done', pending: false, cached: true });
    expect(reducer(s, { type: 'chat/append', id: 'missing', message: { id: 'x', role: 'user', content: 'q' } })).toBe(s);
  });
});
