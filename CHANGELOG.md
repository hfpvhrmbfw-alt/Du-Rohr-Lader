# Changelog

Alle Neuerungen landen in einer neuen Version. Versionen heißen `DU-Rohr-Lader-MAJOR.MINOR.PATCH`
(z. B. `DU-Rohr-Lader-1.4.20`). Git-Tag und GitHub-Release tragen genau diesen Namen, `package.json` die Zahl dahinter.

- **MAJOR**: Umbau, der Bisheriges bricht (z. B. Datenformat, Bedienung grundlegend anders)
- **MINOR**: neue Funktion
- **PATCH**: Fehlerbehebung, Feinschliff, Texte

Tag und Release legt `.github/workflows/release.yml` beim Merge nach `main` automatisch an,
sobald `package.json` eine Version trägt, die es noch nicht als Tag gibt.

## DU-Rohr-Lader-1.1.0 – 2026-10-24

### Neu
- Titelauswahl bei Playlists: Nach dem Prüfen stehen alle Titel mit Häkchen in der Liste (anfangs alle ausgewählt, dazu „Alle“ und „Keine“). Geladen werden nur die ausgewählten Titel; der Fortschritt zählt „Teil x von y“ nur über die Auswahl.

### Behoben
- Playlist nur teilweise geladen: Scheitert ein einzelner Titel (z. B. gelöscht oder privat), lädt yt-dlp die übrigen weiter, der Auftrag stand danach aber nur als „Fehler“ da. Jetzt steht dabei „x von y Titeln geladen“, und „Wiederholen“ lädt nur die fehlenden nach.
- macOS: Solange ein Auftrag läuft, schläft der Mac nicht mehr von selbst ein (`caffeinate`). Vorher konnte der Ruhezustand mitten in einer Playlist die Verbindung kappen. Zugeklappt schläft er weiterhin.

## DU-Rohr-Lader-1.0.1 – 2026-10-21

### Neu
- Automatische Releases: GitHub Actions legt für jede neue Version Tag und Release an, mit dem Text aus diesem Changelog.

## DU-Rohr-Lader-1.0.0 – 2026-10-21

Erste Version im GitHub-Repo.

### Neu
- Kern mit Datenmodell, Logik und Ablaufsteuerung, sauber getrennt von Oberfläche, Speicherung und Fremdprogrammen.
- Vier Download-Strategien mit automatischem Wechsel: A yt-dlp, B yt-dlp-Varianten, C YouTube Data API (Metadaten, optionaler API-Schlüssel), D Aufnahme im Browser (optional, Playwright).
- Audio-Export über ffmpeg.
- Lokaler Node-Server mit API und Live-Fortschritt (SSE), standardmäßig nur auf 127.0.0.1.
- Web-App (PWA), installierbar, im Design „Castra · Blei“ (Bleigrau, Kästen mit 1px-Linien, Signal-Orange nur für Primärknopf, Fortschritt und Fokus), hell und dunkel.
- Desktop: zweispaltig ab 1100 px, URL per ⌘V oder Ziehen einfügen, `/` springt ins URL-Feld.
- iPhone/iPad als Fernbedienung: mit `YTD_LAN=1` Kopplung per QR-Code, fertige Dateien „Auf dieses Gerät laden“.
- Rust-Portierungsplan in `docs/RUST.md`, Testmatrix-Skript für echte URLs (`scripts/testmatrix.js`).
- 65 Tests (`npm test`), Integrationstests laufen nur mit installiertem yt-dlp bzw. Playwright.
