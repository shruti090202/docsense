const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function money(n: number | null | undefined, whole = false): string {
  if (n === null || n === undefined) return '—';
  return (whole ? inrWhole : inr).format(n);
}

export function percent(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(digits)}%`;
}

export function months(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const y = Math.floor(n / 12);
  const m = n % 12;
  const parts = [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean);
  return `${n} months${parts.length ? ` (${parts.join(' ')})` : ''}`;
}

export function fee(f: { amount: number | null; percent: number | null; notFound: boolean; description?: string | null }): string {
  if (f.notFound) return 'Not stated';
  if (f.amount === 0 && (f.percent === 0 || f.percent === null)) return 'Nil';
  const parts: string[] = [];
  if (f.percent !== null && f.percent > 0) parts.push(`${f.percent}%`);
  if (f.amount !== null && f.amount > 0) parts.push(money(f.amount));
  return parts.length ? parts.join(' / ') : (f.description ?? 'Stated');
}
