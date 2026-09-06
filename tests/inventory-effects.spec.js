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

const equipmentFixture = [
  { name: 'Gauntlets of Ogre Power', source: 'DMG', rarity: 'uncommon', entries: ['Your Strength score is 19 while you wear these gauntlets.'] },
  { name: 'Longbow', source: 'PHB' },
  { name: 'Wand of Magic Missiles', source: 'DMG', rarity: 'uncommon', entries: ['This wand has 7 charges. While holding it, you can use an action to expend 1 or more of its charges to cast the magic missile spell from it.'] },
];

test.use({ storageState: storageStateFor(equipmentFixture) });

// The Strength ability card: the base input has aria-label "Strength base";
// its ancestor card shows "Total <value>" (the value span is a child of the
// "Total" div).
function strengthTotal(page) {
  return page.getByLabel('Strength base').locator('xpath=ancestor::div[contains(@class,"border")][1]').locator('div:has-text("Total")').locator('span');
}

// The Perception skill row: the proficiency checkbox has aria-label
// "Perception proficiency"; the bonus is the last span in the row.
function perceptionBonus(page) {
  return page.getByLabel('Perception proficiency').locator('xpath=ancestor::div[contains(@class,"flex")][1]').locator('span').last();
}

test('catalog item pre-fills a set effect and raises the ability total', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'gauntlets');
  await page.locator('#equipmentList li').first().click();

  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
  await expect(strengthTotal(page)).toHaveText('19');
  // Misc Features section appears with the item-derived feature.
  await expect(page.getByLabel('Misc Features')).toBeVisible();
  await expect(page.getByLabel('Misc Features')).toContainText('Your Strength is 19 while you carry this.');
});

test('a set effect does not lower a score already above the set value', async ({ page }) => {
  await page.goto('/main.html');

  await page.evaluate(() => {
    const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
    d.character.abilities.str.base = 20;
  });

  await page.fill('#searchInput', 'gauntlets');
  await page.locator('#equipmentList li').first().click();

  await expect(strengthTotal(page)).toHaveText('20');
});

test('a manual bonus effect on a skill raises its bonus', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'longbow');
  await page.locator('#equipmentList li').first().click();

  const before = await perceptionBonus(page).textContent();
  await page.getByRole('button', { name: 'Add effect' }).click();
  await page.getByLabel('Effect type').selectOption('bonus');
  await page.getByLabel('Effect target').selectOption('perception');
  await page.getByLabel('Effect value').fill('2');
  await page.getByRole('button', { name: 'Save effect' }).click();

  const after = await perceptionBonus(page).textContent();
  expect(Number(after)).toBe(Number(before) + 2);
});

test('a proficiency effect grants proficiency exactly once even if already proficient', async ({ page }) => {
  await page.goto('/main.html');

  await page.evaluate(() => {
    const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
    d.character.skillProfs.perception = true;
  });

  await page.fill('#searchInput', 'longbow');
  await page.locator('#equipmentList li').first().click();

  await page.getByRole('button', { name: 'Add effect' }).click();
  await page.getByLabel('Effect type').selectOption('proficiency');
  await page.getByLabel('Effect target').selectOption('perception');
  await page.getByRole('button', { name: 'Save effect' }).click();

  // wis 10 -> mod 0; prof bonus at level 1 = +2; granted exactly once.
  await expect(perceptionBonus(page)).toHaveText('+2');
});

test('Misc Features section is hidden when no item has an effect', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'longbow');
  await page.locator('#equipmentList li').first().click();

  await expect(page.getByLabel('Misc Features')).toBeHidden();
});

test('a magic item with no manual effect appears in Misc Features', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'wand');
  await page.locator('#equipmentList li').first().click();

  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
  await expect(page.getByLabel('Misc Features')).toBeVisible();
  await expect(page.getByLabel('Misc Features')).toContainText('Wand of Magic Missiles');
  await expect(page.getByLabel('Misc Features')).toContainText('This wand has 7 charges.');
});

test('inventory and its effect persist across reload', async ({ page }) => {
  await page.goto('/main.html');

  await page.fill('#searchInput', 'gauntlets');
  await page.locator('#equipmentList li').first().click();
  await expect(strengthTotal(page)).toHaveText('19');

  await page.getByRole('button', { name: 'Save Character' }).click();
  await page.reload();

  await expect(page.locator('#listWithHandle .inventory-item')).toHaveCount(1);
  await expect(page.locator('#listWithHandle .inventory-item')).toContainText('Gauntlets of Ogre Power');
  await expect(strengthTotal(page)).toHaveText('19');
  await expect(page.getByLabel('Misc Features')).toBeVisible();
});
