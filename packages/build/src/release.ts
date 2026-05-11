import { cpSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const distDir = resolve(rootDir, 'dist');
const serverDir = resolve(rootDir, 'packages', 'mobitty');
const clientDir = resolve(rootDir, 'packages', 'client');

// 1. Clean dist/
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

// 2. Build client
console.log('Building client...');
execSync('pnpm run build', { cwd: clientDir, stdio: 'inherit' });

const clientDist = resolve(clientDir, 'dist');
if (!existsSync(resolve(clientDist, 'index.html'))) {
  console.error('Client build failed: dist/index.html not found');
  process.exit(1);
}

// 3. Compile server TS → JS into dist/
console.log('Compiling server...');
execSync('pnpm tsc -p tsconfig.build.json', { cwd: serverDir, stdio: 'inherit' });

// 4. Copy non-TS source assets (shell-init hooks etc.) — tsc doesn't emit these
cpSync(resolve(serverDir, 'src', 'shell-init'), resolve(distDir, 'src', 'shell-init'), {
  recursive: true,
});

// 5. Copy package.json (rewrite .ts → .js references) and .npmignore
const pkg = JSON.parse(readFileSync(resolve(serverDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
const bin = pkg['bin'] as Record<string, string> | undefined;
if (bin) {
  for (const key of Object.keys(bin)) {
    bin[key] = bin[key]!.replace(/\.ts$/, '.js');
  }
}
const files = pkg['files'] as string[] | undefined;
if (files) {
  for (let i = 0; i < files.length; i++) {
    files[i] = files[i]!.replace(/\.ts/g, '.js');
  }
}
writeFileSync(resolve(distDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const npmignore = resolve(serverDir, '.npmignore');
if (existsSync(npmignore)) {
  cpSync(npmignore, resolve(distDir, '.npmignore'));
}
cpSync(resolve(rootDir, 'README.md'), resolve(distDir, 'README.md'));

// 6. Place built client assets
cpSync(clientDist, resolve(distDir, 'client'), { recursive: true });

// 7. Summary
console.log('');
console.log('Release build complete: dist/');
function printTree(dir: string, prefix: string): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    console.log(`${prefix}${connector}${entry.name}`);
    if (entry.isDirectory()) {
      printTree(resolve(dir, entry.name), prefix + childPrefix);
    }
  }
}
printTree(distDir, '');
