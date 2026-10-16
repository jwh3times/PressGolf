import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectScreen, openApp, openTab } from './app';

/**
 * How each hole plays (#136), on a course map imported the way a player would:
 * OpenStreetMap's answers come from the recorded Torrey Pines South, where
 * holes 3 and 8 are mapped, laid over the demo course's card.
 */
const torrey = JSON.parse(readFileSync('src/osm/__tests__/torrey-south.json', 'utf8'));

async function importTorrey(page: Page) {
  await page.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({
      json: [
        {
          category: 'leisure',
          type: 'golf_course',
          osm_type: 'way',
          osm_id: 1,
          name: 'Torrey Pines South',
          address: { city: 'San Diego', state: 'California', country: 'United States' },
          lat: '32.8987',
          lon: '-117.2497',
        },
      ],
    }),
  );
  await page.route('**/api/interpreter', (route) => route.fulfill({ json: torrey }));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Courses/ }).click();
  await page.getByRole('button', { name: /Pine Hollow/ }).click();
  await page.getByRole('button', { name: 'Import from OpenStreetMap' }).click();
  await page.getByLabel('Course name on OpenStreetMap').fill('Torrey Pines South');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /^Torrey Pines South/ }).click();
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByRole('button', { name: 'Course guide' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await importTorrey(page);
});

/** Opens hole 3's map through the course guide. */
async function openHoleThree(page: Page) {
  await page.getByRole('button', { name: 'Course guide' }).click();
  await page.getByRole('button', { name: /^Hole 3,/ }).click();
  await page.getByText('How the hole plays').scrollIntoViewIfNeeded();
}

test('course guide', async ({ page }) => {
  await page.getByRole('button', { name: 'Course guide' }).click();
  await expect(page.getByRole('button', { name: /^Hole 3,/ })).toBeVisible();
  await expectScreen(page, 'course-guide');
  await expectAccessible(page);
});

test('how the hole plays', async ({ page }) => {
  await openHoleThree(page);
  await expectScreen(page, 'hole-strategy');
  await expectAccessible(page);
});

test('score, a mapped hole', async ({ page }) => {
  // Back out of the course editor, the course list and Settings to the round.
  await page.getByRole('button', { name: 'Back' }).last().click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await openTab(page, 'Score');
  await page.getByRole('button', { name: 'Go to hole 3' }).click();
  await expect(page.getByText(/^Green: /)).toBeVisible();
  await expectScreen(page, 'score-mapped-hole');
  await expectAccessible(page);
});

// The grades' colours, against every base: axe checks their contrast.
const THEME_NAMES: Record<string, string> = {
  darkContrast: 'Dark, high contrast theme',
  light: 'Light theme',
  lightContrast: 'Light, high contrast theme',
};
for (const [base, name] of Object.entries(THEME_NAMES)) {
  test(`how the hole plays, ${base}`, async ({ page }) => {
    // From the course editor back to Settings, to choose the theme, and in again.
    await page.getByRole('button', { name: 'Back' }).last().click();
    await page.getByRole('button', { name: 'Done' }).last().click();
    await page.getByRole('radio', { name }).click();
    await page.getByRole('button', { name: /^Courses/ }).click();
    await page.getByRole('button', { name: /Pine Hollow/ }).click();
    await openHoleThree(page);
    await expectScreen(page, `theme-${base}-green-hole-strategy`);
    await expectAccessible(page);
  });
}
