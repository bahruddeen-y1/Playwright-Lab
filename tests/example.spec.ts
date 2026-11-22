import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('http://localhost:3000/login');

  await page.waitForTimeout(1000); // Wait for 1 second to ensure the page has loaded completely
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/เข้าสู่ระบบ/);

  await page.getByTestId('oauth-google').click();
  await page.getByTestId('mock-account-alice@gmail.com').click();
  await expect(page.getByTestId('user-email')).toContainText('alice@gmail.com');
});

test('loop number for input', async ({ page }) => {
  await page.goto('http://localhost:3000/app');

const numberKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  for (const num of numberKeys) {
    await page.getByRole('button', { name: num }).click();
    await expect(page.getByTestId('display')).toContainText(num);
    await page.waitForTimeout(2000); 
    await page.getByTestId('key-clear').click();
  }
});
