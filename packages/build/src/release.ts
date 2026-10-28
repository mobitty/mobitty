import { cpSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const distDir = resolve(rootDir, 'dist');
const serverDir = resolve(rootDir, 'packages', 'mobitty');
const clientDir = resolve(rootDir, 'packages', 'client');
const vtDir = resolve(rootDir, 'packages', 'vt');
// Workspace packages bundled into the mobitty tarball (bundleDependencies):
// compiled to dist/node_modules/<name>, never published on their own.
const vtDistDir = resolve(distDir, 'node_modules', '@mobitty', 'vt');

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

// 3b. Compile @mobitty/vt TS → JS into dist/node_modules/@mobitty/vt, with a
// package.json that points at the JS. The server's compiled imports of
// '@mobitty/vt' resolve to it.
console.log('Compiling @mobitty/vt...');
execSync('pnpm tsc -p tsconfig.build.json', { cwd: vtDir, stdio: 'inherit' });
const vtPkg: Record<string, unknown> = JSON.parse(readFileSync(resolve(vtDir, 'package.json'), 'utf-8'));
const vtVersion = vtPkg['version'];
if (typeof vtVersion !== 'string') {
  console.error('@mobitty/vt package.json has no version');
  process.exit(1);
}
const vtExports = vtPkg['exports'];
if (typeof vtExports !== 'string') {
  console.error('@mobitty/vt package.json exports must be a single path');
  process.exit(1);
}
vtPkg['exports'] = vtExports.replace(/\.ts$/, '.js');
delete vtPkg['scripts'];
delete vtPkg['devDependencies'];
delete vtPkg['files'];
// npm treats the dependencies of a bundled package, peers included, as part
// of the bundle and so never installs @xterm/headless for mobitty itself if
// it stays listed here. @mobitty/vt imports it as types only, so the compiled
// JS needs no peer.
delete vtPkg['peerDependencies'];
writeFileSync(resolve(vtDistDir, 'package.json'), JSON.stringify(vtPkg, null, 2) + '\n');
cpSync(resolve(rootDir, 'LICENSE'), resolve(vtDistDir, 'LICENSE'));

// 4. Copy non-TS source assets (shell-init hooks etc.) — tsc doesn't emit these
cpSync(resolve(serverDir, 'src', 'shell-init'), resolve(distDir, 'src', 'shell-init'), {
  recursive: true,
});
// The agent skill, resolved by src/skill-install.ts as ../skills from itself.
cpSync(resolve(serverDir, 'skills'), resolve(distDir, 'skills'), { recursive: true });

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
// The workspace:* dependency on @mobitty/vt becomes its exact version, shipped
// inside the tarball as a bundled dependency.
const deps = pkg['dependencies'];
if (!isRecord(deps) || deps['@mobitty/vt'] === undefined) {
  console.error('packages/mobitty/package.json does not depend on @mobitty/vt');
  process.exit(1);
}
deps['@mobitty/vt'] = vtVersion;
pkg['bundleDependencies'] = ['@mobitty/vt'];
writeFileSync(resolve(distDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const npmignore = resolve(serverDir, '.npmignore');
if (existsSync(npmignore)) {
  cpSync(npmignore, resolve(distDir, '.npmignore'));
}
cpSync(resolve(rootDir, 'README.md'), resolve(distDir, 'README.md'));

// 6. Place built client assets
cpSync(clientDist, resolve(distDir, 'client'), { recursive: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
