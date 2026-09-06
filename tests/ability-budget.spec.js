import { test, expect } from '@playwright/test';

// Point-buy: 27 points; cost 8=0,9=1,10=2,11=3,12=4,13=5,14=7,15=9.
// Budget = 27 + 2*asiCount - sum(pointCost(base)) - 2*featsPicked.
// Variant human's +1s are free (counter unchanged).

const featsFixture = {
  _v: 1,
  feat: [
    { name: 'Actor', source: 'PHB' },
    { name: 'Alert', source: 'PHB' },
  ],
};

const racesFixture = {
  _v: 1,
  race: [
    { name: 'Human', source: 'PHB', size: ['M'], speed: 30, ability: null, entries: [] },
  ],
  subrace: [
    {
      name: 'Variant', source: 'PHB', raceName: 'Human', raceSource: 'PHB',
      ability: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], count: 2 } }],
      feats: [{ any: 1 }],
      entries: [],
    },
  ],
};

const classesLookupFixture = {
  PHB: { Barbarian: { PHB: { Berserker: { name: 'Path of the Berserker' } } } },
};

const classAsiFixture = { _v: 1, Barbarian: [4, 8, 12, 16, 19] };

function storageStateFor(overrides = {}) {
  return {
    cookies: [],
    origins: [{
      origin: 'http://localhost:4173',
      localStorage: [
        { name: 'equipmentJson', value: JSON.stringify({ _meta: { internalCopies: ['item'] }, item: [] }) },
        { name: 'classesLookupJson', value: JSON.stringify(classesLookupFixture) },
        { name: 'racesJson', value: JSON.stringify(racesFixture) },
        { name: 'backgroundsJson', value: JSON.stringify({ _v: 1, background: [] }) },
        { name: 'featsJson', value: JSON.stringify(featsFixture) },
        { name: 'classAsiJson', value: JSON.stringify(classAsiFixture) },
        ...(overrides.extra || []),
      ],
    }],
  };
}

const budget = (page) => page.locator('#abilityBudgetRemaining');

test.describe('ability score budget', () => {
  test.use({ storageState: storageStateFor() });

  test('default budget is 27 minus cost of six 10s (15)', async ({ page }) => {
    await page.goto('/main.html');
    await expect(budget(page)).toHaveText('15');
  });

  test('raising a base score to 15 reduces budget by its cost (9)', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Strength base').fill('15');
    await expect(budget(page)).toHaveText('8'); // 27 - (9 + 5*2)
  });

  test('class level adds 2 points per ASI earned', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('4'); // first ASI at 4
    await expect(budget(page)).toHaveText('17'); // 15 + 2
    await page.getByLabel('Level', { exact: true }).fill('8'); // second ASI at 8
    await expect(budget(page)).toHaveText('19'); // 15 + 4
  });

  test('picking feats in the modal reduces budget by 2 each', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByRole('button', { name: 'Add Feat' }).click();
    await page.getByRole('checkbox', { name: 'Actor' }).check();
    await expect(budget(page)).toHaveText('13'); // 15 - 2
    await page.getByRole('checkbox', { name: 'Alert' }).check();
    await expect(budget(page)).toHaveText('11'); // 15 - 4
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('checkbox', { name: 'Actor' })).toBeHidden();
  });

  test('variant human does not change the budget', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Human' });
    await expect(budget(page)).toHaveText('15');
    await page.getByLabel('Subrace', { exact: true }).selectOption({ label: 'Variant Human' });
    await expect(budget(page)).toHaveText('15');
  });
});

test.describe('ability score budget: data loading', () => {
  test('feats and class ASI load from fetch when cache is empty', async ({ page }) => {
    await page.route('**/feats.json', (route) => route.fulfill({ json: { feat: featsFixture.feat } }));
    await page.route('**/class/class-barbarian.json', (route) => route.fulfill({
      json: {
        class: [{ name: 'Barbarian', source: 'PHB' }],
        classFeature: [
          { name: 'Ability Score Improvement', level: 4 },
          { name: 'Ability Score Improvement', level: 8 },
        ],
      },
    }));
    await page.goto('/main.html');
    // Feat picker populated from fetched feats.json
    await page.getByRole('button', { name: 'Add Feat' }).click();
    await expect(page.getByRole('checkbox', { name: 'Actor' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    // Class ASI from fetched class file
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('4');
    await expect(budget(page)).toHaveText('17');
  });
});
