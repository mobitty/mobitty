import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, findDir, hasFile, ancestorDirs, childCount, flattenVisible } from './tree.ts';
import { resolveRelative, absolutePath, isExternalUrl, dirname, basename } from './paths.ts';
import { detectLanguage, languageFromFence, isMarkdownPath, isImagePath, fileTypeLabel } from './languages.ts';
import { formatBytes, formatRelativeTime } from './format.ts';
import { ViewerFileCache } from './cache.ts';
import type { ViewerFilePayload } from './types.ts';

describe('buildTree', () => {
  const tree = buildTree([
    ['src/b.ts', 2], ['README.md', 10], ['src/a.ts', 1], ['docs/img/x.png', 5],
    ['src/file10.ts', 3], ['src/file2.ts', 4], ['LICENSE', 7],
  ]);

  it('puts directories before files, naturally sorted', () => {
    assert.deepEqual(tree.dirs.map(d => d.name), ['docs', 'src']);
    assert.deepEqual(tree.files.map(f => f.name), ['LICENSE', 'README.md']);
    assert.deepEqual(findDir(tree, 'src')!.files.map(f => f.name), ['a.ts', 'b.ts', 'file2.ts', 'file10.ts']);
  });

  it('creates intermediate directories implied by paths', () => {
    const img = findDir(tree, 'docs/img');
    assert.ok(img);
    assert.equal(img.path, 'docs/img');
    assert.deepEqual(img.files, [{ name: 'x.png', path: 'docs/img/x.png', size: 5 }]);
  });

  it('answers lookups', () => {
    assert.equal(hasFile(tree, 'src/a.ts'), true);
    assert.equal(hasFile(tree, 'src/zz.ts'), false);
    assert.equal(hasFile(tree, 'README.md'), true);
    assert.equal(findDir(tree, 'nope'), undefined);
    assert.equal(childCount(findDir(tree, 'docs')!), 1);
  });

  it('ignores empty and duplicate-slash paths', () => {
    const t = buildTree([['', 0], ['a//b.txt', 1]]);
    assert.equal(hasFile(t, 'a/b.txt'), true);
    assert.equal(t.files.length, 0);
  });
});

describe('flattenVisible', () => {
  const tree = buildTree([['a/b/c.txt', 1], ['a/d.txt', 1], ['e.txt', 1]]);

  it('shows only root children when nothing is expanded', () => {
    const rows = flattenVisible(tree, new Set());
    assert.deepEqual(rows.map(r => `${r.depth}:${r.node.path}`), ['0:a', '0:e.txt']);
  });

  it('descends into expanded directories', () => {
    const rows = flattenVisible(tree, new Set(ancestorDirs('a/b/c.txt')));
    assert.deepEqual(rows.map(r => `${r.depth}:${r.node.path}`), ['0:a', '1:a/b', '2:a/b/c.txt', '1:a/d.txt', '0:e.txt']);
  });

  it('lists ancestors of a path', () => {
    assert.deepEqual(ancestorDirs('a/b/c.txt'), ['a', 'a/b']);
    assert.deepEqual(ancestorDirs('top.txt'), []);
  });
});

describe('paths', () => {
  it('resolves relative links against the linking file', () => {
    assert.equal(resolveRelative('docs/guide.md', 'img/a.png'), 'docs/img/a.png');
    assert.equal(resolveRelative('docs/guide.md', './a.png'), 'docs/a.png');
    assert.equal(resolveRelative('docs/guide.md', '../README.md#install'), 'README.md');
    assert.equal(resolveRelative('README.md', 'my%20file.png?raw=1'), 'my file.png');
  });

  it('refuses links outside the view or not file-relative', () => {
    assert.equal(resolveRelative('README.md', '../x.png'), null);
    assert.equal(resolveRelative('README.md', '/etc/passwd'), null);
    assert.equal(resolveRelative('README.md', 'https://example.com/a.png'), null);
    assert.equal(resolveRelative('README.md', '#section'), null);
    assert.equal(resolveRelative('README.md', ''), null);
  });

  it('detects external URLs', () => {
    assert.equal(isExternalUrl('https://x.dev'), true);
    assert.equal(isExternalUrl('mailto:a@b.c'), true);
    assert.equal(isExternalUrl('//cdn.x/y.png'), true);
    assert.equal(isExternalUrl('docs/a.md'), false);
  });

  it('builds absolute paths in the root separator style', () => {
    assert.equal(absolutePath('/home/u/repo', 'src/a.ts'), '/home/u/repo/src/a.ts');
    assert.equal(absolutePath('/', 'etc/hosts'), '/etc/hosts');
    assert.equal(absolutePath('C:\\repo', 'src/a.ts'), 'C:\\repo\\src\\a.ts');
    assert.equal(absolutePath('/home/u/repo', ''), '/home/u/repo');
  });

  it('splits names', () => {
    assert.equal(dirname('a/b/c.ts'), 'a/b');
    assert.equal(dirname('c.ts'), '');
    assert.equal(basename('/home/u/repo'), 'repo');
    assert.equal(basename('C:\\repo\\x.md'), 'x.md');
  });
});

