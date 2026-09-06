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

const backgroundsFixture = {
  _v: 1,
  background: [
    {
      name: 'Acolyte', source: 'PHB',
      skillProficiencies: [{ insight: true, religion: true }],
      languageProficiencies: [{ anyStandard: 2 }],
      entries: [
        { name: 'Feature: Shelter of the Faithful', type: 'entries', entries: ['As an acolyte, you command the respect of those who share your faith.'] },
        { name: 'Equipment', type: 'entries', entries: ['A holy symbol, a prayer book, 5 sticks of incense.'] },
      ],
    },
  ],
};

const classAsiFixture = {
  _v: 1,
  Barbarian: {
    levels: [4, 8, 12, 16, 19],
    classFeatures: [
      { name: 'Rage', level: 1, text: 'In battle, you fight with primal ferocity.' },
      { name: 'Unarmored Defense', level: 1, text: 'While you are not wearing any armor, your Armor Class equals 10 + your Dex modifier + your Con modifier.' },
      { name: 'Danger Sense', level: 2, text: 'You gain an uncanny sense of when things nearby are not as they should be.' },
      { name: 'Reckless Attack', level: 2, text: 'You can throw aside all concern for defense to attack with fierce desperation.' },
      { name: 'Ability Score Improvement', level: 4, text: 'You can increase one ability score by 2 or two by 1.' },
      { name: 'Extra Attack', level: 5, text: 'You can attack twice, instead of once, whenever you take the Attack action.' },
    ],
    subclassFeatures: {
      Berserker: [
        { name: 'Frenzy', level: 3, text: 'You can go into a frenzy when you rage.' },
        { name: 'Mindless Rage', level: 6, text: 'You cannot be charmed or frightened while raging.' },
      ],
      'Totem Warrior': [
        { name: 'Spirit Seeker', level: 3, text: 'You gain the ability to cast the beast sense ritual.' },
      ],
    },
  },
};

