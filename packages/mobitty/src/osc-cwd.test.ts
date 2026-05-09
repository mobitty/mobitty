import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsc7 } from './osc-cwd.ts';

describe('parseOsc7', () => {
  it('parses Unix-style file URI with empty host', () => {
    assert.equal(parseOsc7('file:///Users/wei/proj'), '/Users/wei/proj');
  });

  it('parses Unix-style file URI with hostname', () => {
    assert.equal(parseOsc7('file://laptop.local/Users/wei/proj'), '/Users/wei/proj');
  });

  it('decodes percent-encoded path segments', () => {
    assert.equal(parseOsc7('file:///Users/wei/Project%20Files'), '/Users/wei/Project Files');
  });

  it('decodes UTF-8 percent-encoded path segments', () => {
    // 'café' → c a f %C3%A9
    assert.equal(parseOsc7('file:///Users/wei/caf%C3%A9'), '/Users/wei/café');
  });

  it('returns null when missing the file:// scheme', () => {
    assert.equal(parseOsc7('http://example.com/x'), null);
  });

  it('returns null when there is no path slash', () => {
    assert.equal(parseOsc7('file://hostname'), null);
  });

  it('returns null on malformed percent-encoding', () => {
    assert.equal(parseOsc7('file:///bad%ZZencoding'), null);
  });

  if (process.platform === 'win32') {
    it('normalizes /C:/foo to native C:\\foo on Windows', () => {
      assert.equal(parseOsc7('file:///C:/Users/wei/proj'), 'C:\\Users\\wei\\proj');
    });

    it('normalizes drive-letter paths regardless of host', () => {
      assert.equal(parseOsc7('file://desktop/D:/work/repo'), 'D:\\work\\repo');
    });

    it('decodes spaces inside Windows paths', () => {
      assert.equal(parseOsc7('file:///C:/Users/wei/Project%20Files'), 'C:\\Users\\wei\\Project Files');
    });
  } else {
    it('keeps drive-letter paths verbatim on non-Windows', () => {
      assert.equal(parseOsc7('file:///C:/Users/wei/proj'), '/C:/Users/wei/proj');
    });
  }
});
