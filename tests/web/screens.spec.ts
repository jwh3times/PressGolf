import { expect, test } from '@playwright/test';
import { expectAccessible, expectScreen, openApp, openTab } from './app';

/**
 * Each main screen, from demo data: what it looks like, and whether axe finds
 * anything wrong with it. A changed screenshot is either a regression or a
 * deliberate change whose baseline needs updating (`npm run test:web:update`).
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('home', async ({ page }) => {
  await expectScreen(page, 'home');
  await expectAccessible(page);
});

test('format', async ({ page }) => {
  await openTab(page, 'Format');
  await expectScreen(page, 'format');
  await expectAccessible(page);
});

test('score, hole by hole', async ({ page }) => {
  await openTab(page, 'Score');
  await expect(page.getByRole('button', { name: 'Increase score for Marcus' })).toBeVisible();
  await expectScreen(page, 'score-hole');
  await expectAccessible(page);
});

test('score, whole card', async ({ page }) => {
  await openTab(page, 'Score');
  await page.getByRole('button', { name: 'Whole card' }).click();
  await expect(page.getByRole('button', { name: /^Hole 1, Marcus,/ })).toBeVisible();
  await expectScreen(page, 'score-card');
  await expectAccessible(page);
});

test('settle', async ({ page }) => {
  await openTab(page, 'Settle');
  await expect(page.getByRole('button', { name: 'Post to the season ledger' })).toBeVisible();
  await expectScreen(page, 'settle');
  await expectAccessible(page);
});

test('roster', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Roster and group/ }).click();
  // Earlier screens stay mounted underneath, so wait on something only the roster has.
  await expect(page.getByLabel('Add a player')).toBeVisible();
  await expectScreen(page, 'roster');
  await expectAccessible(page);
});

test('history', async ({ page }) => {
  await page.getByRole('button', { name: /18 rounds/ }).click();
  await expect(page.getByRole('button', { name: /Pine Hollow LIVE/ })).toBeVisible();
  await expectScreen(page, 'history');
  await expectAccessible(page);
});

test('outing', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Pine Hollow Society/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Society Saturday/ }).click();
  await expect(page.getByText('Where everybody stands')).toBeVisible();
  await expectScreen(page, 'outing');
  await expectAccessible(page);
});
