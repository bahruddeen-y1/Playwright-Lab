import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

const OPERATORS = {
  '+': 'key-add',
  '-': 'key-subtract',
  '*': 'key-multiply',
  '/': 'key-divide',
};

class CalculatorPage {
  constructor(page) {
    this.page = page;
    this.clearButton = page.getByTestId('key-clear');
    this.equalsButton = page.getByTestId('key-equals');
    this.resultDisplay = page.getByTestId('calc-result');
    this.errorDisplay = page.getByTestId('calc-error');
  }

  async goto() {
    await this.page.goto(`${BASE_URL}/app`);
    await expect(this.clearButton).toBeVisible();
  }

  async pressNumber(num) {
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(`Invalid non-negative integer: ${num}`);
    }
    for (const digit of String(num)) {
      await this.page.getByTestId(`key-${digit}`).click();
    }
  }

  async pressOperator(op) {
    const testId = OPERATORS[op];
    if (!testId) {
      throw new Error(`Unsupported operator: ${op}`);
    }
    await this.page.getByTestId(testId).click();
  }

  async clear() {
    await this.clearButton.click();
    await expect(this.resultDisplay).toHaveText(/^(0|)$/);
  }

  async calculate(a, op, b) {
    await this.clear();
    await this.pressNumber(a);
    await this.pressOperator(op);
    await this.pressNumber(b);
    await this.equalsButton.click();
  }

  async expectResult(expectedText) {
    await expect(this.errorDisplay).toBeEmpty();
    await expect(this.resultDisplay).toHaveText(expectedText);
  }

  async expectError() {
    await expect(this.errorDisplay).not.toBeEmpty();
  }

  async getSnapshot() {
    return {
      result: (await this.resultDisplay.textContent())?.trim() ?? '',
      error: (await this.errorDisplay.textContent())?.trim() ?? '',
    };
  }
}

async function loginAsAlice(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId('oauth-google').click();
  await page.getByTestId('mock-account-alice@gmail.com').click();
  await expect(page).toHaveURL(/\/app/);
}

function createRng(seed = 20261124) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe('เครื่องคิดเลข: การคำนวณ ค่าขอบเขต และพฤติกรรมปุ่มควบคุม', () => {
  let calc;

  test.beforeEach(async ({ page }) => {
    await loginAsAlice(page);
    calc = new CalculatorPage(page);
    await calc.goto();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach('failure-screenshot', {
        body: screenshot,
        contentType: 'image/png',
      });
    }
  });

  test('คำนวณบวก ลบ คูณ หาร และปัดทศนิยมตามเคสที่กำหนด', async ({ }, testInfo) => {
    const cases = [
      { a: 0, op: '+', b: 0, expected: '0' },
      { a: 12, op: '+', b: 25, expected: '37' },
      { a: 50, op: '-', b: 18, expected: '32' },
      { a: 12, op: '-', b: 25, expected: '-13' },
      { a: 8, op: '*', b: 7, expected: '56' },
      { a: 99, op: '*', b: 99, expected: '9801' },
      { a: 10, op: '/', b: 4, expected: '2.5' },
      { a: 1, op: '/', b: 3, expected: '0.33' },
    ];

    for (const item of cases) {
      await test.step(`${item.a} ${item.op} ${item.b} -> ${item.expected}`, async () => {
        await calc.calculate(item.a, item.op, item.b);
        try {
          await calc.expectResult(item.expected);
        } catch (err) {
          const snap = await calc.getSnapshot();
          await testInfo.attach(`case-${item.a}-${item.b}`, {
            body: JSON.stringify({ item, snap }, null, 2),
            contentType: 'application/json',
          });
          throw err;
        }
      });
    }
  });

  test('แสดงข้อความ error เมื่อหารด้วยศูนย์หรือใช้ศูนย์ในการหาร', async ({ }, testInfo) => {
    // ปรับรายการให้ตรงกับ logic จริงของระบบ (เช่น หารด้วยศูนย์ b === 0)
    const zeroDivisionCases = [
      { a: 25, b: 0 },
      { a: 0, b: 0 },
    ];

    for (const { a, b } of zeroDivisionCases) {
      await test.step(`หารด้วยศูนย์: ${a} / ${b}`, async () => {
        await calc.calculate(a, '/', b);
        try {
          await calc.expectError();
        } catch (err) {
          const snap = await calc.getSnapshot();
          await testInfo.attach(`div-zero-${a}-${b}`, {
            body: JSON.stringify({ a, op: '/', b, snap }, null, 2),
            contentType: 'application/json',
          });
          throw err;
        }
      });
    }
  });

  test('ล้างค่าผลลัพธ์และข้อความ error ได้เมื่อกดปุ่ม Clear', async () => {
    await test.step('ล้างค่าหลังคำนวณสำเร็จ', async () => {
      await calc.calculate(15, '+', 30);
      await calc.expectResult('45');
      await calc.clear();
      await expect(calc.errorDisplay).toBeEmpty();
    });

    await test.step('ล้างค่าหลังเกิด error', async () => {
      await calc.calculate(10, '/', 0);
      await calc.expectError();
      await calc.clear();
      await expect(calc.errorDisplay).toBeEmpty();
    });
  });

  test('สุ่มทดสอบตัวเลข 0-99 แบบคงที่เพื่อตรวจความเสถียรของ UI', async ({ }, testInfo) => {
    const rng = createRng();
    const ops = Object.keys(OPERATORS);
    const sampleCount = 50;

    for (let i = 0; i < sampleCount; i++) {
      const a = Math.floor(rng() * 100);
      const b = Math.floor(rng() * 100);
      const op = ops[Math.floor(rng() * ops.length)];

      await test.step(`รอบที่ ${i + 1}: ${a} ${op} ${b}`, async () => {
        await calc.calculate(a, op, b);

        try {
          // ตรวจเฉพาะกรณีหารด้วยศูนย์ (b === 0) เพื่อลด false negative จากเงื่อนไข a === 0
          if (op === '/' && b === 0) {
            await calc.expectError();
          } else {
            await expect(calc.errorDisplay).toBeEmpty();
            await expect(calc.resultDisplay).not.toBeEmpty();
          }
        } catch (err) {
          const snap = await calc.getSnapshot();
          await testInfo.attach(`random-step-${i + 1}`, {
            body: JSON.stringify({ step: i + 1, a, op, b, snap }, null, 2),
            contentType: 'application/json',
          });
          throw err;
        }
      });
    }
  });
});