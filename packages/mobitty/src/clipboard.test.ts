import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeImageToSystemClipboard, writeImageToFile, getProcessCwd, ALLOWED_MIME_TYPES, MAX_IMAGE_SIZE } from './clipboard.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('writeImageToSystemClipboard', () => {
  describe('MIME type validation', () => {
    it('rejects unsupported MIME types', async () => {
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const result = await writeImageToSystemClipboard(data, 'text/plain');
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('Unsupported MIME type'));
    });

    it('rejects application/octet-stream', async () => {
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const result = await writeImageToSystemClipboard(data, 'application/octet-stream');
      assert.equal(result.success, false);
    });

    for (const mime of ALLOWED_MIME_TYPES) {
      it(`does not reject allowed type: ${mime}`, async () => {
        // Will likely fail on clipboard write (no tool installed in CI), but should not fail on validation
        const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const result = await writeImageToSystemClipboard(data, mime);
        // If it fails, it should NOT be due to MIME validation
        if (!result.success) {
          assert.ok(!result.error?.includes('Unsupported MIME type'));
        }
      });
    }
  });

  describe('size validation', () => {
    it('rejects empty image data', async () => {
      const result = await writeImageToSystemClipboard(Buffer.alloc(0), 'image/png');
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('Empty image data'));
    });

    it('rejects images exceeding max size', async () => {
      const data = Buffer.alloc(MAX_IMAGE_SIZE + 1);
      const result = await writeImageToSystemClipboard(data, 'image/png');
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('too large'));
    });
  });

  describe('ALLOWED_MIME_TYPES', () => {
    it('includes common image formats', () => {
      assert.ok(ALLOWED_MIME_TYPES.has('image/png'));
      assert.ok(ALLOWED_MIME_TYPES.has('image/jpeg'));
      assert.ok(ALLOWED_MIME_TYPES.has('image/gif'));
      assert.ok(ALLOWED_MIME_TYPES.has('image/webp'));
      assert.ok(ALLOWED_MIME_TYPES.has('image/bmp'));
    });

    it('does not include non-image types', () => {
      assert.ok(!ALLOWED_MIME_TYPES.has('text/plain'));
      assert.ok(!ALLOWED_MIME_TYPES.has('application/json'));
      assert.ok(!ALLOWED_MIME_TYPES.has('video/mp4'));
    });
  });

  describe('MAX_IMAGE_SIZE', () => {
    it('is 25 MB', () => {
      assert.equal(MAX_IMAGE_SIZE, 25 * 1024 * 1024);
    });
  });
});

describe('writeImageToFile', () => {
  it('rejects unsupported MIME types', async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await writeImageToFile(data, 'text/plain', '/tmp/test');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Unsupported MIME type'));
  });

  it('rejects empty image data', async () => {
    const result = await writeImageToFile(Buffer.alloc(0), 'image/png', '/tmp/test');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Empty image data'));
  });

  it('rejects images exceeding max size', async () => {
    const data = Buffer.alloc(MAX_IMAGE_SIZE + 1);
    const result = await writeImageToFile(data, 'image/png', '/tmp/test');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('too large'));
  });

  it('writes image to file and returns path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mobitty-test-'));
    try {
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = await writeImageToFile(data, 'image/png', dir);
      assert.equal(result.success, true);
      assert.ok(result.filePath);
      assert.ok(result.filePath.endsWith('.png'));
      const written = await readFile(result.filePath);
      assert.deepEqual(written, data);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('creates directory if it does not exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'mobitty-test-'));
    const nested = join(base, 'sub', 'dir');
    try {
      const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = await writeImageToFile(data, 'image/jpeg', nested);
      assert.equal(result.success, true);
      assert.ok(result.filePath);
      assert.ok(result.filePath.endsWith('.jpeg'));
    } finally {
      await rm(base, { recursive: true });
    }
  });
});

describe('getProcessCwd', () => {
  const supported = process.platform === 'linux' || process.platform === 'darwin';

  it('returns the cwd for the current process on supported platforms', { skip: !supported }, () => {
    const cwd = getProcessCwd(process.pid);
    assert.equal(typeof cwd, 'string');
    assert.ok(cwd.length > 0);
  });

  it('returns "" for a non-existent PID', () => {
    const cwd = getProcessCwd(999999999);
    assert.equal(cwd, '');
  });
});
