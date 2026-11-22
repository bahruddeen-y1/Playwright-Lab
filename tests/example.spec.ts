import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.getByTestId('oauth-google').click();
  await page.getByTestId('mock-account-alice@gmail.com').click();
  await expect(page.getByTestId('user-email')).toContainText('alice@gmail.com');
  await page.getByTestId('logout-button').click();
  await page.getByTestId('oauth-google').click();
  await page.getByTestId('mock-account-bob@gmail.com').click();
  await expect(page.getByTestId('user-email')).toContainText('bob@gmail.com');
  await page.getByTestId('logout-button').click();
  await page.getByTestId('oauth-microsoft').click();
  await page.getByTestId('mock-account-carol@outlook.com').click();
  await expect(page.getByTestId('user-email')).toContainText('carol@outlook.com');
  await page.getByTestId('logout-button').click();
  await page.getByTestId('oauth-microsoft').click();
  await page.getByTestId('mock-account-dave@outlook.com').click();
  await expect(page.getByTestId('user-email')).toContainText('dave@outlook.com');
  await page.getByTestId('logout-button').click();
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
