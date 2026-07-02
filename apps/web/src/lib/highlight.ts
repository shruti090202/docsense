// Decides which text-layer runs belong to a cited chunk. The server rebuilt chunk text from the same
// pdf.js runs the viewer renders, so a run that appears verbatim in the chunk is part of the passage.

export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface Matcher {
  matches(run: string): boolean;
}

export function buildMatcher(chunkText: string): Matcher {
  const haystack = normalise(chunkText);
  return {
    matches(run: string): boolean {
      const needle = normalise(run);
      // very short runs (page numbers, single words) would light up unrelated lines
      if (needle.length < 12) return false;
      return haystack.includes(needle);
    },
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
