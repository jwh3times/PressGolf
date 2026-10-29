#!/usr/bin/env node
// Renders the Play store listing graphics from the web export's demo data:
// the 512 px icon, the 1024×500 feature graphic, and six captioned 1080×1920
// phone screenshots (#171, #162).
//
// The screens are driven the way tests/web drives them: the demo group, a
// frozen clock, and Torrey Pines South mocked in for the hole map. Each is
// captured at phone width and set under a headline on a canvas in the theme's
// colours, which are read out of src/theme/themes.ts rather than copied here.
//
// Run by hand from the repository root; it is not part of the build or CI:
//
//   npx expo export --platform web
//   node scripts/store-listing.mjs [out dir, default dist/store-listing]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = path.resolve(process.argv[2] ?? 'dist/store-listing');
const RAW = path.join(OUT, 'raw');
const PORT = 8098;
const BASE = `http://localhost:${PORT}`;
const FROZEN_NOW = new Date('2026-09-26T16:00:00Z');
const VIEWPORT = { width: 390, height: 650 };

const SHOTS = [
  { id: '1-settle', head: 'Who owes whom', sub: 'The fewest payments to square everyone up.' },
  { id: '2-score', head: 'One card, every game', sub: 'Enter each score once. Every game keeps up.' },
  { id: '3-format', head: 'Stack the games', sub: 'Nassau and presses, skins, junk and more.' },
  { id: '4-hole-map', head: 'Yards to the green', sub: 'A drawn map of every hole, with the numbers.' },
  { id: '5-outing', head: 'Bring the whole field', sub: 'Split into groups. Settle field-wide skins.' },
  { id: '6-home', head: 'The round at a glance', sub: 'Live round, season ledger and history.' },
];

function themeColors() {
  const source = readFileSync('src/theme/themes.ts', 'utf8');
  const pick = (name) => {
    const match = source.match(new RegExp(`\\b${name}: '(#[0-9A-Fa-f]{6})'`));
    if (!match) throw new Error(`src/theme/themes.ts has no ${name} colour`);
    return match[1];
  };
  return { base: pick('base'), cardActive: pick('cardActive'), accent: pick('accent'), ink: pick('ink') };
}

function alpha(hex, a) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

async function openApp(page) {
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.goto(BASE + '/');
  await page.getByText('Saturday Dogs').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function openTab(page, name) {
  await page.getByRole('tab', { name }).click();
  await page.getByRole('tab', { name, selected: true }).waitFor();
}

/** Imports Torrey Pines South over the demo course, as tests/web/course-map.spec.ts does. */
async function openMappedHole(page) {
  const torrey = JSON.parse(readFileSync('src/osm/__tests__/torrey-south.json', 'utf8'));
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
  await page.getByRole('button', { name: 'Course guide' }).waitFor();
  // Back out of the course editor, the course list and Settings to the round.
  await page.getByRole('button', { name: 'Back' }).last().click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await openTab(page, 'Score');
  await page.getByRole('button', { name: 'Go to hole 3' }).click();
  await page.getByRole('button', { name: 'Map of hole 3, distances' }).locator('svg').waitFor();
}

const STEPS = {
  '1-settle': async (page) => {
    await openTab(page, 'Settle');
    await page.getByRole('button', { name: 'Post to the season ledger' }).waitFor();
  },
  // Hole 11 is the last one the demo round has scored.
  '2-score': async (page) => {
    await openTab(page, 'Score');
    await page.getByRole('button', { name: 'Go to hole 11' }).click();
    await page.getByText('Hole 11', { exact: true }).waitFor();
  },
  '3-format': (page) => openTab(page, 'Format'),
  '4-hole-map': openMappedHole,
  '5-outing': async (page) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /Pine Hollow Society/ }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: /Society Saturday/ }).click();
    await page.getByText('Where everybody stands').waitFor();
  },
  '6-home': async () => {},
};

function fontFaces(c) {
  const font = (pkg, weight, file) =>
    pathToFileURL(path.resolve('node_modules/@expo-google-fonts', pkg, weight, file)).href;
  // Not "Serif": CSS reads that as the generic family and falls back.
  return `
    @font-face { font-family: PressSerif; src: url(${font('instrument-serif', '400Regular', 'InstrumentSerif_400Regular.ttf')}); }
    @font-face { font-family: PressSans; src: url(${font('instrument-sans', '400Regular', 'InstrumentSans_400Regular.ttf')}); }
    @font-face { font-family: PressMono; font-weight: 500; src: url(${font('jetbrains-mono', '500Medium', 'JetBrainsMono_500Medium.ttf')}); }
    * { margin: 0; box-sizing: border-box; }
    body { background: ${c.base}; color: ${c.ink}; }
  `;
}

