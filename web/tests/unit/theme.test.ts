import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('theme tokens', () => {
  it('globals.css has dark theme tokens', () => {
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toMatch(/\[data-theme="dark"\]/);
    expect(css).toMatch(/--color-bg/);
  });
  it('index.html has FOUC prevention script', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/data-theme/);
  });
});
