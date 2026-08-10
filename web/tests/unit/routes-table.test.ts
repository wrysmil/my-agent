import { describe, it, expect } from 'vitest';
import { routes } from '../../src/routes';

describe('routes', () => {
  it('declares 1 layout route wrapping 10 children', () => {
    expect(routes.length).toBe(1);
    expect(routes[0].children?.length).toBe(10);
  });
  it('declares index route → DashboardPage', () => {
    const index = routes[0].children?.find(c => c.index === true);
    expect(index?.handle?.label).toBe('Dashboard');
  });
  it('includes catch-all * route as child', () => {
    expect(routes[0].children?.some(c => c.path === '*')).toBe(true);
  });
  it('includes chat and chat/:sessionId as children', () => {
    expect(routes[0].children?.some(c => c.path === 'chat')).toBe(true);
    expect(routes[0].children?.some(c => c.path === 'chat/:sessionId')).toBe(true);
  });
});
