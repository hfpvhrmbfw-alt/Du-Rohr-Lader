# YouTube-Downloader – Plan

Zweck: eigene, CC-lizenzierte oder gemeinfreie Videos herunterladen. Ablauf in der App:
URL einfügen → Metadaten → Format wählen (Video oder nur Audio) → herunterladen.

## Schichten (nach Skill „app-architektur“)

| Schicht | Ort | Darf | Darf nicht |
|---|---|---|---|
| Modell | `src/core/model.js` | Typen, stabile IDs, Standardwerte, `sanitize`, Schema-Version, Export/Import des Verlaufs | irgendetwas importieren |
| Logik | `src/core/logic.js` | reine Funktionen: URL-Parsing, Format-Auswahl, Job-Zustandsmaschine, Fallback-Entscheidung, Versionsvergleich | DOM, Netz, Dateien, Uhr, Prozesse |
| Engine-Interface | `src/core/engine.js` | Vertrag `DownloadEngine` + Prüfer `checkEngine` | Fremdprogramme kennen |
| Ablaufsteuerung | `src/core/orchestrator.js` | Engines über das Interface nacheinander aufrufen (Fallback-Kette) | wissen, welches Programm dahinter steckt |
| Adapter | `src/adapters/…` | yt-dlp, ffmpeg, YouTube Data API, Playwright, Dateisystem, Prozessstart | in die Oberfläche greifen |
| Hülle Phase 1 | `server/` | lokaler HTTP-Server auf 127.0.0.1 (optional Heimnetz mit Kopplung), JSON-API + SSE | Logik selbst enthalten |
| Oberfläche | `web/` | PWA, Texte (`texts.js`), Rendering, Formatierung, Uhr | Fremdprogramme direkt ansprechen |

Abhängigkeiten nur in eine Richtung: Oberfläche → API → Hülle → Ablaufsteuerung → Interface/Logik → Modell. Adapter → Interface/Modell. Nie rückwärts.

## Engine-Interface `DownloadEngine`

```
id: StrategyId                    // 'ytdlp' | 'ytdlp-cookies' | 'official' | 'browser-capture'
capabilities(): { metadata, download, audioOnly, playlist, needsUserAction }
checkAvailable(): Promise<{ ok, version, errorCode }>
probe(url, ctx): Promise<{ ok, metadata } | { ok:false, errorCode, detail }>
download(request, ctx{ signal, onEvent }): Promise<{ ok, files[] } | { ok:false, errorCode, detail }>
```
Ereignisse (`onEvent`) sind reine Daten: `phase`, `progress`, `file`, `log`. In Rust wird daraus ein `trait DownloadEngine` mit `enum EngineEvent`.

## Strategien

- **A `ytdlp`**: yt-dlp ohne Login. Standard.
- **B `ytdlp-cookies`**: wie A mit `--cookies-from-browser <browser>`, nur nach Fehlern wie Bot-Check, Altersfreigabe, Mitglieder, privat, und nur wenn der Nutzer einen Browser gewählt hat.
- **C `official`**: YouTube Data API v3 (eigener API-Schlüssel) nur für Metadaten; Download-Ergebnis ist ein Hinweis auf YouTube Studio bzw. Google Takeout.
- **D `browser-capture`**: sichtbarer Browser (Playwright), Nutzer startet das Video selbst, App nimmt den Stream auf. Nur ohne DRM, mit Hinweis auf Qualitätsverlust, nur nach ausdrücklicher Zustimmung.

Fallback-Kette (vorläufig, wird nach der Testmatrix festgelegt): A → B → D, C immer für Metadaten/Hinweis, wenn A–B scheitern. Endgültige Fehler (gelöscht, ungültige URL, DRM) brechen die Kette sofort ab.

## Nicht gebaut

Keine Captcha-Löser, keine Proxy-Rotation, keine gefälschten Bot-Signaturen, keine DRM-Umgehung. Bot-Check → Meldung mit Anleitung (im Browser anmelden, Cookies-Option).

## Ordnerstruktur

```
youtube-downloader/
  README.md
  package.json                 nur Tests, keine Abhängigkeiten
  docs/PLAN.md                 dieses Dokument
  docs/TESTMATRIX.md           Schritt 2
  docs/RUST.md                 Schritt 4 (Portierung, Sidecars, iOS-Notiz)
  src/core/model.js            Modell
  src/core/logic.js            Logik
  src/core/engine.js           Interface DownloadEngine + Vertragsprüfung
  src/core/orchestrator.js     Fallback-Kette über das Interface
  src/adapters/process.js      Prozessstart (austauschbar, Attrappe in Tests)
  src/adapters/ytdlp/args.js   rein: Befehlszeilen bauen
  src/adapters/ytdlp/parse.js  rein: JSON/Fortschritt/Fehlertexte von yt-dlp übersetzen
  src/adapters/ytdlp/engine.js Strategie A und B
  src/adapters/http.js         HTTP (einzige Stelle mit fetch)
  src/adapters/official/…      Strategie C
  src/adapters/ffmpeg.js       ffmpeg (Umwandlung für D)
  src/adapters/capture/…       Strategie D (Playwright)
  src/adapters/file-store.js   Einstellungen und Verlauf als JSON-Datei
  src/adapters/ytdlp/update.js neueste yt-dlp-Version abfragen
  server/jobs.js               Warteschlange, Abbrechen, Verlauf
  server/access.js             rein: Zugriff (nur dieser Rechner, mit YTD_LAN=1 gekoppelte Geräte im Heimnetz)
  server/main.js               Hülle Phase 1: API, SSE, statische Dateien
  web/                         PWA: index.html, styles.css (Design), layout.css (Desktop/iOS), sw.js, manifest, src/{texts,api,ui,main,qr}.js
  scripts/icons.js             PNG-Icons (iOS, Android) aus icon.svg
  tests/*.test.js + fixtures/  node --test, Fixtures als JSON (später in Rust wiederverwendbar)
```

## Stand

- 21.10.2026: Desktop-Layout und iPhone/iPad-Fassung (Home-Bildschirm-App als Fernbedienung für den Mac, Kopplung per QR-Code). Keine native Swift-App (siehe docs/RUST.md, iOS-Notiz).

- Schritt 1 und 3 fertig: Kern, alle vier Strategien, Server, Oberfläche, 60 Tests.
- Schritt 2 offen: Testmatrix mit echten URLs auf dem Mac.

## Umgebung (Cloud-Container, Stand 13.10.2026)

- Node 22, Python 3.13, ffmpeg vorhanden, yt-dlp 2026.08.19 per pip installiert.
- **youtube.com, youtu.be, i.ytimg.com sind von der Netzwerkrichtlinie gesperrt (403 am Proxy).** Echte YouTube-Downloads lassen sich hier nicht testen.
- googleapis.com ist erreichbar; die Data API braucht einen API-Schlüssel.
- Tests hier: Logik mit Fixtures, Engine A gegen eine lokal erzeugte Testdatei (ffmpeg) über 127.0.0.1. Die echte Testmatrix muss auf Annas Mac laufen (Skript liegt bei).