function screenHtml(c, shot) {
  const frameHeight = Math.round((820 * VIEWPORT.height) / VIEWPORT.width);
  return `<!doctype html><meta charset="utf-8"><style>${fontFaces(c)}
    body { width: 1080px; height: 1920px; overflow: hidden;
      background: radial-gradient(120% 70% at 50% 0%, ${c.cardActive} 0%, ${c.base} 70%); }
    .cap { padding: 130px 80px 0; text-align: center; }
    h1 { font: 400 112px/1.02 PressSerif; letter-spacing: -1px; }
    p { margin-top: 26px; font: 400 40px/1.3 PressSans; color: ${alpha(c.ink, 0.72)}; }
    .frame { position: absolute; left: 130px; top: 470px; width: 820px; height: ${frameHeight}px;
      border-radius: 44px; overflow: hidden; border: 3px solid ${alpha(c.accent, 0.28)};
      box-shadow: 0 40px 120px rgba(0,0,0,.6); }
    .frame img { width: 100%; height: 100%; display: block; }
  </style>
  <div class="cap"><h1>${shot.head}</h1><p>${shot.sub}</p></div>
  <div class="frame"><img src="raw/${shot.id}.png"></div>`;
}

function featureHtml(c) {
  return `<!doctype html><meta charset="utf-8"><style>${fontFaces(c)}
    body { width: 1024px; height: 500px; overflow: hidden; display: flex; align-items: center; gap: 56px; padding: 0 72px;
      background: radial-gradient(90% 120% at 20% 50%, ${c.cardActive} 0%, ${c.base} 75%); }
    img { width: 300px; height: 300px; border-radius: 66px; border: 2px solid ${alpha(c.accent, 0.25)}; flex: none; }
    h1 { font: 400 104px/1 PressSerif; letter-spacing: -1px; }
    p { margin-top: 18px; font: 400 34px/1.25 PressSans; white-space: nowrap; color: ${alpha(c.ink, 0.8)}; }
    .games { margin-top: 34px; font: 500 17px/1.6 PressMono; letter-spacing: 3px; color: ${c.accent}; }
  </style>
  <img src="icon-512.png">
  <div><h1>Press Golf</h1><p>One scorecard. Everyone settled.</p>
  <div class="games">NASSAU · SKINS · JUNK · STABLEFORD<br>WOLF · VEGAS · MATCH PLAY</div></div>`;
}

/** Writes html beside the images it references, screenshots it, and removes it. */
async function render(browser, viewport, html, file, options = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const source = path.join(OUT, '.render.html');
  writeFileSync(source, html);
  await page.goto(pathToFileURL(source).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, file), ...options });
  await page.close();
  rmSync(source);
}

async function main() {
  if (!existsSync('dist/index.html')) {
    throw new Error('dist/index.html is missing. Run `npx expo export --platform web` first.');
  }
  mkdirSync(RAW, { recursive: true });
  const colors = themeColors();
  const server = spawn('node', ['tests/web/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(BASE);
        break;
      } catch (error) {
        if (i === 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // A fresh context per screen, as each Playwright test gets: the app saves its
    // state to localStorage, so a group switched for one screen would carry into the next.
    for (const shot of SHOTS) {
      const app = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 3,
        colorScheme: 'dark',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        reducedMotion: 'reduce',
      });
      const page = await app.newPage();
      page.setDefaultTimeout(20_000);
      await openApp(page);
      await STEPS[shot.id](page);
      // Let fonts, layout and JS-driven animation settle.
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(RAW, `${shot.id}.png`), animations: 'disabled', caret: 'hide' });
      await app.close();
    }

    // Play wants a 32-bit icon, and Chromium drops the alpha channel of a fully
    // opaque PNG: a 1 px corner radius keeps a few transparent pixels, well inside
    // the rounded mask Play applies to the icon anyway.
    const icon = pathToFileURL(path.resolve('assets/icon.png')).href;
    await render(
      browser,
      { width: 512, height: 512 },
      `<!doctype html><style>* { margin: 0 } img { display: block; width: 512px; height: 512px; border-radius: 1px }</style><img src="${icon}">`,
      'icon-512.png',
      { omitBackground: true },
    );
    await render(browser, { width: 1024, height: 500 }, featureHtml(colors), 'feature-graphic-1024x500.png');
    for (const shot of SHOTS) {
      await render(browser, { width: 1080, height: 1920 }, screenHtml(colors, shot), `screenshot-${shot.id}.png`);
    }
    console.log(`Wrote the icon, feature graphic and ${SHOTS.length} screenshots to ${OUT}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
