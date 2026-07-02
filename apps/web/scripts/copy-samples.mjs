// Copies the fictional sample PDFs into public/ so the viewer can load them like a local upload.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../../samples/pdf');
const dest = path.resolve(here, '../public/samples');
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith('.pdf')) copyFileSync(path.join(src, f), path.join(dest, f));
