import { expect, test } from '@playwright/test';
import { FROZEN_NOW, expectAccessible, expectScreen } from './app';

/**
 * A phone with no account (#275): it opens on the sign-in screen, and Try the
 * demo lets it in to the demo data with nobody signed in. Unlike the other
 * specs, nothing is remembered, so the sign-in screen is what opens.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test('sign in', async ({ page }) => {
  await expectScreen(page, 'sign-in');
  await expectAccessible(page);
});

test('trying the demo, with Sign in in Settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Saturday Dogs').first()).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Trying the demo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).scrollIntoViewIfNeeded();
  await expectScreen(page, 'settings-demo');
  await expectAccessible(page);

  // It reopens on the demo, here on Settings, since the web build keeps the address.
  await page.reload();
  await expect(page.getByText('Trying the demo')).toBeVisible();

  // Sign in goes back to the sign-in screen, where Try the demo returns.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible();
});
