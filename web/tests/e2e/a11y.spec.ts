import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/#/',
  '/#/chat',
  '/#/sessions',
  '/#/providers',
  '/#/skills',
  '/#/agents',
  '/#/settings',
];

test.describe('a11y scan', () => {
  for (const route of ROUTES) {
    test(`axe scan ${route} has 0 critical violations`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).analyze();
      const critical = results.violations.filter(v => v.impact === 'critical');
      expect(critical).toEqual([]);
    });
  }
});