function storageStateFor(overrides = {}) {
  return {
    cookies: [],
    origins: [{
      origin: 'http://localhost:4173',
      localStorage: [
        { name: 'equipmentJson', value: JSON.stringify({ _meta: { internalCopies: ['item'] }, item: [] }) },
        { name: 'classesLookupJson', value: JSON.stringify(classesLookupFixture) },
        { name: 'racesJson', value: JSON.stringify(racesFixture) },
        { name: 'backgroundsJson', value: JSON.stringify(backgroundsFixture) },
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
    // Barbarian 8 grants 2 ASIs -> 2 feat slots, budget 19
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Add Feat' }).click();
    await page.getByRole('checkbox', { name: 'Actor' }).check();
    await expect(budget(page)).toHaveText('17'); // 19 - 2
    await page.getByRole('checkbox', { name: 'Alert' }).check();
    await expect(budget(page)).toHaveText('15'); // 19 - 4
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

test.describe('ability score budget: clamps', () => {
  test.use({ storageState: storageStateFor() });

  test('ability input clamps back to an affordable score when overspent', async ({ page }) => {
    await page.goto('/main.html');
    // str 15 (cost 9) -> budget 8
    await page.getByLabel('Strength base').fill('15');
    await page.getByLabel('Strength base').blur();
    await expect(budget(page)).toHaveText('8');
    // dex 15 (cost 9-2=7 <= 8) -> budget 1
    await page.getByLabel('Dexterity base').fill('15');
    await page.getByLabel('Dexterity base').blur();
    await expect(budget(page)).toHaveText('1');
    // con 15 (cost 9-2=7 > 1) -> clamped back to 11 (cost 3-2=1), budget 0
    await page.getByLabel('Constitution base').fill('15');
    await page.getByLabel('Constitution base').blur();
    await expect(page.getByLabel('Constitution base')).toHaveValue('11');
    await expect(budget(page)).toHaveText('0');
  });

  test('feat add is blocked when it would push the budget below zero', async ({ page }) => {
    await page.goto('/main.html');
    // 1 ASI -> budget 29; spend to budget 1 (baseCost 28) via state so the
    // ability clamp does not interfere: str 15 (9), dex 15 (9), con 11 (3), int 11 (3)
    await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.asiCount = 1;
      d.character.abilities.str.base = 15;
      d.character.abilities.dex.base = 15;
      d.character.abilities.con.base = 11;
      d.character.abilities.int.base = 11;
    });
    await expect(budget(page)).toHaveText('1');
    // Adding a feat (cost 2) is blocked
    await page.getByRole('button', { name: 'Add Feat' }).click();
    await page.getByRole('checkbox', { name: 'Actor' }).click();
    await expect(page.getByRole('checkbox', { name: 'Actor' })).not.toBeChecked();
    await expect(budget(page)).toHaveText('1');
  });

  test('unchecking a feat refunds its 2 points', async ({ page }) => {
    await page.goto('/main.html');
    // Barbarian 4 grants 1 ASI -> 1 feat slot, budget 17
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Add Feat' }).click();
    await page.getByRole('checkbox', { name: 'Actor' }).check();
    await expect(budget(page)).toHaveText('15');
    await page.getByRole('checkbox', { name: 'Actor' }).uncheck();
    await expect(budget(page)).toHaveText('17');
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

test.describe('ability score budget: class & subclass features (cached)', () => {
  test.use({ storageState: storageStateFor() });

  test('class features show with descriptions for the selected class and level', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('4');
    // Features at level <= 4 from the cached fixture, with description text
    await expect(page.getByText('Rage', { exact: true })).toBeVisible();
    await expect(page.getByText('In battle, you fight with primal ferocity.')).toBeVisible();
    await expect(page.getByText('Unarmored Defense', { exact: true })).toBeVisible();
    // Raising the level reveals higher-level features
    await page.getByLabel('Level', { exact: true }).fill('8');
    await expect(page.getByText('Extra Attack', { exact: true })).toBeVisible();
  });

  test('subclass features show with Level prefix when a subclass is picked', async ({ page }) => {
    await page.goto('/main.html');
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Barbarian (PHB)' });
    await page.getByLabel('Level', { exact: true }).fill('3');
    // No subclass selected yet: no subclass feature
    await expect(page.getByText('Level 3: Frenzy')).toHaveCount(0);
    await page.getByLabel('Subclass', { exact: true }).selectOption({ label: 'Path of the Berserker' });
    // Subclass feature renders with 5etools-style Level prefix and text
    await expect(page.getByText('Level 3: Frenzy')).toBeVisible();
    await expect(page.getByText('You can go into a frenzy when you rage.')).toBeVisible();
    // Lower level hides it
    await page.getByLabel('Level', { exact: true }).fill('2');
    await expect(page.getByText('Level 3: Frenzy')).toHaveCount(0);
    // Raising the level reveals it and the level-6 feature
    await page.getByLabel('Level', { exact: true }).fill('6');
    await expect(page.getByText('Level 6: Mindless Rage')).toBeVisible();
    // Switching subclass swaps the feature list
    await page.getByLabel('Subclass', { exact: true }).selectOption({ label: 'Path of the Totem Warrior' });
    await expect(page.getByText('Level 3: Frenzy')).toHaveCount(0);
    await expect(page.getByText('Spirit Seeker')).toBeVisible();
  });
});

test.describe('ability score budget: background feature', () => {
  test.use({ storageState: storageStateFor() });

  test('feature label is hidden until a background is selected', async ({ page }) => {
    await page.goto('/main.html');
    // No background selected: no visible "Feature:" label
    await expect(page.getByText('Feature:', { exact: false })).toBeHidden();
    // Select Acolyte: feature name and text appear
    await page.getByLabel('Background', { exact: true }).selectOption({ label: 'Acolyte' });
    await expect(page.getByText('Feature: Shelter of the Faithful', { exact: true })).toBeVisible();
    await expect(page.getByText('As an acolyte, you command the respect of those who share your faith.', { exact: true })).toBeVisible();
  });

  test('feature renders for a saved character with a background already set', async ({ page }) => {
    // Seed a saved character whose background is already Acolyte, so the
    // background feature must be recomputed on load (not only on change).
    const saved = {
      name: 'Test', background: 'Acolyte', playerName: '', race: null, subrace: null,
      alignment: '', xp: '', level: 1, asi: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      asiChoices: {}, asiCount: 0, feats: [], featModalOpen: false, speed: 30, size: '',
      darkvision: 0, languages: [], traits: [], raceProfs: { skills: [], tools: [], weapons: [], armor: [] },
      bgSkillProfs: [], bgToolProfs: [], bgLanguages: [], bgFeature: { name: '', text: '' },
      bgEquipment: '', personalityTraits: '', ideals: '', bonds: '', flaws: '',
      abilities: { str: { base: 10 }, dex: { base: 10 }, con: { base: 10 }, int: { base: 10 }, wis: { base: 10 }, cha: { base: 10 } },
      skillProfs: {}, hpMax: null, hpCurrent: null, armorClass: null, age: '', height: '',
      weight: '', eyes: '', skin: '', hair: '', symbol: '', appearance: '', allies: '',
      additionalTraits: '', backstory: '', treasure: '',
    };
    await page.context().addCookies([]);
    await page.addInitScript((s) => {
      localStorage.setItem('characterJson', JSON.stringify(s));
    }, saved);
    await page.goto('/main.html');
    await expect(page.getByText('Feature: Shelter of the Faithful', { exact: true })).toBeVisible();
    await expect(page.getByText('As an acolyte, you command the respect of those who share your faith.', { exact: true })).toBeVisible();
  });
});

test.describe('ability score budget: pure logic', () => {
  test.use({ storageState: storageStateFor() });

  test('proficiencyBonus follows the PHB progression', async ({ page }) => {
    await page.goto('/main.html');
    const levels = [1, 4, 5, 8, 9, 12, 13, 16, 17, 20];
    const expected = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
    for (let i = 0; i < levels.length; i++) {
      const bonus = await page.evaluate((lvl) => {
        const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
        d.character.level = lvl;
        return d.proficiencyBonus();
      }, levels[i]);
      expect(bonus).toBe(expected[i]);
    }
  });

  test('pointCost maps the full PHB cost table', async ({ page }) => {
    await page.goto('/main.html');
    const table = { 7: 0, 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 9, 20: 9 };
    for (const [score, cost] of Object.entries(table)) {
      const got = await page.evaluate((s) => {
        const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
        return d.pointCost(s);
      }, Number(score));
      expect(got).toBe(cost);
    }
  });

  test('maxAffordableBase clamps an overspent score downward', async ({ page }) => {
    await page.goto('/main.html');
    // str 15 (cost 9) -> budget 8
    await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.abilities.str.base = 15;
    });
    // dex 15 (cost 9-2=7 <= 8) -> budget 1
    await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.abilities.dex.base = 15;
    });
    // con 15 (cost 9-2=7 > 1) -> max affordable is 11 (cost 3-2=1)
    const max = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.abilities.con.base = 15;
      return d.maxAffordableBase('con');
    });
    expect(max).toBe(11);
  });

  test('toggleFeat ignores a duplicate add and refunds on remove', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.asiCount = 2; // 2 ASIs -> 2 feat slots, budget 19
      d.toggleFeat('Actor', true, null);
      const afterAdd = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      d.toggleFeat('Actor', true, null); // duplicate add is a no-op
      const afterDup = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      d.toggleFeat('Actor', false, null); // remove refunds
      const afterRemove = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      return { afterAdd, afterDup, afterRemove };
    });
    expect(result.afterAdd).toEqual({ feats: 1, budget: 17 });
    expect(result.afterDup).toEqual({ feats: 1, budget: 17 });
    expect(result.afterRemove).toEqual({ feats: 0, budget: 19 });
  });

  test('abilityTotal, abilityMod and modLabel combine base and ASI', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.abilities.str.base = 15;
      d.character.asi.str = 2;
      const high = {
        total: d.abilityTotal('str'),
        mod: d.abilityMod('str'),
        label: d.modLabel('str'),
      };
      d.character.abilities.str.base = 8;
      d.character.asi.str = 0;
      const low = {
        total: d.abilityTotal('str'),
        mod: d.abilityMod('str'),
        label: d.modLabel('str'),
      };
      return { high, low };
    });
    expect(result.high).toEqual({ total: 17, mod: 3, label: '+3' });
    expect(result.low).toEqual({ total: 8, mod: -1, label: '-1' });
  });

  test('skillBonus and skillBonusLabel add proficiency to the ability mod', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.abilities.str.base = 15; // mod +2
      d.character.skillProfs.athletics = true;
      const athletics = d.skillList.find((s) => s.key === 'athletics');
      return {
        bonus: d.skillBonus(athletics),
        label: d.skillBonusLabel(athletics),
      };
    });
    // mod +2 + proficiencyBonus(level 1) +2 = 4
    expect(result.bonus).toBe(4);
    expect(result.label).toBe('+4');
  });

  test('passivePerception is 10 plus the perception skill bonus', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.skillProfs.perception = true; // wis 10 -> mod 0, +2 prof = 2
      return d.passivePerception();
    });
    expect(result).toBe(12);
  });

  test('resolveDarkvision takes the max of race and subrace, honoring an overwrite', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      const race60 = { darkvision: 60 };
      const race0 = { darkvision: 0 };
      const sub0 = { darkvision: 0 };
      const sub30 = { darkvision: 30 };
      const subOverwrite = { darkvision: 120, entries: [{ data: { overwrite: 'Darkvision' } }] };
      return {
        race60Sub0: d.resolveDarkvision(sub0, race60),
        race0Sub30: d.resolveDarkvision(sub30, race0),
        race60Sub30: d.resolveDarkvision(sub30, race60),
        overwrite: d.resolveDarkvision(subOverwrite, race60),
      };
    });
    expect(result.race60Sub0).toBe(60);
    expect(result.race0Sub30).toBe(30);
    expect(result.race60Sub30).toBe(60);
    expect(result.overwrite).toBe(120);
  });

  test('featLimit is one per ASI, plus one for Variant Human', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      const noAsi = d.featLimit(); // level 1, no class, no subrace
      d.character.asiCount = 2;
      const twoAsi = d.featLimit();
      d.character.race = 'Human';
      d.character.subrace = 'Variant';
      const variantHuman = d.featLimit(); // 2 ASIs + 1
      return { noAsi, twoAsi, variantHuman };
    });
    expect(result.noAsi).toBe(0);
    expect(result.twoAsi).toBe(2);
    expect(result.variantHuman).toBe(3);
  });

  test('toggleFeat blocks an add past the feat limit', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.asiCount = 1; // 1 feat slot, budget 17
      d.toggleFeat('Actor', true, null);
      const first = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      d.toggleFeat('Alert', true, null); // limit reached -> blocked
      const blocked = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      return { first, blocked };
    });
    expect(result.first).toEqual({ feats: 1, budget: 15 });
    expect(result.blocked).toEqual({ feats: 1, budget: 15 });
  });

  test('Variant Human grants a feat slot at level 1', async ({ page }) => {
    await page.goto('/main.html');
    const result = await page.evaluate(() => {
      const d = Alpine.$data(document.querySelector('[x-data="characterState"]'));
      d.character.race = 'Human';
      d.character.subrace = 'Variant';
      const limit = d.featLimit(); // 0 ASIs + 1
      d.toggleFeat('Actor', true, null);
      const added = { feats: d.character.feats.length, budget: d.abilityBudgetRemaining() };
      return { limit, added };
    });
    expect(result.limit).toBe(1);
    expect(result.added).toEqual({ feats: 1, budget: 13 });
  });
});

test.describe('ability score budget: HTML constraints', () => {
  test.use({ storageState: storageStateFor() });

  test('level input is clamped to 1-20', async ({ page }) => {
    await page.goto('/main.html');
    await expect(page.getByLabel('Level', { exact: true })).toHaveAttribute('min', '1');
    await expect(page.getByLabel('Level', { exact: true })).toHaveAttribute('max', '20');
  });

  test('ability base inputs are clamped to 1-30', async ({ page }) => {
    await page.goto('/main.html');
    for (const label of ['Strength base', 'Dexterity base', 'Constitution base', 'Intelligence base', 'Wisdom base', 'Charisma base']) {
      await expect(page.getByLabel(label)).toHaveAttribute('min', '1');
      await expect(page.getByLabel(label)).toHaveAttribute('max', '30');
    }
  });
});
