import { test, expect } from '@playwright/test';

const equipmentFixture = {
  _meta: { internalCopies: ['item'] },
  item: [
    { name: 'Longbow', source: 'PHB' },
    { name: 'Shortbow', source: 'PHB' },
  ],
};

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:4173',
        localStorage: [
          { name: 'equipmentJson', value: JSON.stringify(equipmentFixture) },
          { name: 'classesLookupJson', value: '{}' },
        ],
      },
    ],
  },
});

test('add then delete an inventory item', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'bow');
  await expect(page.locator('#equipmentList li')).toHaveCount(2);

  await page.locator('#equipmentList li').first().click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
  await expect(page.locator('[aria-label="Remove item"]')).toHaveCount(1);

  await page.locator('[aria-label="Remove item"]').click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);
});

test('counter is reactive after x-text fix', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'bow');
  await page.locator('#equipmentList li').first().click();

  const counter = page.locator('#listWithHandle .inventory-item [x-text]');
  await expect(counter).toHaveText('1');

  const plusButton = page
    .locator('#listWithHandle .inventory-item button')
    .filter({ hasText: '+' });
  await plusButton.click();

  await expect(counter).toHaveText('2');
});

test('re-add after delete works', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'bow');
  await page.locator('#equipmentList li').first().click();
  await page.locator('[aria-label="Remove item"]').click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);

  await page.fill('#searchInput', 'bow');
  await page.locator('#equipmentList li').first().click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
});

test.describe('undo', () => {
  const multiFixture = {
    _meta: { internalCopies: ['item'] },
    item: [
      { name: 'Axe', source: 'PHB' },
      { name: 'Bow', source: 'PHB' },
      { name: 'Club', source: 'PHB' },
      { name: 'Dagger', source: 'PHB' },
      { name: 'Flail', source: 'PHB' },
      { name: 'Glaive', source: 'PHB' },
    ],
  };

  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'equipmentJson', value: JSON.stringify(multiFixture) },
            { name: 'classesLookupJson', value: '{}' },
          ],
        },
      ],
    },
  });

  test('undo button exists and is disabled on load', async ({ page }) => {
    await page.goto('/main.html');

    await expect(page.locator('#undoDelete')).toBeVisible();
    await expect(page.locator('#undoDelete')).toBeDisabled();
  });

  test('undo restores a deleted item', async ({ page }) => {
    await page.goto('/main.html');

    await page.fill('#searchInput', 'bow');
    await page.locator('#equipmentList li').first().click();

    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);

    await page.locator('[aria-label="Remove item"]').click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);
    await expect(page.locator('#undoDelete')).toBeEnabled();

    await page.locator('#undoDelete').click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
    await expect(page.locator('#undoDelete')).toBeDisabled();
  });

  test('undo restores the prior count', async ({ page }) => {
    await page.goto('/main.html');

    await page.fill('#searchInput', 'bow');
    await page.locator('#equipmentList li').first().click();

    const counter = page.locator('#listWithHandle .inventory-item [x-text]');
    await expect(counter).toHaveText('1');

    const plusButton = page
      .locator('#listWithHandle .inventory-item button')
      .filter({ hasText: '+' });
    await plusButton.click();
    await plusButton.click();
    await expect(counter).toHaveText('3');

    await page.locator('[aria-label="Remove item"]').click();
    await page.locator('#undoDelete').click();

    await expect(counter).toHaveText('3');
  });

  test('undo restores original position', async ({ page }) => {
    await page.goto('/main.html');

    await page.fill('#searchInput', 'axe');
    await page.locator('#equipmentList li').first().click();
    await page.fill('#searchInput', 'bow');
    await page.locator('#equipmentList li').first().click();
    await page.fill('#searchInput', 'club');
    await page.locator('#equipmentList li').first().click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(3);

    await page
      .locator('#listWithHandle .inventory-item')
      .nth(1)
      .locator('[aria-label="Remove item"]')
      .click();

    await page.fill('#searchInput', 'dagger');
    await page.locator('#equipmentList li').first().click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(3);

    await page.locator('#undoDelete').click();

    const items = page.locator('#listWithHandle .inventory-item');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Axe');
    await expect(items.nth(1)).toContainText('Bow');
    await expect(items.nth(2)).toContainText('Club');
    await expect(items.nth(3)).toContainText('Dagger');
  });

  test('undo stack caps at 5', async ({ page }) => {
    await page.goto('/main.html');

    for (const name of ['axe', 'bow', 'club', 'dagger', 'flail', 'glaive']) {
      await page.fill('#searchInput', name);
      await page.locator('#equipmentList li').first().click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(6);

    const removeButton = page.locator('[aria-label="Remove item"]');
    for (let i = 0; i < 6; i++) {
      await removeButton.first().click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);
    await expect(page.locator('#undoDelete')).toBeEnabled();

    for (let i = 0; i < 5; i++) {
      await page.locator('#undoDelete').click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(5);
    await expect(page.locator('#undoDelete')).toBeDisabled();

    // Stack is empty and the button is disabled, so nothing can be undone —
    // the row count staying at 5 is the no-op proof.
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(5);
  });
});
