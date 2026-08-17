import { expect, test } from '@playwright/test';

test('MUI theme applies its tokens and persists through bootstrap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Theme').selectOption('mui');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mui');
  expect(await page.evaluate(() => localStorage.getItem('scry.theme.name'))).toBe('mui');

  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--primary').trim(), style.getPropertyValue('--background').trim()];
  })).toEqual(['#1976d2', '#f5f5f5']);

  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--primary').trim(), style.getPropertyValue('--background').trim()];
  })).toEqual(['#90caf9', '#121212']);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mui');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
});
