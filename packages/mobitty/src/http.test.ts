import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAssetPath } from './http.ts';
import type { PathFns } from './http.ts';

const posixFns: PathFns = {
  resolve: path.posix.resolve,
  relative: path.posix.relative,
  isAbsolute: path.posix.isAbsolute,
};

const win32Fns: PathFns = {
  resolve: path.win32.resolve,
  relative: path.win32.relative,
  isAbsolute: path.win32.isAbsolute,
};

describe('resolveAssetPath (posix)', () => {
  const clientDir = '/app/client';

  it('resolves /index.html', () => {
    assert.equal(resolveAssetPath(clientDir, '/index.html', posixFns), '/app/client/index.html');
  });

  it('resolves nested asset path', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/assets/index-abc123.js', posixFns),
      '/app/client/assets/index-abc123.js',
    );
  });

  it('blocks directory traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../../../etc/passwd', posixFns), undefined);
  });

  it('blocks single-level traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../secret', posixFns), undefined);
  });
});

describe('resolveAssetPath (win32)', () => {
  const clientDir = 'C:\\Users\\app\\client';

  it('resolves /index.html', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/index.html', win32Fns),
      'C:\\Users\\app\\client\\index.html',
    );
  });

  it('resolves nested asset path', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/assets/index-abc123.js', win32Fns),
      'C:\\Users\\app\\client\\assets\\index-abc123.js',
    );
  });

  it('blocks directory traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../../../etc/passwd', win32Fns), undefined);
  });

  it('blocks cross-drive traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/D:/other', win32Fns), undefined);
  });
});
