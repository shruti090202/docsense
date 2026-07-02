import type { Citation } from '@docsense/shared';

interface ChipProps {
  citation: Citation;
  onSelect: (c: Citation) => void;
  label?: string;
}

export function CitationChip({ citation, onSelect, label }: ChipProps) {
  const pages = citation.pageEnd && citation.pageEnd !== citation.page ? `p. ${citation.page}–${citation.pageEnd}` : `p. ${citation.page}`;
  return (
    <button type="button" className="cite" title={citation.clauseTitle ?? pages} onClick={() => onSelect(citation)}>
      {label ?? (citation.ref !== undefined ? `[${citation.ref}] ${pages}` : pages)}
    </button>
  );
}

// Renders answer text with [n] markers turned into clickable chips.
export function CitedText({ text, citations, onSelect }: { text: string; citations: Citation[]; onSelect: (c: Citation) => void }) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const parts = text.split(/(\[\d+(?:,\s*\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[(\d+(?:,\s*\d+)*)\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        return (
          <span key={i}>
            {m[1]!.split(',').map((n) => {
              const c = byRef.get(Number(n.trim()));
              return c ? <CitationChip key={n} citation={c} onSelect={onSelect} label={`[${n.trim()}]`} /> : null;
            })}
          </span>
        );
      })}
    </>
  );
}

export function CitationList({ citations, onSelect, unmask }: { citations: Citation[]; onSelect: (c: Citation) => void; unmask: (s: string) => string }) {
  if (!citations.length) return null;
  return (
    <div className="cite-list">
      {citations.map((c) => (
        <button key={`${c.ref}-${c.chunkId}`} type="button" onClick={() => onSelect(c)}>
          <CitationChip citation={c} onSelect={onSelect} /> {c.clauseTitle ? <b>{c.clauseTitle}</b> : null}{' '}
          <span className="quote">“{unmask(c.quote)}”</span>
        </button>
      ))}
    </div>
  );
}
