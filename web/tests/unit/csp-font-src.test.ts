import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('csp.ts', () => {
  it('contains font-src self', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/web/server/csp.ts'), 'utf8');
    expect(src).toMatch(/"font-src\s[^"]*'self'/);
  });
});
