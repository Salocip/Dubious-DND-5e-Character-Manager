import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4173';

// Minimal 5etools-shaped fixtures with deliberate non-PHB entries and cruft.
const racesFixture = {
  race: [
    { name: 'Dwarf', source: 'PHB', page: 18, size: ['M'], speed: 25, ability: [{ con: 2 }], darkvision: 60, languageProficiencies: [{ common: true, dwarvish: true }], entries: [{ type: 'entries', name: 'Darkvision', entries: ['Darkvision text'] }], soundClip: { type: 'internal', path: 'races/dwarf.opus' }, hasFluff: true, _versions: [{ name: 'legacy' }] },
    { name: 'Aarakocra', source: 'DMG', page: 282, size: ['M'], speed: { walk: 20, fly: 50 }, ability: [{ dex: 2, wis: 2 }], entries: [] },
    { name: 'Human', source: 'PHB', page: 29, size: ['M'], speed: 30, ability: [{ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }], languageProficiencies: [{ common: true }], entries: [] },
  ],
  subrace: [
    { name: 'Hill', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB', ability: [{ wis: 1 }], entries: [] },
    { name: 'Mountain', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB', ability: [{ str: 2 }], entries: [] },
    { name: '', source: 'PHB', raceName: 'Dragonborn', raceSource: 'PHB', ability: [{ str: 2 }], entries: [] },
    { name: 'Variant', source: 'PHB', raceName: 'Human', raceSource: 'PHB', ability: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], count: 2 }, amount: 1 }], entries: [] },
  ],
};

const backgroundsFixture = {
  background: [
    { name: 'Acolyte', source: 'PHB', skillProficiencies: [{ insight: true, religion: true }], languageProficiencies: [{ any: 2 }], entries: [{ type: 'entries', name: 'Feature: Shelter of the Faithful', entries: ['...'] }] },
    { name: 'City Watch', source: 'SCAG', skillProficiencies: [], entries: [] },
  ],
};

function mockDataRoute(page) {
  return page.route('**/raw.githubusercontent.com/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('data/races.json')) return route.fulfill({ json: racesFixture });
    if (url.endsWith('data/backgrounds.json')) return route.fulfill({ json: backgroundsFixture });
    if (url.endsWith('data/items.json')) return route.fulfill({ json: { _meta: { internalCopies: ['item'] }, item: [] } });
    return route.fulfill({ json: {} });
  });
}

test.describe('stage 1: races + backgrounds data layer', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('fetches and normalizes to PHB-only, dropping cruft', async ({ page }) => {
    await mockDataRoute(page);
    await page.goto('/main.html');
    await page.waitForFunction(() => localStorage.getItem('racesJson') && localStorage.getItem('backgroundsJson'));

    const races = await page.evaluate(() => JSON.parse(localStorage.getItem('racesJson')));
    const backgrounds = await page.evaluate(() => JSON.parse(localStorage.getItem('backgroundsJson')));

    expect(races._v).toBe(1);
    expect(backgrounds._v).toBe(1);

    expect(races.race.map((r) => r.name)).toEqual(['Dwarf', 'Human']);
    expect(races.race.every((r) => r.source === 'PHB')).toBe(true);

    expect(races.subrace.map((s) => s.name)).toEqual(['Hill', 'Mountain', 'Variant']);

    expect(backgrounds.background.map((b) => b.name)).toEqual(['Acolyte']);

    const dwarf = races.race.find((r) => r.name === 'Dwarf');
    expect(dwarf.soundClip).toBeUndefined();
    expect(dwarf.hasFluff).toBeUndefined();
    expect(dwarf._versions).toBeUndefined();
    expect(dwarf.ability).toEqual([{ con: 2 }]);
    expect(dwarf.speed).toBe(25);
    expect(dwarf.languageProficiencies).toEqual([{ common: true, dwarvish: true }]);
    expect(dwarf.entries[0].name).toBe('Darkvision');
  });

  test('reuses a valid cache without refetching', async ({ page }) => {
    let racesFetches = 0;
    await page.route('**/raw.githubusercontent.com/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('data/races.json')) { racesFetches += 1; return route.fulfill({ json: racesFixture }); }
      if (url.endsWith('data/backgrounds.json')) return route.fulfill({ json: backgroundsFixture });
      if (url.endsWith('data/items.json')) return route.fulfill({ json: { _meta: { internalCopies: ['item'] }, item: [] } });
      return route.fulfill({ json: {} });
    });

    await page.goto('/main.html');
    await page.waitForFunction(() => localStorage.getItem('racesJson'));
    expect(racesFetches).toBe(1);

    await page.reload();
    await page.waitForFunction(() => localStorage.getItem('racesJson'));
    expect(racesFetches).toBe(1);
  });

  test('does not cache a malformed races.json response', async ({ page }) => {
    await page.route('**/raw.githubusercontent.com/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('data/races.json')) return route.fulfill({ json: {} });
      if (url.endsWith('data/backgrounds.json')) return route.fulfill({ json: backgroundsFixture });
      if (url.endsWith('data/items.json')) return route.fulfill({ json: { _meta: { internalCopies: ['item'] }, item: [] } });
      return route.fulfill({ json: {} });
    });

    await page.goto('/main.html');
    await page.waitForFunction(() => localStorage.getItem('backgroundsJson'));
    const racesCached = await page.evaluate(() => localStorage.getItem('racesJson'));
    expect(racesCached).toBeNull();
  });
});

test.describe('stage 1: corrupt cache', () => {
  test.use({
    storageState: {
      cookies: [],
      origins: [{ origin: BASE_URL, localStorage: [{ name: 'racesJson', value: 'not-json{{' }] }],
    },
  });

  test('clears corrupt racesJson and refetches', async ({ page }) => {
    await mockDataRoute(page);
    await page.goto('/main.html');
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('racesJson'))._v === 1; } catch { return false; }
    });
    const races = await page.evaluate(() => JSON.parse(localStorage.getItem('racesJson')));
    expect(races.race.map((r) => r.name)).toEqual(['Dwarf', 'Human']);
  });
});
