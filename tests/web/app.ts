import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The demo dataset is built relative to today, so the clock is fixed: every run
 * sees the same dates, the same "thru 11" round and the same season ledger.
 */
export const FROZEN_NOW = new Date('2026-09-26T16:00:00Z');

/** Opens the app on the demo group's home screen, fonts loaded. */
export async function openApp(page: Page): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.goto('/');
  await expect(page.getByText('Saturday Dogs').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export async function openTab(page: Page, name: 'Home' | 'Format' | 'Score' | 'Settle'): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();
}

/**
 * Fails on any WCAG 2.1 A or AA violation axe can see: missing names, wrong or
 * incomplete roles, colour contrast. The message lists each rule and where.
 */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = violations.map((v) => {
    const nodes = v.nodes.map((n) => {
      const why = (n.failureSummary ?? '').split('\n').slice(1).join(' ').trim();
      return `${n.html.slice(0, 160)}\n      ${why}`;
    });
    return `${v.id} (${v.impact}): ${v.help}\n    ${nodes.join('\n    ')}`;
  });
  expect(summary, 'axe violations').toEqual([]);
}

/**
 * What the screen looks like, and what a screen reader is told about it.
 *
 * The aria snapshot is the accessibility tree as text: every role, name and
 * state. axe only checks that a control has a name; this catches a name that
 * changed or turned into a glyph ("⚙" instead of "Settings").
 */
export async function expectScreen(page: Page, name: string): Promise<void> {
  // Let fonts, layout and JS-driven animation settle.
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot(`${name}.png`);
  await expect(page.locator('body')).toMatchAriaSnapshot({ name: `${name}.aria.yml` });
}
