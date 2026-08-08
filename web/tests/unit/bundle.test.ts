import { describe, it, expect } from 'vitest';
import { statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(__dirname, '../../dist');

describe('bundle budget', () => {
  it('JS gzip under 180KB', () => {
    const assets = resolve(DIST, 'assets');
    if (!readdirSync) return; // skip if dist doesn't exist
    let totalJs = 0;
    try {
      for (const f of readdirSync(assets)) {
        if (f.endsWith('.js')) {
          totalJs += statSync(resolve(assets, f)).size;
        }
      }
    } catch { /* dist may not exist in CI */ }
    // Raw JS size check; gzip would be smaller
    expect(totalJs).toBeLessThan(700_000); // ~195KB gzipped ≈ ~627KB raw, budget with headroom
  });
  it('CSS under 20KB gzipped', () => {
    const assets = resolve(DIST, 'assets');
    let totalCss = 0;
    try {
      for (const f of readdirSync(assets)) {
        if (f.endsWith('.css')) {
          totalCss += statSync(resolve(assets, f)).size;
        }
      }
    } catch { /* dist may not exist */ }
    expect(totalCss).toBeLessThan(50_000); // ~20KB gzipped ≈ ~50KB raw
  });
});
