import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4173';

const backgroundsFixture = {
  _v: 1,
  background: [
    {
      name: 'Acolyte',
      source: 'PHB',
      skillProficiencies: [{ insight: true, religion: true }],
      languageProficiencies: [{ any: 2 }],
      entries: [
        'You have spent your life in the service of a temple.',
        { type: 'entries', name: 'Feature: Shelter of the Faithful', entries: ['You can perform the religious ceremonies of your deity.', 'You might also have ties to a specific temple.'] },
        { type: 'entries', name: 'Equipment', entries: ['A {@item holy symbol|PHB}, a set of {@item common clothes|PHB}, and a {@item pouch|PHB} containing 15 gp'] },
        {
          type: 'entries',
          name: 'Suggested Characteristics',
          entries: [
            { type: 'table', caption: 'Personality Trait', colLabels: ['d8', 'Personality Trait'], rows: [['1', 'I idolize a particular hero of my faith.'], ['2', 'I can find common ground between the fiercest enemies.']] },
            { type: 'table', caption: 'Ideal', colLabels: ['d6', 'Ideal'], rows: [['1', 'Tradition. The ancient traditions of worship must be preserved. (Lawful)']] },
            { type: 'table', caption: 'Bond', colLabels: ['d6', 'Bond'], rows: [['1', 'I would die to recover an ancient relic of my faith.']] },
            { type: 'table', caption: 'Flaw', colLabels: ['d6', 'Flaw'], rows: [['1', 'I judge others harshly, and myself even more severely.']] },
          ],
        },
      ],
    },
    {
      name: 'Criminal',
      source: 'PHB',
      skillProficiencies: [{ deception: true, stealth: true }],
      toolProficiencies: [{ "thieves' tools": true }],
      languageProficiencies: [],
      entries: [
        { type: 'entries', name: 'Feature: Criminal Contact', entries: ['You have a reliable and trustworthy contact.'] },
        { type: 'entries', name: 'Equipment', entries: ['A {@item crowbar|PHB} and a set of dark common clothes.'] },
        { type: 'entries', name: 'Suggested Characteristics', entries: [{ type: 'table', caption: 'Personality Trait', rows: [['1', 'I always have a plan for what to do when things go wrong.']] }] },
      ],
    },
    {
      name: 'Guild Artisan',
      source: 'PHB',
      skillProficiencies: [{ insight: true, persuasion: true }],
      toolProficiencies: [{ choose: { from: ['disguise kit', 'musical instrument'], count: 1 } }],
      languageProficiencies: [{ any: 1 }],
      entries: [
        { type: 'entries', name: 'Feature: Guild Membership', entries: ['You can maintain a modest lifestyle without having to pay for it.'] },
      ],
    },
  ],
};

function storageStateFor(backgroundsJson) {
  return {
    cookies: [],
    origins: [{
      origin: BASE_URL,
      localStorage: [
        { name: 'equipmentJson', value: JSON.stringify({ _meta: { internalCopies: ['item'] }, item: [] }) },
        { name: 'classesLookupJson', value: '{}' },
        { name: 'racesJson', value: JSON.stringify({ _v: 1, race: [], subrace: [] }) },
        { name: 'backgroundsJson', value: JSON.stringify(backgroundsJson) },
      ],
    }],
  };
}

test.describe('background selection', () => {
  test.use({ storageState: storageStateFor(backgroundsFixture) });

  test('background select lists seeded backgrounds', async ({ page }) => {
    await page.goto('/main.html');
    await expect(page.getByLabel('Background', { exact: true }).locator('option')).toHaveCount(4);
  });

  test('Acolyte populates proficiencies, languages, feature, equipment, personality', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Acolyte' });
    await expect(page.getByText('Skill: Insight, Skill: Religion', { exact: true })).toBeVisible();
    await expect(page.getByText('2 of your choice', { exact: true })).toBeVisible();
    await expect(page.getByText('Feature: Shelter of the Faithful', { exact: true })).toBeVisible();
    await expect(page.getByText('A holy symbol, a set of common clothes, and a pouch containing 15 gp', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Personality Traits')).toHaveValue('I idolize a particular hero of my faith.');
    await expect(page.getByLabel('Ideals')).toHaveValue('Tradition. The ancient traditions of worship must be preserved. (Lawful)');
  });

  test('Criminal populates tool proficiencies', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Criminal' });
    await expect(page.getByText("Skill: Deception, Skill: Stealth, Tool: Thieves' tools", { exact: true })).toBeVisible();
  });

  test('choose-tool proficiency is surfaced', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Guild Artisan' });
    await expect(page.getByText('Skill: Insight, Skill: Persuasion, Tool: Choose 1 from: disguise kit, musical instrument (your choice)', { exact: true })).toBeVisible();
    await expect(page.getByText('1 of your choice', { exact: true })).toBeVisible();
  });

  test('switching background updates derived fields', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Acolyte' });
    await expect(page.getByText('Skill: Insight, Skill: Religion', { exact: true })).toBeVisible();
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Criminal' });
    await expect(page.getByText("Skill: Deception, Skill: Stealth, Tool: Thieves' tools", { exact: true })).toBeVisible();
    await expect(page.getByText('Skill: Insight, Skill: Religion', { exact: true })).toHaveCount(0);
  });
});

test.describe('background: empty data', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders placeholder only, no crash', async ({ page }) => {
    await page.route('**/raw.githubusercontent.com/**', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.goto('/main.html');
    await expect(page.getByLabel('Background', { exact: true }).locator('option')).toHaveCount(1);
  });
});
