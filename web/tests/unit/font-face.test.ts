import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('fonts css @font-face', () => {
  it('declares Inter + JetBrains Mono', () => {
    const src = readFileSync('src/styles/globals.css', 'utf8');
    expect(src).toMatch(/@font-face[^}]*Inter/);
    expect(src).toMatch(/@font-face[^}]*JetBrainsMono/);
  });
});
