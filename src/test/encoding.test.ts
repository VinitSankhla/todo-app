// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text saved with the wrong encoding turns characters like an ellipsis or a dash into garbage
// that starts with the characters 0xE2 0x20AC (or 0xC3 / 0xC2 followed by another one), and a
// byte-order mark (0xFEFF) can break files. Built from character codes so this file stays clean.
const char = (code: number) => String.fromCharCode(code);
const GARBLED = new RegExp(
  `${char(0xe2)}${char(0x20ac)}|[${char(0xc3)}${char(0xc2)}][${char(0x80)}-${char(0xbf)}]|${char(0xfeff)}`,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?|css|html)$/.test(name) ? [path] : [];
  });
}

describe('source file encoding', () => {
  it('has no garbled characters or byte-order marks', () => {
    const files = [...['src', 'amplify', 'shared'].flatMap(sourceFiles), 'index.html'];
    const garbled = files.filter((file) => GARBLED.test(readFileSync(file, 'utf8')));
    expect(garbled).toEqual([]);
  });

  it('detects garbled text', () => {
    expect(GARBLED.test(`Thinking${char(0xe2)}${char(0x20ac)}${char(0xa6)}`)).toBe(true);
    expect(GARBLED.test('Thinking… — ✕')).toBe(false);
  });
});
