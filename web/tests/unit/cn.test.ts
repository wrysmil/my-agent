import { describe, it, expect } from 'vitest';
import { cn } from '../../src/lib/cn';

describe('cn', () => {
  it('merges class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });
  it('filters falsy values', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });
  it('tailwind-merge: later wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
