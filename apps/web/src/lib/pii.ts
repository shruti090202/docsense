import type { PiiMap } from '@docsense/shared';

// Mirrors the server's unmask: the placeholder map only ever lives in this browser tab.
export function unmask(text: string, map: PiiMap): string {
  let out = text;
  for (const [placeholder, original] of Object.entries(map)) {
    const bare = placeholder.slice(1, -1);
    out = out.split(placeholder).join(original);
    out = out.replace(new RegExp(`(?<![A-Z0-9_])${bare}(?![A-Z0-9_])`, 'g'), original);
  }
  return out;
}

export function piiSummary(map: PiiMap): string {
  const counts = new Map<string, number>();
  for (const key of Object.keys(map)) {
    const type = key.slice(1, key.indexOf('_')).toLowerCase();
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) return 'no personal identifiers found';
  return [...counts.entries()].map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ');
}
