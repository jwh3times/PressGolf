import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The demo dataset is built relative to today, so the clock is fixed: every run
 * sees the same dates, the same "thru 11" round and the same season ledger.
 */
export const FROZEN_NOW = new Date('2026-09-26T16:00:00Z');

/**
 * Opens the app on the demo group's home screen, fonts loaded.
 *
 * The export names a server that isn't there (`scripts/test-web.mjs`), so the
 * screens for a build with one, such as Settings' Account section, can be seen.
 * A remembered sign-in lets the phone in with no session, the way one with no
 * signal is let in, and demo data never syncs, so nothing tries to reach it.
 */
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('press:auth:remembered-email', 'golfer@example.com'));
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
 * Makes Chromium draw every `backdrop-filter` (the tab bar's glass) afresh.
 *
 * Since Expo SDK 58, after a tab switch Chromium sometimes keeps the glass's
 * anti-aliased corners as they were drawn over the previous tab: about twenty
 * pixels, a few colour levels off, stable once there. Roughly one run in four
 * ended that way, so a zero-tolerance screenshot failed at random. Dropping the
 * filter for two frames and restoring it gives the same pixels every run.
 */
async function repaintBackdrops(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const glass = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (el) => getComputedStyle(el).backdropFilter !== 'none',
    );
    const filters = glass.map((el) => el.style.backdropFilter);
    for (const el of glass) el.style.backdropFilter = 'none';
    await frame();
    await frame();
    glass.forEach((el, i) => {
      el.style.backdropFilter = filters[i];
    });
    await frame();
    await frame();
  });
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
  await repaintBackdrops(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
  await expectAriaSnapshot(page, name);
}

/**
 * Matches the page's accessibility tree against `<name>.aria.yml`, as a screen
 * reader would read it. Expo Router marks unfocused screens `inert` on web
 * (58.0.31; it used `aria-hidden` before). Browsers leave inert content out of
 * the accessibility tree, but Playwright 1.65's aria snapshot still reads it,
 * and the last text of the screen underneath merges into the focused screen's
 * first text. So inert subtrees are hidden for the snapshot, then restored.
 */
export async function expectAriaSnapshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[inert]:not([aria-hidden])')) {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-snapshot-inert', '');
    }
  });
  try {
    await expect(page.locator('body')).toMatchAriaSnapshot({ name: `${name}.aria.yml` });
  } finally {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-snapshot-inert]')) {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('data-snapshot-inert');
      }
    });
  }
}
