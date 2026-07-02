import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@docsense/shared';
import { CitationList, CitedText } from '../src/components/Citations.jsx';

const citations: Citation[] = [
  { ref: 1, chunkId: 'c1', page: 3, pageEnd: 3, clauseTitle: '9. PREPAYMENT', quote: 'Prepayment charge of 4% [PAN_1].' },
  { ref: 2, chunkId: 'c2', page: 1, pageEnd: 2, clauseTitle: null, quote: 'Interest at 14%.' },
];

describe('CitedText', () => {
  it('turns [n] markers into clickable chips that report the citation', () => {
    const onSelect = vi.fn();
    render(<CitedText text="Prepayment costs 4% [1] and interest is 14% [2, 1]." citations={citations} onSelect={onSelect} />);
    const chips = screen.getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['[1]', '[2]', '[1]']);
    fireEvent.click(chips[1]!);
    expect(onSelect).toHaveBeenCalledWith(citations[1]);
  });

  it('drops markers without a matching citation', () => {
    render(<CitedText text="Unknown [9] here." citations={citations} onSelect={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });
});

describe('CitationList', () => {
  it('shows page ranges, clause titles and unmasked quotes', () => {
    render(<CitationList citations={citations} onSelect={() => undefined} unmask={(s) => s.replace('[PAN_1]', 'AKLPM4821R')} />);
    expect(screen.getByText('[1] p. 3')).toBeInTheDocument();
    expect(screen.getByText('[2] p. 1–2')).toBeInTheDocument();
    expect(screen.getByText('9. PREPAYMENT')).toBeInTheDocument();
    expect(screen.getByText(/AKLPM4821R/)).toBeInTheDocument();
  });
});
