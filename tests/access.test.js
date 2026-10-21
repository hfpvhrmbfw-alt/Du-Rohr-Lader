import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccessPolicy, parseCookies, sameSecret } from '../server/access.js';

const TOKEN = 'k3Y-abcdefghijklmnopqrstuv';
const req = (over) => ({ method: 'GET', path: '/', host: '127.0.0.1:8787', remote: '127.0.0.1', ...over });

test('Ohne Heimnetz: nur dieser Rechner, wie bisher', () => {
  const p = createAccessPolicy({ port: 8787, lan: false, lanHosts: ['192.168.1.5'], token: TOKEN });
  assert.deepEqual(p.check(req()), { ok: true, local: true, paired: false });
  assert.equal(p.check(req({ host: 'localhost:8787' })).ok, true);
  assert.equal(p.check(req({ host: 'evil.example:8787' })).error, 'forbidden_host');
  assert.equal(p.check(req({ host: '192.168.1.5:8787', remote: '192.168.1.20' })).error, 'forbidden_host');
  assert.equal(p.check(req({ remote: '192.168.1.20' })).error, 'forbidden_remote');
  assert.equal(p.check(req({ method: 'POST', origin: 'http://evil.example' })).error, 'forbidden_origin');
  assert.deepEqual(p.pairUrls(), []);
});

test('Heimnetz: ungekoppeltes Gerät bekommt nur Programmdateien, keine Daten', () => {
  const p = createAccessPolicy({ port: 8787, lan: true, lanHosts: ['192.168.1.5', 'mac.local'], token: TOKEN });
  const phone = (over) => req({ host: '192.168.1.5:8787', remote: '::ffff:192.168.1.20', ...over });
  assert.equal(p.check(phone()).error, 'not_paired');
  assert.equal(p.check(phone({ path: '/api/status' })).status, 401);
  assert.equal(p.check(phone({ path: '/api/history' })).error, 'not_paired');
  assert.equal(p.check(phone({ path: '/styles.css' })).ok, true);
  assert.equal(p.check(phone({ path: '/icons/apple-touch-icon.png' })).ok, true);
  assert.equal(p.check(phone({ path: '/core/logic.js' })).ok, true);
  assert.equal(p.check(phone({ path: '/src/../../etc/passwd' })).ok, false);
  assert.equal(p.check(phone({ pair: 'falsch' })).error, 'not_paired');
  assert.equal(p.check(phone({ cookie: 'ytd_pair=falsch' })).error, 'not_paired');
});

test('Heimnetz: Kopplung per Link setzt Cookie, danach reicht das Cookie', () => {
  const p = createAccessPolicy({ port: 8787, lan: true, lanHosts: ['192.168.1.5', 'mac.local'], token: TOKEN });
  const phone = (over) => req({ host: 'mac.local:8787', remote: '192.168.1.20', ...over });
  const first = p.check(phone({ pair: TOKEN }));
  assert.equal(first.ok, true);
  assert.equal(first.paired, true);
  assert.match(first.setCookie, /^ytd_pair=k3Y-abcdefghijklmnopqrstuv; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
  assert.deepEqual(p.check(phone({ path: '/api/jobs', method: 'POST', origin: 'http://mac.local:8787', cookie: `a=1; ytd_pair=${TOKEN}` })), { ok: true, local: false, paired: true });
  assert.equal(p.check(phone({ method: 'POST', pair: TOKEN })).ok, false, 'Kopplung nur per GET');
  assert.equal(p.check(phone({ method: 'POST', origin: 'http://evil.example', cookie: `ytd_pair=${TOKEN}` })).error, 'forbidden_origin');
  assert.deepEqual(p.pairUrls(), [`http://192.168.1.5:8787/?pair=${TOKEN}`, `http://mac.local:8787/?pair=${TOKEN}`]);
});

test('Heimnetz ohne Schlüssel lässt niemanden von außen herein', () => {
  const p = createAccessPolicy({ port: 8787, lan: true, lanHosts: ['192.168.1.5'], token: null });
  assert.equal(p.check(req({ host: '192.168.1.5:8787', remote: '192.168.1.20', path: '/styles.css' })).error, 'forbidden_remote');
});

test('Cookies und Schlüsselvergleich', () => {
  assert.deepEqual(parseCookies('a=1; b = x%20y;kaputt; c=%E0%A4%A'), { a: '1', b: 'x y' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abcd'), false);
  assert.equal(sameSecret('', ''), false);
  assert.equal(sameSecret(undefined, 'abc'), false);
});
