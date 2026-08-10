/**
 * Dashboard 任务卡片 E2E。
 *
 * 来源：plan § Step 5.2
 *
 * 注意：本应用使用 HashRouter，URL 形如 `/#/` / `/#/chat`。
 */
import { test, expect } from '@playwright/test';

test.describe('Dashboard 任务卡片', () => {
  test('Dashboard 渲染 8 张任务卡片', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    const cards = page.locator('[data-testid^="task-card-"]');
    await expect(cards).toHaveCount(8);
  });

  test('点击任务卡片 → 跳 /chat + Composer 预填 prompt', async ({ page }) => {
    await page.goto('/#/');
    await page.getByTestId('task-card-image').click();
    await expect(page).toHaveURL(/#\/chat$/);
    const textarea = page.getByTestId('composer-textarea');
    await expect(textarea).toHaveValue(/设计城市夏日咖啡节活动海报/);
  });

  test('招呼语 + subtitle 渲染', async ({ page }) => {
    await page.goto('/#/');
    const greeting = page.getByTestId('dashboard-greeting');
    await expect(greeting).toBeVisible();
    await expect(page.getByTestId('dashboard-subtitle')).toBeVisible();
  });
});