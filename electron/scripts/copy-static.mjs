import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, '..');
const projectRoot = resolve(electronRoot, '..');
const output = resolve(electronRoot, 'dist', 'renderer');

await mkdir(output, { recursive: true });
await cp(resolve(electronRoot, 'static'), output, { recursive: true, force: true });
await cp(resolve(electronRoot, 'dist', 'renderer.js'), resolve(output, 'renderer.js'), { force: true });
await cp(resolve(projectRoot, 'assets', 'logo.png'), resolve(output, 'logo.png'), { force: true });
