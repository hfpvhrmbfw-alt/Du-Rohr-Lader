import { readFileSync } from 'node:fs';

/** @param {string} name */
export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** Nur die Felder aus `expected` vergleichen. */
export function subset(actual, expected) {
  const out = {};
  for (const key of Object.keys(expected)) out[key] = actual[key];
  return out;
}