describe('languages', () => {
  it('detects by extension and by file name', () => {
    assert.equal(detectLanguage('src/cli-shared.ts'), 'typescript');
    assert.equal(detectLanguage('App.TSX'), 'tsx');
    assert.equal(detectLanguage('Dockerfile'), 'docker');
    assert.equal(detectLanguage('sub/Makefile'), 'make');
    assert.equal(detectLanguage('.zshrc'), 'shellscript');
    assert.equal(detectLanguage('.env.local'), 'dotenv');
    assert.equal(detectLanguage('tsconfig.json'), 'jsonc');
    assert.equal(detectLanguage('notes.txt'), null);
    assert.equal(detectLanguage('LICENSE'), null);
  });

  it('maps fence info strings', () => {
    assert.equal(languageFromFence('language-ts'), 'typescript');
    assert.equal(languageFromFence('bash'), 'shellscript');
    assert.equal(languageFromFence('python title="x"'), 'python');
    assert.equal(languageFromFence('brainfuck'), null);
    assert.equal(languageFromFence(undefined), null);
  });

  it('classifies markdown and images', () => {
    assert.equal(isMarkdownPath('README.md'), true);
    assert.equal(isMarkdownPath('notes.txt'), false);
    assert.equal(isImagePath('docs/a.PNG'), true);
    assert.equal(isImagePath('a.ts'), false);
  });

  it('labels file types', () => {
    assert.equal(fileTypeLabel('a.ts'), 'TypeScript');
    assert.equal(fileTypeLabel('notes.txt'), 'Plain text');
    assert.equal(fileTypeLabel('a.png', 'image/png'), 'PNG image');
    assert.equal(fileTypeLabel('a.svg', 'image/svg+xml'), 'SVG image');
  });
});

describe('format', () => {
  it('formats sizes', () => {
    assert.equal(formatBytes(812), '812 B');
    assert.equal(formatBytes(1434), '1.4 KB');
    assert.equal(formatBytes(412 * 1024), '412 KB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  });

  it('formats relative times', () => {
    const now = 1_000_000_000_000;
    assert.equal(formatRelativeTime(now - 5_000, now), 'just now');
    assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 min ago');
    assert.equal(formatRelativeTime(now - 2 * 3_600_000, now), '2 hours ago');
    assert.equal(formatRelativeTime(now - 86_400_000, now), '1 day ago');
  });
});

describe('ViewerFileCache', () => {
  const file = (path: string, chars: number): ViewerFilePayload => ({
    viewId: 1, path, kind: 'text', size: chars, mtimeMs: 0, content: 'x'.repeat(chars),
  });

  it('evicts the oldest entries past the cap', () => {
    const cache = new ViewerFileCache(10);
    cache.set(file('a', 4));
    cache.set(file('b', 4));
    cache.set(file('c', 4));
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('b'), true);
    assert.equal(cache.has('c'), true);
  });

  it('keeps an entry that alone exceeds the cap', () => {
    const cache = new ViewerFileCache(10);
    cache.set(file('a', 4));
    cache.set(file('big', 50));
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('big'), true);
  });

  it('replaces an entry without double counting', () => {
    const cache = new ViewerFileCache(10);
    cache.set(file('a', 6));
    cache.set(file('a', 6));
    cache.set(file('b', 4));
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), true);
    assert.equal(cache.size, 2);
  });
});
