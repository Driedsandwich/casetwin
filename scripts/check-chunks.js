import { readdir, stat } from 'node:fs/promises';
const files = await readdir('dist/assets');
let largest = 0;
for (const file of files.filter(file => file.endsWith('.js'))) {
  const size = (await stat(`dist/assets/${file}`)).size;
  largest = Math.max(largest, size);
  if (size > 500000) throw new Error(`Chunk exceeds 500 kB: ${file} ${size}`);
}
console.log(`Every JavaScript chunk is under 500 kB. Largest: ${largest} bytes.`);
