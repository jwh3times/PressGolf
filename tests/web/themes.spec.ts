import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectScreen, openApp, openTab } from './app';

/**
 * The themes other than the default. Each is opened from a saved choice, so
 * this also covers reading one back, and axe checks its contrast on the
 * screens that carry the most colour.
 */

async function openInTheme(page: Page, base: string, accent: string): Promise<void> {
  await page.addInitScript(
    (choice) => window.localStorage.setItem('press:theme', choice),
    JSON.stringify({ base, accent }),
  );
  await openApp(page);
}

const THEMES = [
  { base: 'darkContrast', accent: 'green' },
  { base: 'light', accent: 'green' },
  { base: 'lightContrast', accent: 'green' },
  { base: 'light', accent: 'violet' },
];

for (const { base, accent } of THEMES) {
  test.describe(`${base}, ${accent}`, () => {
    test.beforeEach(async ({ page }) => {
      await openInTheme(page, base, accent);
    });

    test('home', async ({ page }) => {
      await expectScreen(page, `theme-${base}-${accent}-home`);
      await expectAccessible(page);
    });

    test('score, hole by hole', async ({ page }) => {
      await openTab(page, 'Score');
      await expect(page.getByRole('button', { name: 'Increase score for Marcus' })).toBeVisible();
      await expectScreen(page, `theme-${base}-${accent}-score-hole`);
      await expectAccessible(page);
    });

    test('settle', async ({ page }) => {
      await openTab(page, 'Settle');
      await expect(page.getByRole('button', { name: 'Post to the season ledger' })).toBeVisible();
      await expectScreen(page, `theme-${base}-${accent}-settle`);
      await expectAccessible(page);
    });
  });
}

test('a theme chosen in Settings is used at once and kept', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light theme' }).click();
  await page.getByRole('radio', { name: 'Blue accent' }).click();
  await expect(page.getByRole('radio', { name: 'Light theme' })).toBeChecked();
  await expectScreen(page, 'theme-settings');
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByText('Saturday Dogs').first()).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('press:theme'))).toBe(
    JSON.stringify({ base: 'light', accent: 'blue' }),
  );
});
