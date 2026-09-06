import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4173';

function storageStateFor(items) {
  return {
    cookies: [],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [
          { name: 'equipmentJson', value: JSON.stringify({ _meta: { internalCopies: ['item'] }, item: items }) },
          { name: 'classesLookupJson', value: '{}' },
          { name: 'racesJson', value: JSON.stringify({ _v: 1, race: [], subrace: [] }) },
          { name: 'backgroundsJson', value: JSON.stringify({ _v: 1, background: [] }) },
        ],
      },
    ],
  };
}

const LIMIT = 5; // mirrors UNDO_LIMIT in main.html

const equipmentFixture = [
  { name: 'Longbow', source: 'PHB' },
  { name: 'Shortbow', source: 'PHB' },
];

test.use({ storageState: storageStateFor(equipmentFixture) });

test('add then delete an inventory item', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'bow');
  await expect(page.locator('#equipmentList li')).toHaveCount(2);

  await page.locator('#equipmentList li').first().click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove item' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Remove item' }).click();
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
  await page.getByRole('button', { name: 'Remove item' }).click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);

  await page.fill('#searchInput', 'bow');
  await page.locator('#equipmentList li').first().click();
  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
});

test('minus button floors at 0', async ({ page }) => {
  await page.goto('/main.html');
  await page.fill('#searchInput', 'bow');
  await page.locator('#equipmentList li').first().click();
  const counter = page.locator('#listWithHandle .inventory-item [x-text]');
  await expect(counter).toHaveText('1');
  const minus = page.locator('#listWithHandle .inventory-item button').filter({ hasText: '-' });
  await minus.click();
  await expect(counter).toHaveText('0');
  await minus.click();
  await expect(counter).toHaveText('0');
});

test('search edge cases: empty, no match, case-insensitive', async ({ page }) => {
  await page.goto('/main.html');
  await page.fill('#searchInput', '');
  await expect(page.locator('#equipmentList li')).toHaveCount(0);
  await page.fill('#searchInput', 'zzz');
  await expect(page.locator('#equipmentList li')).toHaveCount(0);
  await page.fill('#searchInput', 'BOW');
  await expect(page.locator('#equipmentList li')).toHaveCount(2); // Longbow + Shortbow
});

test.describe('undo', () => {
  const multiFixture = [
    { name: 'Axe', source: 'PHB' },
    { name: 'Bow', source: 'PHB' },
    { name: 'Club', source: 'PHB' },
    { name: 'Dagger', source: 'PHB' },
    { name: 'Flail', source: 'PHB' },
    { name: 'Glaive', source: 'PHB' },
  ];

  test.use({ storageState: storageStateFor(multiFixture) });

  test('undo button exists and is disabled on load', async ({ page }) => {
    await page.goto('/main.html');

    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('undo restores a deleted item', async ({ page }) => {
    await page.goto('/main.html');

    await page.fill('#searchInput', 'bow');
    await page.locator('#equipmentList li').first().click();

    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);

    await page.getByRole('button', { name: 'Remove item' }).click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
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

    await page.getByRole('button', { name: 'Remove item' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();

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
      .getByRole('button', { name: 'Remove item' })
      .click();

    await page.fill('#searchInput', 'dagger');
    await page.locator('#equipmentList li').first().click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(3);

    await page.getByRole('button', { name: 'Undo' }).click();

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
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(LIMIT + 1);

    const removeButton = page.getByRole('button', { name: 'Remove item' });
    for (let i = 0; i < LIMIT + 1; i++) {
      await removeButton.first().click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

    for (let i = 0; i < LIMIT; i++) {
      await page.getByRole('button', { name: 'Undo' }).click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(LIMIT);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(page.locator('#listWithHandle .inventory-item').filter({ hasText: 'Axe' })).toHaveCount(0);

    // Stack is empty and the button is disabled, so nothing can be undone —
    // the row count staying at LIMIT is the no-op proof.
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(LIMIT);
  });

  test('drag reorders inventory items', async ({ page }) => {
    test.slow();
    await page.goto('/main.html');
    await page.fill('#searchInput', 'axe');
    await page.locator('#equipmentList li').first().click();
    await page.fill('#searchInput', 'bow');
    await page.locator('#equipmentList li').first().click();
    const items = page.locator('#listWithHandle .inventory-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Axe');

    const grip = items.nth(0).locator('.move');
    const target = items.nth(1);
    await grip.hover();
    await page.mouse.down();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 20, { steps: 25 });
    await page.mouse.up();

    await expect(items.nth(0)).toContainText('Bow');
    await expect(items.nth(1)).toContainText('Axe');
  });

  test('undo restores multiple deletions in LIFO order', async ({ page }) => {
    await page.goto('/main.html');
    for (const n of ['axe', 'bow', 'club']) {
      await page.fill('#searchInput', n);
      await page.locator('#equipmentList li').first().click();
    }
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(3);
    // delete Bow (2nd), then Club (now 2nd)
    await page.locator('#listWithHandle .inventory-item').nth(1).getByRole('button', { name: 'Remove item' }).click();
    await page.locator('#listWithHandle .inventory-item').nth(1).getByRole('button', { name: 'Remove item' }).click();
    await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click(); // Club
    await page.getByRole('button', { name: 'Undo' }).click(); // Bow
    const items = page.locator('#listWithHandle .inventory-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Axe');
    await expect(items.nth(1)).toContainText('Bow');
    await expect(items.nth(2)).toContainText('Club');
  });
});

test.describe('offline', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('handles fetch failure without crashing', async ({ page }) => {
    await page.route('**/raw.githubusercontent.com/**', route => route.fulfill({ status: 500, body: 'error' }));
    await page.goto('/main.html');
    await expect(page.locator('#equipmentList')).toContainText('No equipment data loaded');
    await page.fill('#searchInput', 'bow');
    await expect(page.locator('#equipmentList li')).toHaveCount(0);
  });
});
