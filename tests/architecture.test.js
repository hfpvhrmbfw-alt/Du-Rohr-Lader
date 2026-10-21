// Prüft die Schichtentrennung automatisch (Skill „app-architektur“).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const p = join(dir, name);
    return statSync(join(root, p)).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
const source = (p) => readFileSync(join(root, p), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const imports = (p) => [...source(p).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

test('Kern (Modell, Logik, Interface, Ablaufsteuerung) greift nicht nach außen', () => {
  const forbidden = /\b(document|window|localStorage|indexedDB|fetch|Date\.now|new Date|process\.|require\(|child_process|node:)/;
  for (const p of files('src/core')) {
    const hit = source(p).match(forbidden);
    assert.equal(hit, null, `${p}: ${hit?.[0]}`);
  }
});

test('Kern importiert nur Kern-Module', () => {
  for (const p of files('src/core')) {
    for (const spec of imports(p)) assert.ok(spec.startsWith('./') && !spec.includes('..'), `${p} importiert ${spec}`);
  }
});

test('Modell importiert gar nichts', () => {
  assert.deepEqual(imports('src/core/model.js'), []);
});

test('Adapter importieren nur Kern oder andere Adapter, nie Server oder Oberfläche', () => {
  for (const p of files('src/adapters')) {
    for (const spec of imports(p)) {
      assert.ok(!/server|web\//.test(spec), `${p} importiert ${spec}`);
    }
  }
});

test('Nur process.js startet Programme', () => {
  for (const p of [...files('src'), ...(safe(() => files('server')) ?? [])]) {
    if (relative('src/adapters', p) === 'process.js') continue;
    assert.ok(!/child_process/.test(source(p)), `${p} nutzt child_process`);
  }
});

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

test('Oberfläche spricht nur Kern (über /core/) und eigene Module an, nie Adapter', () => {
  for (const p of files('web/src')) {
    for (const spec of imports(p)) assert.ok(spec.startsWith('./') || /^\/core\/(model|logic)\.js$/.test(spec), `${p} importiert ${spec}`);
  }
});

test('Oberfläche startet keine Programme und liest keine Dateien', () => {
  for (const p of files('web')) assert.ok(!/child_process|node:/.test(source(p)), p);
});
