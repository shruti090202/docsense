// Verhoeff checksum, used by UIDAI for the 12th digit of an Aadhaar number.
const d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

const p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

function digitsOf(value: string): number[] {
  return value.split('').map((ch) => Number(ch));
}

export function verhoeffValidate(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  let c = 0;
  const digits = digitsOf(value).reverse();
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i]!;
    c = d[c]![p[i % 8]![digit]!]!;
  }
  return c === 0;
}

export function verhoeffGenerate(value: string): string {
  if (!/^\d+$/.test(value)) throw new RangeError('digits only');
  let c = 0;
  const digits = digitsOf(value).reverse();
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i]!;
    c = d[c]![p[(i + 1) % 8]![digit]!]!;
  }
  return String(inv[c]);
}
