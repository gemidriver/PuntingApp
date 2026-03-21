import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TZ = 'Australia/Sydney';
const BASE = '0.1';

const now = new Date();
const parts = new Intl.DateTimeFormat('en-AU', {
  timeZone: TZ,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).formatToParts(now);

const part = (type) => parts.find((p) => p.type === type)?.value ?? '';

const month = String(Number(part('month')));
const day = String(Number(part('day')));
const hour = part('hour').padStart(2, '0');
const minute = part('minute').padStart(2, '0');
const hhmm = `${hour}${minute}`;

const version = `${BASE}.${month}.${day}.${hhmm}`;
const label = `The Top Punter | v ${version}`;

const outPath = resolve(process.cwd(), 'app', 'version.ts');
mkdirSync(dirname(outPath), { recursive: true });

const file = `// Auto-generated at build time by scripts/generate-version.mjs\n` +
  `// Timezone used for version stamp: ${TZ}\n` +
  `export const APP_VERSION = '${version}';\n` +
  `export const APP_VERSION_LABEL = '${label}';\n`;

writeFileSync(outPath, file, 'utf8');
console.log(`Generated app version: ${label}`);
