import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.goto('http://localhost:3000/login');

  await expect(page).toHaveTitle(/เข้าสู่ระบบ/);
  
});

test('login fail', async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.goto('http://localhost:3000/app');

  await expect(page).toHaveTitle(/เข้าสู่ระบบ/);
  
});

// test('loop number for input', async ({ page }) => {
//   await page.goto('http://localhost:3000/login');
//   await page.getByTestId('oauth-google').click();
//   await page.getByTestId('mock-account-alice@gmail.com').click();
//   await expect(page).toHaveURL(/\/app/);

//   const numberKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
//   for (const num of numberKeys) {
//     await page.getByTestId(`key-${num}`).click();
//     await expect(page.getByTestId('calc-result')).toHaveText(num);
//     await page.getByTestId('key-clear').click();
//   }
// });

// test('loop number for input', async ({ page }) => {
//   await page.goto('http://localhost:3000/app');

// const numberKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
//  for (const num of numberKeys) {
//      await page.getByRole('button', { name: num }).click();
//      await expect(page.getByTestId('display')).toContainText(num);
//      await page.waitForTimeout(2000); 
//      await page.getByTestId('key-clear').click();
//      }
// });
