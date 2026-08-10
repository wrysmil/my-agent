/**
 * Composer 附件上传 + 拖拽 E2E。
 *
 * 来源：plan § Step 5.3
 */
import { test, expect } from '@playwright/test';

test.describe('Composer 附件', () => {
  test('点 + 按钮 → 上传文件 → 附件 chip', async ({ page }) => {
    await page.goto('/#/chat');
    await page.getByTestId('composer-attachment-button').click();
    await expect(page.getByTestId('composer-attachment-menu')).toBeVisible();
    await page.getByTestId('composer-attachment-menu-upload').click();
    // 上传 sample.png
    const fileInput = page.locator('[data-testid="composer-attachment-file-input"]');
    await fileInput.setInputFiles('tests/e2e/fixtures/sample.png');
    await expect(page.getByTestId('composer-attachment-chip')).toBeVisible();
    await expect(page.getByText('sample.png')).toBeVisible();
  });

  test('拖拽文件到 Composer → 附件 chip', async ({ page }) => {
    await page.goto('/#/chat');
    // 用 JS 模拟 drop 事件
    await page.evaluate(() => {
      const file = new File(['test content'], 'dragged.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const composer = document.querySelector('[data-testid="composer-form"]');
      if (!composer) throw new Error('composer-form not found');
      composer.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
      composer.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    });
    await expect(page.getByText('dragged.png')).toBeVisible();
  });
});