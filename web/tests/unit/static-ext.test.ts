import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('static.ts ALLOWED_EXTS', () => {
  it('includes .mjs .woff2 .png .webmanifest .map', () => {
    const src = readFileSync('../src/web/server/static.ts', 'utf8');
    for (const ext of ['.mjs', '.woff2', '.png', '.webmanifest', '.map']) {
      expect(src).toContain(ext);
    }
  });
  it('has cache-control immutable logic', () => {
    const src = readFileSync('../src/web/server/static.ts', 'utf8');
    expect(src).toMatch(/immutable/);
  });
});
