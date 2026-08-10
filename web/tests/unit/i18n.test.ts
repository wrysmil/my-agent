import { describe, it, expect } from 'vitest';
import { t, setLocale, getLocale } from '../../src/lib/i18n';

describe('i18n', () => {
  it('returns zh translation by default', () => {
    expect(t('app.title')).toBe('my-agent');
  });
  it('falls back to key on missing translation', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
  it('switches to en locale', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('app.title')).toBe('my-agent');
  });
  it('interpolates params', () => {
    setLocale('zh');
    expect(t('chat.sessionLabel', { id: 'abc' })).toContain('abc');
  });
});
