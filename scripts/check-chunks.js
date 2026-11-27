import { readFile, readdir, stat } from 'node:fs/promises';
const files = await readdir('dist/assets');
let largest = 0;
for (const file of files.filter(file => file.endsWith('.js'))) {
  const size = (await stat(`dist/assets/${file}`)).size;
  largest = Math.max(largest, size);
  if (size > 500000) throw new Error(`Chunk exceeds 500 kB: ${file} ${size}`);
}
console.log(`Every JavaScript chunk is under 500 kB. Largest: ${largest} bytes.`);
const notices = await readFile('dist/THIRD_PARTY_NOTICES.txt', 'utf8');
const packages = [...notices.matchAll(/^([^\n]+) ([^\n]+)\nLicense: /gm)];
if (!packages.length) throw new Error('THIRD_PARTY_NOTICES.txt contains no bundled packages.');
console.log(`Third-party notices exist for ${packages.length} bundled packages.`);
