import { describe, it, expect } from 'vitest';
import { routes } from '../../src/routes';

describe('routes', () => {
  it('declares 9 entries', () => {
    expect(routes.length).toBe(9);
  });
  it('declares path "/" → DashboardPage', () => {
    const r = routes.find(r => r.path === '/')!;
    expect(r.handle?.label).toBe('Dashboard');
  });
  it('includes catch-all * route', () => {
    expect(routes.some(r => r.path === '*')).toBe(true);
  });
  it('includes /chat and /chat/:sessionId', () => {
    expect(routes.some(r => r.path === '/chat')).toBe(true);
    expect(routes.some(r => r.path === '/chat/:sessionId')).toBe(true);
  });
});
