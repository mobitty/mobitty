import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsc7 } from './osc-cwd.ts';

describe('parseOsc7', () => {
  it('parses Unix-style file URI with empty host', () => {
    assert.equal(parseOsc7('file:///Users/wei/proj', 'linux'), '/Users/wei/proj');
  });

  it('parses Unix-style file URI with hostname', () => {
    assert.equal(parseOsc7('file://laptop.local/Users/wei/proj', 'linux'), '/Users/wei/proj');
  });

  it('decodes percent-encoded path segments', () => {
    assert.equal(parseOsc7('file:///Users/wei/Project%20Files', 'linux'), '/Users/wei/Project Files');
  });

  it('decodes UTF-8 percent-encoded path segments', () => {
    // 'café' → c a f %C3%A9
    assert.equal(parseOsc7('file:///Users/wei/caf%C3%A9', 'linux'), '/Users/wei/café');
  });

  it('accepts unencoded spaces (POSIX sh shim)', () => {
    assert.equal(parseOsc7('file://host/tmp/dir with space', 'linux'), '/tmp/dir with space');
  });

  it('returns null when missing the file:// scheme', () => {
    assert.equal(parseOsc7('http://example.com/x', 'linux'), null);
  });

  it('returns null when there is no path slash', () => {
    assert.equal(parseOsc7('file://hostname', 'linux'), null);
  });

  it('returns null on malformed percent-encoding', () => {
    assert.equal(parseOsc7('file:///bad%ZZencoding', 'linux'), null);
  });

  it('keeps drive-letter paths verbatim on non-Windows', () => {
    assert.equal(parseOsc7('file:///C:/Users/wei/proj', 'darwin'), '/C:/Users/wei/proj');
  });

  describe('on Windows', () => {
    it('normalizes /C:/foo to native C:\\foo', () => {
      assert.equal(parseOsc7('file:///C:/Users/wei/proj', 'win32'), 'C:\\Users\\wei\\proj');
    });

    it('normalizes drive-letter paths regardless of host', () => {
      assert.equal(parseOsc7('file://desktop/D:/work/repo', 'win32'), 'D:\\work\\repo');
    });

    it('decodes spaces inside Windows paths', () => {
      assert.equal(parseOsc7('file:///C:/Users/wei/Project%20Files', 'win32'), 'C:\\Users\\wei\\Project Files');
    });

    it('accepts backslash separators (cmd $P)', () => {
      assert.equal(parseOsc7('file://host/D:\\work\\my repo', 'win32'), 'D:\\work\\my repo');
    });

    it('maps a bare drive to its root', () => {
      assert.equal(parseOsc7('file://host/D:', 'win32'), 'D:\\');
      assert.equal(parseOsc7('file://host/D:\\', 'win32'), 'D:\\');
    });

    it('normalizes UNC paths (WSL, network shares)', () => {
      assert.equal(parseOsc7('file://host//wsl.localhost/Ubuntu/home/me', 'win32'), '\\\\wsl.localhost\\Ubuntu\\home\\me');
    });

    it('rejects POSIX paths it cannot map', () => {
      assert.equal(parseOsc7('file://host/home/me', 'win32'), null);
      assert.equal(parseOsc7('file://host/d/work', 'win32'), null);
    });
  });
});
