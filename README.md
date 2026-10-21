# DU-Rohr-Lader

YouTube-Downloader · aktuelle Version: siehe [CHANGELOG.md](CHANGELOG.md)

Lokales Werkzeug zum Herunterladen **eigener, CC-lizenzierter oder gemeinfreier** Videos.
Keine Downloads von DRM- oder Bezahlinhalten, keine Captcha-Löser, keine Umgehung von Sperren.
Für die Rechte an den Inhalten ist der Nutzer selbst verantwortlich.

Plan und Schichten: [docs/PLAN.md](docs/PLAN.md) · Rust-Portierung: [docs/RUST.md](docs/RUST.md)

## Voraussetzungen (macOS)

```
brew install node yt-dlp ffmpeg
```

- Node.js 20 oder neuer, keine npm-Pakete nötig.
- yt-dlp (getestet mit 2026.08.19) und ffmpeg/ffprobe.
- Optional für Strategie D (Aufnahme im Browser): `npm install playwright && npx playwright install chromium`.
  Mit `CAPTURE_CHANNEL=chrome` wird stattdessen dein installiertes Chrome verwendet.
- Optional für Strategie C: ein API-Schlüssel der YouTube Data API v3 (in der App unter Einstellungen oder als `YOUTUBE_API_KEY`).

## Starten

```
npm start
```

Dann http://127.0.0.1:8787 öffnen (lässt sich als App installieren). Der Server nimmt nur Anfragen von
127.0.0.1/localhost an. Einstellungen und Verlauf liegen in `~/Library/Application Support/YouTube-Downloader/`,
Downloads standardmäßig in `~/Downloads/YouTube-Downloader/`.

Umgebungsvariablen: `PORT`, `YTD_LAN`, `YTD_PAIR_RESET`, `YTD_DATA_DIR`, `YTDLP_BIN`, `FFMPEG_BIN`, `YOUTUBE_API_KEY`, `PLAYWRIGHT_MODULE`, `CAPTURE_CHANNEL`.

## Desktop und iPhone/iPad

- **Desktop:** Ab 1100 px Breite zweispaltig: links Laden, Verlauf, Einstellungen, rechts die Aufträge (bleiben beim Scrollen
  sichtbar). URL irgendwo auf der Seite mit ⌘V einfügen oder in das Fenster ziehen, dann wird sie sofort geprüft; `/` springt ins URL-Feld.
- **iPhone/iPad als Fernbedienung:** Der Mac lädt, das iPhone steuert. Server mit `YTD_LAN=1 npm start` starten (Mac und iPhone im
  selben WLAN), in der App unter Einstellungen → iPhone und iPad den QR-Code mit der iPhone-Kamera scannen, in Safari Teilen →
  „Zum Home-Bildschirm“. Fertige Dateien holt „Auf dieses Gerät laden“ in die App „Dateien“.
  Ohne `YTD_LAN=1` bleibt alles wie bisher nur auf 127.0.0.1. Ungekoppelte Geräte sehen nur die Programmdateien, keine Daten.
  Der Schlüssel liegt in `pairing.json` im Datenordner; neuer Schlüssel (alle Geräte neu koppeln): `YTD_PAIR_RESET=1`.
  Hinweis: Im Heimnetz läuft die Verbindung über HTTP ohne Verschlüsselung; nur in vertrauenswürdigen Netzen einschalten.
- Icons nach Änderungen an `web/icons/icon.svg` neu erzeugen: `node scripts/icons.js`.

## Funktionen

- URL prüfen → Metadaten (Titel, Kanal, Dauer, Lizenz, Live-/Altersstatus, Playlist-Einträge) → Format wählen → laden.
- Video: Höchstauflösung, Container (MP4/WebM/MKV). Nur Audio: Original (m4a/opus) oder MP3/M4A/FLAC/Opus, Bitrate, Titel und Cover als Tags.
- Playlists, Fortschritt (SSE), Abbrechen, Wiederholen, Verlauf mit Export/Import (JSON), yt-dlp-Update-Check.
- Klare Fehlermeldungen mit Anleitung: privat, gelöscht, Altersfreigabe, Region, Rate-Limit, Bot-Check, Mitglieder, DRM, Livestream läuft noch.
- Strategien als austauschbare Engines mit automatischer Fallback-Kette (vorläufig A → B → D → C):
  - **A** yt-dlp ohne Login · **B** yt-dlp mit Cookies aus deinem angemeldeten Browser (nur wenn gewählt und nur nach passenden Fehlern)
  - **C** YouTube Data API nur für Metadaten, Download-Hinweis auf YouTube Studio / Google Takeout
  - **D** sichtbarer Browser, du startest das Video, die App nimmt auf (nur ohne DRM, nur wenn erlaubt, mit Qualitätsverlust)

## Tests

```
npm test
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright/index.mjs npm test   # inkl. Strategie D
```

Kern-Tests nutzen JSON-Fixtures aus `tests/fixtures/` (für Rust wiederverwendbar). Integrationstests laufen mit echtem
yt-dlp, ffmpeg und Headless-Chromium gegen einen lokalen Testserver; `tests/architecture.test.js` prüft die Schichtentrennung.

## Testmatrix (echte YouTube-URLs)

1. In `scripts/testmatrix.urls.json` fünf eigene oder frei lizenzierte URLs eintragen (kurz, lang, Playlist, Altersfreigabe, Livestream-Aufzeichnung).
2. `node scripts/testmatrix.js --cookies firefox` (ohne `--cookies` nur Strategie A).
3. Ergebnis: Tabelle auf der Konsole und `docs/testmatrix-results.json`.
