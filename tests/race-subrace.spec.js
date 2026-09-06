import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4173';

const racesFixture = {
  _v: 1,
  race: [
    { name: 'Dragonborn', source: 'PHB', size: ['M'], speed: 30, ability: [{ str: 2, cha: 1 }], languageProficiencies: [{ common: true, draconic: true }], entries: [{ type: 'entries', name: 'Breath Weapon', entries: ['...'] }] },
    { name: 'Dwarf', source: 'PHB', size: ['M'], speed: 25, ability: [{ con: 2 }], darkvision: 60, languageProficiencies: [{ common: true, dwarvish: true }], entries: [{ type: 'entries', name: 'Darkvision', entries: ['Dwarf darkvision'] }] },
    { name: 'Elf', source: 'PHB', size: ['M'], speed: 30, ability: [{ dex: 2 }], darkvision: 60, languageProficiencies: [{ common: true, elvish: true }], entries: [{ type: 'entries', name: 'Darkvision', entries: ['Elf darkvision'] }] },
    { name: 'Half-Elf', source: 'PHB', size: ['M'], speed: 30, ability: [{ cha: 2 }, { choose: { from: ['str', 'dex', 'con', 'int', 'wis'], count: 2 }, amount: 1 }], darkvision: 60, languageProficiencies: [{ common: true, elvish: true, anyStandard: 1 }], entries: [] },
    { name: 'Human', source: 'PHB', size: ['M'], speed: 30, ability: [{ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }], languageProficiencies: [{ common: true }], entries: [] },
  ],
  subrace: [
    { name: 'Hill', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB', ability: [{ wis: 1 }], entries: [] },
    { name: 'Mountain', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB', ability: [{ str: 2 }], entries: [] },
    { name: 'High', source: 'PHB', raceName: 'Elf', raceSource: 'PHB', ability: [{ int: 1 }], entries: [] },
    { name: 'Wood', source: 'PHB', raceName: 'Elf', raceSource: 'PHB', ability: [{ wis: 1 }], entries: [] },
    { name: 'Drow', source: 'PHB', raceName: 'Elf', raceSource: 'PHB', ability: [{ cha: 1 }], darkvision: 120, entries: [{ type: 'entries', name: 'Superior Darkvision', entries: ['Drow darkvision'], data: { overwrite: 'Darkvision' } }] },
    { name: 'Variant', source: 'PHB', raceName: 'Human', raceSource: 'PHB', ability: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], count: 2 }, amount: 1 }], entries: [] },
  ],
};

function storageStateFor(racesJson) {
  return {
    cookies: [],
    origins: [{
      origin: BASE_URL,
      localStorage: [
        { name: 'equipmentJson', value: JSON.stringify({ _meta: { internalCopies: ['item'] }, item: [] }) },
        { name: 'classesLookupJson', value: '{}' },
        { name: 'racesJson', value: JSON.stringify(racesJson) },
        { name: 'backgroundsJson', value: JSON.stringify({ _v: 1, background: [] }) },
      ],
    }],
  };
}

function abilityCell(page, fullName) {
  return page.getByLabel(fullName + ' base').locator('xpath=..');
}

test.describe('race + subrace selection', () => {
  test.use({ storageState: storageStateFor(racesFixture) });

  test('race select lists seeded races; subrace appears only for races with subraces', async ({ page }) => {
    await page.goto('/main.html');
    const raceSelect = page.getByLabel('Race', { exact: true });
    await expect(raceSelect.locator('option')).toHaveCount(6);

    await raceSelect.selectOption({ label: 'Dragonborn' });
    await expect(page.getByLabel('Subrace', { exact: true })).toBeHidden();

    await raceSelect.selectOption({ label: 'Dwarf' });
    const subraceSelect = page.getByLabel('Subrace', { exact: true });
    await expect(subraceSelect).toBeVisible();
    await expect(subraceSelect.locator('option')).toHaveCount(3);
  });

  test('Dwarf derived: speed 25, size Medium, ASI Con +2, languages', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Dwarf' });
    await expect(abilityCell(page, 'Constitution')).toContainText('Total 12');
    await expect(page.getByText('25 ft.', { exact: true })).toBeVisible();
    await expect(page.getByText('Medium', { exact: true })).toBeVisible();
    await expect(page.getByText('Common, Dwarvish', { exact: true })).toBeVisible();
  });

  test('Mountain Dwarf adds Str +2', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Dwarf' });
    await page.getByLabel('Subrace', { exact: true }).selectOption({ label: 'Mountain' });
    await expect(abilityCell(page, 'Strength')).toContainText('Total 12');
    await expect(abilityCell(page, 'Constitution')).toContainText('Total 12');
  });

  test('Human ASI is +1 to all six', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Human' });
    for (const name of ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']) {
      await expect(abilityCell(page, name)).toContainText('Total 11');
    }
  });

  test('Variant Human subrace is displayed as "Variant Human"', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Human' });
    const subraceSelect = page.getByLabel('Subrace', { exact: true });
    await expect(subraceSelect).toBeVisible();
    await expect(subraceSelect.locator('option')).toHaveCount(2);
    await expect(subraceSelect.locator('option').nth(1)).toHaveText('Variant Human');
  });

  test('Half-Elf shows fixed ASI + pending choose note', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Half-Elf' });
    await expect(abilityCell(page, 'Charisma')).toContainText('Total 12');
    await expect(page.getByLabel('ASI choice')).toHaveCount(2);
    await expect(page.getByText('Common, Elvish, 1 of your choice', { exact: true })).toBeVisible();
  });

  test('Drow darkvision overrides Elf darkvision (120 ft)', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Elf' });
    await expect(page.getByText('60 ft.', { exact: true })).toBeVisible();
    await page.getByLabel('Subrace', { exact: true }).selectOption({ label: 'Drow' });
    await expect(page.getByText('120 ft.', { exact: true })).toBeVisible();
    const traits = page.locator('ul');
    await expect(traits.getByText('Superior Darkvision', { exact: true })).toBeVisible();
    await expect(traits.getByText('Darkvision', { exact: true })).toHaveCount(0);
  });

  test('switching race resets subrace selection', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Dwarf' });
    await page.getByLabel('Subrace', { exact: true }).selectOption({ label: 'Hill' });
    await page.getByLabel('Race', { exact: true }).selectOption({ label: 'Human' });
    await expect(page.getByLabel('Subrace', { exact: true })).toHaveValue('');
  });
});

test.describe('race + subrace: empty data', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders placeholder only, no crash', async ({ page }) => {
    await page.route('**/raw.githubusercontent.com/**', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.goto('/main.html');
    await expect(page.getByLabel('Race', { exact: true }).locator('option')).toHaveCount(1);
  });
});
