/**
 * Composer 客户端校验 E2E。
 *
 * 来源：plan § Step 5.4
 */
import { test, expect } from '@playwright/test';

test.describe('Composer 客户端校验', () => {
  test('上传 11MB 文件 → Toast 显示「文件超过 10MB」', async ({ page }) => {
    await page.goto('/#/chat');
    await page.getByTestId('composer-attachment-button').click();
    await page.getByTestId('composer-attachment-menu-upload').click();
    const fileInput = page.locator('[data-testid="composer-attachment-file-input"]');
    await fileInput.setInputFiles('tests/e2e/fixtures/big-file-11mb.bin');
    await expect(page.getByTestId('composer-error-toast')).toBeVisible();
    await expect(page.getByTestId('composer-error-toast')).toContainText(/10MB/);
  });
});