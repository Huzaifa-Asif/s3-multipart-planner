import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (['.js', '.cjs', '.mjs'].includes(extname(path))) files.push(path);
  }
}

for (const root of roots) await collect(root);

for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    process.stderr.write(check.stderr);
    process.exit(check.status ?? 1);
  }

  const contents = await readFile(file, 'utf8');
  if (/\t| +$/m.test(contents)) {
    throw new Error(`${file}: tabs or trailing whitespace are not allowed`);
  }
}

console.log(`Checked ${files.length} JavaScript files.`);
