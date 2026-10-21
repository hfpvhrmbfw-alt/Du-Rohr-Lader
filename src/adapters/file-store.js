// Adapter: Einstellungen und Verlauf als JSON-Datei im App-Datenordner.
// Format = Export-Format des Modells (app, version, settings, history), also direkt importierbar.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, buildExport, parseImport } from '../core/model.js';

/**
 * @param {string} dir
 * @param {() => string} now  ISO-Zeitstempel
 */
export function createFileStore(dir, now) {
  const dataFile = join(dir, 'data.json');
  const secretsFile = join(dir, 'secrets.json');
  const pairingFile = join(dir, 'pairing.json');
  mkdirSync(dir, { recursive: true });

  const writeAtomic = (file, value) => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };

  return {
    /** @returns {{settings: import('../core/model.js').Settings, history: import('../core/model.js').Job[], warning: string|null}} */
    load() {
      const raw = readJson(dataFile);
      if (raw === null) return { settings: DEFAULT_SETTINGS, history: [], warning: null };
      const r = parseImport(raw);
      if (!r.ok) return { settings: DEFAULT_SETTINGS, history: [], warning: r.error };
      return { settings: r.settings, history: r.history, warning: null };
    },
    /** @param {import('../core/model.js').Settings} settings @param {import('../core/model.js').Job[]} history */
    save(settings, history) {
      writeAtomic(dataFile, buildExport(settings, history, now()));
    },
    /** API-Schlüssel getrennt von den exportierbaren Daten. @returns {{youtubeApiKey: string|null}} */
    loadSecrets() {
      const s = readJson(secretsFile);
      return { youtubeApiKey: typeof s?.youtubeApiKey === 'string' && s.youtubeApiKey !== '' ? s.youtubeApiKey : null };
    },
    /** @param {{youtubeApiKey: string|null}} secrets */
    saveSecrets(secrets) {
      writeAtomic(secretsFile, secrets);
    },
    /** Kopplungsschlüssel für Geräte im Heimnetz; wird beim ersten Mal mit `create` erzeugt. @param {() => string} create */
    pairingToken(create, reset = false) {
      const t = reset ? null : readJson(pairingFile)?.token;
      if (typeof t === 'string' && t.length >= 16) return t;
      const token = create();
      writeAtomic(pairingFile, { token });
      return token;
    },
  };
}
