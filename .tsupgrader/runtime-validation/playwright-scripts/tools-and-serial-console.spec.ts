import { test, expect } from '@playwright/test';

test.use({ channel: 'msedge' });

test('tools-and-serial-console', async ({ page }) => {
  await page.route("**/*", async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === "http://127.0.0.1:5175") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await page.goto('http://127.0.0.1:5175');
  await page.getByRole('link', { name: 'Tools' }).click();
  await page.getByRole('link', { name: 'Serial Console Connect to' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Timestamp format HH:MM:SSHH:').selectOption('ISO 8601');
  await page.getByRole('spinbutton', { name: 'Number of columns' }).fill('3');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('region', { name: 'Port 1' }).getByRole('button', { name: 'Send & Display Options +' }).click();
  await page.getByRole('region', { name: 'Port 1' }).getByRole('button', { name: 'Hex View' }).click();
  await page.getByRole('link', { name: 'All tools' }).click();
  await expect(page.locator('div').nth(5)).toBeVisible();
});
