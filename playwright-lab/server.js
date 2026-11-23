import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

// ฟังก์ชันช่วยกดเลขทีละหลัก เช่น 25 จะกดปุ่ม 2 แล้วตามด้วยปุ่ม 5
async function pressNumber(page, num) {
  for (const digit of String(num)) {
    await page.getByTestId(`key-${digit}`).click();
  }
}

// ฟังก์ชันคำนวณผลลัพธ์คาดหวังให้ตรงกับ logic ของระบบ
function expectedCalc(a, b, op) {
  if (op === '+') return String(a + b);
  if (op === '-') return String(a - b);
  if (op === '*') return String(a * b);
  if (op === '/') {
    if (!a || !b) return null; // ระบบคืน null เมื่อ a หรือ b เป็น 0
    return String(Math.trunc((a * 100) / b) / 100);
  }
  return null;
}

test.describe('ลูปทดสอบตัวเลขและเครื่องหมายคำนวณ', () => {
  test.beforeEach(async ({ page }) => {
    // ล็อกอินด้วยบัญชี mock ก่อนเข้าหน้าเครื่องคิดเลข
    await page.goto(`${BASE_URL}/login`);
    await page.getByTestId('oauth-google').click();
    await page.getByTestId('mock-account-alice@gmail.com').click();
    await expect(page).toHaveURL(/\/app/);
  });

  test('วนลูปทดสอบตัวเลข 0-99 กับเครื่องหมาย +, -, *, /', async ({ page }) => {
    // กำหนดรายการเครื่องหมายและ testId ของปุ่มบนหน้าเว็บ
    const operators = [
      { symbol: '+', testId: 'key-add' },
      { symbol: '-', testId: 'key-subtract' },
      { symbol: '*', testId: 'key-multiply' },
      { symbol: '/', testId: 'key-divide' },
    ];

    // หากต้องการเทสทุกตัว 0-99 ให้เปลี่ยนช่วงหรือใช้ 0 ถึง 99 ตามต้องการ
    // หมายเหตุ: 100 x 100 x 4 = 40,000 รอบ หากรันผ่าน UI ทั้งหมดจะใช้เวลานานมาก
    const startNum = 0;
    const endNum = 99;

    // ลูปชั้นที่ 1: ตัวตั้ง (a)
    for (let a = startNum; a <= endNum; a++) {
      // ลูปชั้นที่ 2: ตัวหาร/ตัวบวก/ตัวลบ/ตัวคูณ (b)
      for (let b = startNum; b <= endNum; b++) {
        // ลูปชั้นที่ 3: เครื่องหมายคำนวณ
        for (const op of operators) {
          // กดปุ่มล้างค่าเริ่มต้นก่อนทุกครั้ง
          await page.getByTestId('key-clear').click();

          // กรอกเลขตัวแรก แล้วกดเครื่องหมาย แล้วกรอกเลขตัวที่สอง แล้วกดเท่ากับ
          await pressNumber(page, a);
          await page.getByTestId(op.testId).click();
          await pressNumber(page, b);
          await page.getByTestId('key-equals').click();

          const expected = expectedCalc(a, b, op.symbol);
          const errorLocator = page.getByTestId('calc-error');
          const resultLocator = page.getByTestId('calc-result');

          // ตรวจสอบว่าควรได้ผลลัพธ์หรือควรขึ้นข้อความ error
          if (expected === null || a >= 99 || b >= 99) {
            await expect(errorLocator).not.toBeEmpty();
          } else {
            await expect(resultLocator).toHaveText(expected);
          }
        }
      }
    }
  });
});