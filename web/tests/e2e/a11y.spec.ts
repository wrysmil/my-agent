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

/**
 * WU-05 Step 5.5 — Dashboard + ChatPage axe 扫描 0 critical / 0 serious
 * 使用 wcag2a/aa + wcag21a/aa tags（更严格）。
 */
test.describe('a11y scan (WCAG 2.1 AA)', () => {
  for (const route of ['/#/', '/#/chat']) {
    test(`axe scan ${route} has 0 critical/serious violations (WCAG 2.1 AA)`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blockers = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(blockers).toEqual([]);
    });
  }
});
