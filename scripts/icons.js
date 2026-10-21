#!/usr/bin/env node
// Erzeugt die PNG-Icons (iOS-Home-Bildschirm, Android/Chrome) aus web/icons/icon.svg.
// Nach jeder Änderung am SVG neu ausführen: node scripts/icons.js  (braucht Playwright mit Chromium)

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const dir = new URL('../web/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', dir), 'utf8');
const bg = JSON.parse(await readFile(new URL('../web/manifest.webmanifest', import.meta.url), 'utf8')).background_color;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

// [Datei, Kantenlänge, Innenabstand in %]: iOS rundet selbst ab, „maskable“ braucht 10 % Schutzzone je Seite.
const SIZES = [['apple-touch-icon.png', 180, 0], ['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 10]];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:${bg}}div{box-sizing:border-box;width:${size}px;height:${size}px;padding:${pad}%}svg{display:block;width:100%;height:100%}</style><div>${svg}</div>`);
  await page.screenshot({ path: new URL(name, dir).pathname, omitBackground: false });
  console.log(name, `${size}×${size}`);
}
await browser.close();
