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

test('bag', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /My bag/ }).click();
  await expect(page.getByLabel('Driver carry, in yards')).toHaveValue('235');
  await expectScreen(page, 'bag');
  await expectAccessible(page);

  // A carry typed in stays when the bag is opened again.
  await page.getByLabel('7 iron carry, in yards').fill('155');
  await page.getByRole('button', { name: 'Done' }).last().click();
  await page.getByRole('button', { name: /My bag/ }).click();
  await expect(page.getByLabel('7 iron carry, in yards')).toHaveValue('155');

  // So does the usual score chosen.
  await page.getByRole('radio', { name: '90s' }).click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await page.getByRole('button', { name: /My bag/ }).click();
  await expect(page.getByRole('radio', { name: '90s' })).toBeChecked();
});

test('settings, signed in', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).scrollIntoViewIfNeeded();
  await expectScreen(page, 'settings-account');
  await expectAccessible(page);
});

test('delete account', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  await expectScreen(page, 'delete-account');
  await expectAccessible(page);

  // Backing out changes nothing: the signed-in row is still there to come back to.
  await page.getByRole('button', { name: 'Keep my account' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();

  // The server named by this build isn't there, which is what no signal looks like.
  await page.getByLabel('Password').fill('hunter2222');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('alert')).toContainText('needs signal');
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
  await expectAccessible(page);
});

test('history', async ({ page }) => {
  await page.getByRole('button', { name: /18 rounds/ }).click();
  await expect(page.getByRole('button', { name: /Pine Hollow LIVE/ })).toBeVisible();
  await expectScreen(page, 'history');
  await expectAccessible(page);
});

test('outing, once its organiser has deleted their account', async ({ page }) => {
  // Demo data never syncs, so nothing would bring a notice: mark what's saved, as applying one does.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('press:demo:data')!);
    saved.outings[0].detached = true;
    saved.activeGroupId = saved.outings[0].groupId;
    localStorage.setItem('press:demo:data', JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('button', { name: /Society Saturday/ }).click();
  await expect(page.getByText('The organiser deleted this outing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share this outing' })).toHaveCount(0);
  await expectScreen(page, 'outing-detached');
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
