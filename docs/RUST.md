# Rust-Portierung (Phase 2: macOS mit Tauri)

Ziel: Kern 1:1 nach Rust übertragen, PWA-Oberfläche weiterverwenden, yt-dlp und ffmpeg als Sidecar.
Für iOS nur eine Machbarkeitsnotiz (unten), kein Code.

## Modulgrenzen: Datei → Rust

| Heute (JS) | Schicht | Rust (Crate/Modul) | Übertragung |
|---|---|---|---|
| `src/core/model.js` | Modell | `ytd-core::model` | 1:1. ID-Listen → `enum` mit `#[serde(rename_all = "kebab-case")]`, `Option<T>` statt `null`, `sanitize_*` → `From<RawSettings>` |
| `src/core/logic.js` | Logik | `ytd-core::logic` | 1:1, reine Funktionen. `parseUrl` mit Crate `url`, `applyJobEvent` → `fn apply(job: Job, ev: JobEvent) -> Job` |
| `src/core/engine.js` | Interface | `ytd-core::engine` | `#[async_trait] trait DownloadEngine` (Skizze unten) |
| `src/core/orchestrator.js` | Ablauf | `ytd-core::orchestrator` | 1:1, `CancellationToken` (tokio-util) statt `AbortSignal`, Uhr als `&dyn Fn() -> String` |
| `src/adapters/process.js` | Adapter | `ytd-adapters::process` | `tokio::process::Command`, zeilenweise über `BufReader::lines()` |
| `src/adapters/ytdlp/*` | Adapter | `ytd-adapters::ytdlp` | `args.rs` und `parse.rs` 1:1 (rein), Engine über `tauri-plugin-shell` Sidecar |
| `src/adapters/official/*` | Adapter | `ytd-adapters::official` | `reqwest` + `serde`; `parse.rs` 1:1 |
| `src/adapters/ffmpeg.js` | Adapter | `ytd-adapters::ffmpeg` | Sidecar, `build_convert_args` 1:1 |
| `src/adapters/capture/*` | Adapter | neu, siehe Strategie D | Playwright fällt weg |
| `src/adapters/file-store.js` | Speicher | `ytd-adapters::store` | gleiche `data.json` im App-Datenordner (`app_data_dir()`), Schlüssel im macOS-Schlüsselbund (Crate `keyring`) |
| `server/*` | Hülle | `src-tauri` (Commands + Events) | HTTP/SSE entfällt: `#[tauri::command] probe/add_job/cancel/retry…`, Fortschritt per `app.emit("job", job)` |
| `web/*` | Oberfläche | `ui/` in Tauri | bleibt; nur `api.js` wird gegen `@tauri-apps/api` (`invoke`, `listen`) getauscht |
| `tests/fixtures/*.json` | Tests | `ytd-core/tests/` | dieselben Dateien, per `include_str!` geladen, gleiche Erwartungen |

Abhängigkeiten bleiben einseitig: `ytd-core` hat keine Abhängigkeit auf tokio-process, reqwest oder Tauri
(nur `serde`, `url`, `async-trait`). `ytd-adapters` hängt von `ytd-core` ab, `src-tauri` von beiden.
Ein Test wie `tests/architecture.test.js` wird zu einer `cargo deny`-/`cargo tree`-Prüfung im CI.

## Interface-Skizze

```rust
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StrategyId { Ytdlp, YtdlpCookies, Official, BrowserCapture }

pub enum EngineEvent {
    Phase(JobPhase),
    Progress { percent: Option<f64>, downloaded: Option<u64>, total: Option<u64>, speed: Option<f64>, eta: Option<u64>,
               playlist_index: Option<u32>, playlist_count: Option<u32> },
    Title(String),
    File(PathBuf),
    Log { stream: Stream, line: String },
}

pub struct EngineError { pub code: ErrorCode, pub detail: Option<String> }

#[async_trait]
pub trait DownloadEngine: Send + Sync {
    fn id(&self) -> StrategyId;
    fn capabilities(&self) -> Capabilities;
    async fn check_available(&self) -> Availability;
    async fn probe(&self, url: &str, cancel: CancellationToken) -> Result<Metadata, EngineError>;
    async fn download(&self, req: &DownloadRequest, cancel: CancellationToken,
                      on_event: &(dyn Fn(EngineEvent) + Send + Sync)) -> Result<Vec<PathBuf>, EngineError>;
}
```

## Sidecar-Handling (yt-dlp, ffmpeg)

- **Einbinden:** `bundle.externalBin = ["binaries/yt-dlp", "binaries/ffmpeg", "binaries/ffprobe"]` in `tauri.conf.json`,
  Dateien mit Ziel-Triple benannt (`yt-dlp-aarch64-apple-darwin`, `…-x86_64-apple-darwin`). Aufruf nur über
  `tauri-plugin-shell` mit `sidecar("yt-dlp")`, Freigabe in `capabilities/*.json` auf genau diese Programme und
  Argument-Validierung (`args: [{ validator: … }]` bzw. eigene Prüfung im Adapter: URL immer hinter `--`).
- **yt-dlp:** die eigenständige macOS-Datei `yt-dlp_macos` (Universal, PyInstaller) verwenden, nicht das Python-Zip.
  ffmpeg als statischer Build; Lizenz beachten (LGPL-Build ohne `--enable-gpl`, oder GPL-Hinweise mitliefern).
- **Signieren/Notarisieren:** Sidecars werden mitsigniert (Hardened Runtime). PyInstaller-Programme entpacken zur
  Laufzeit nach `/tmp`; vorher testen, ob Gatekeeper das notarisierte Bundle startet.
- **Updates:** yt-dlp muss oft aktualisiert werden, signierte Bundles kann man aber nicht verändern. Vorschlag:
  mitgelieferte Version als Rückfall; der Update-Check (`isNewerVersion`) lädt auf Wunsch die neue Release-Datei von
  GitHub in den App-Datenordner, prüft sie gegen `SHA2-256SUMS` des Releases und nutzt sie dann bevorzugt.
  Alternative: vorhandenes `brew`-yt-dlp im `PATH` bevorzugen (Einstellung „System-yt-dlp verwenden“).
- **Abbrechen:** `CommandChild::kill()`; Teil-Dateien (`*.part`) bleiben für „Wiederholen“ liegen (yt-dlp setzt fort).
- **Cookies (Strategie B):** `--cookies-from-browser` braucht unter macOS Zugriff auf den Schlüsselbund (Chrome) bzw.
  Festplattenvollzugriff (Safari). Meldung `cookies_unavailable` erklärt das; keine Rechte stillschweigend anfordern.
- **App Sandbox:** Für den Mac App Store wäre die Sandbox Pflicht; Subprozesse mit Netzzugriff und Zugriff auf
  Browser-Profile vertragen sich schlecht damit. Empfehlung: Verteilung außerhalb des App Stores (Developer ID, notarisiert).

## Strategie D unter Tauri

Playwright fällt weg. WKWebView kann `captureStream()` an Video-Elementen nach heutigem Stand nicht zuverlässig
(vor der Umsetzung prüfen). Optionen:
1. Eigenes Fenster mit der Videoseite, Aufnahme dieses Fensters über **ScreenCaptureKit** (`SCStream` mit Fenster-Filter,
   Audio der App) und Kodierung per AVAssetWriter oder ffmpeg-Sidecar. Braucht die Freigabe „Bildschirmaufnahme“.
2. Playwright/Chromium weiter als optionales externes Werkzeug (wie heute), nur wenn installiert.
DRM-Prüfung bleibt: geschützte Inhalte werden von macOS in der Aufnahme ohnehin geschwärzt; die App bricht ab, sobald
die Seite verschlüsselte Medien meldet.

## Reihenfolge

1. `ytd-core` anlegen, Modell und Logik übertragen, alle Fixtures aus `tests/fixtures/` grün.
2. `ytd-adapters::ytdlp` (args/parse 1:1 mit denselben Fixtures), dann Engine mit Sidecar.
3. Tauri-Hülle: Commands und Events, `ui/` aus `web/` übernehmen, `api.js` tauschen.
4. Store, Update-Mechanismus, C, zuletzt D.
5. Signieren, Notarisieren, Testmatrix erneut auf beiden Architekturen.

## iOS: Machbarkeitsnotiz (kein Code)

- **Technisch:** iOS erlaubt keine Subprozesse; yt-dlp (Python) und ffmpeg lassen sich nicht als Programme starten.
  Möglich wären nur eingebettete Bibliotheken (z. B. ffmpeg als Framework, Python-Laufzeit eingebettet), mit großem
  Aufwand und ohne die schnellen yt-dlp-Updates (App-Review für jede neue Version).
- **App Store:** Die Richtlinien (Abschnitt 5.2.3) untersagen Apps, die Medien von Drittanbieterdiensten wie YouTube
  ohne deren ausdrückliche Erlaubnis speichern oder herunterladen. Auch die YouTube-Nutzungsbedingungen erlauben
  Downloads nur über von YouTube angebotene Wege. Eine iOS-App mit A/B/D würde abgelehnt.
- **Was ginge:** eine Begleit-App, die per Teilen-Menü eine URL an den eigenen Mac schickt (der Mac lädt), oder
  ausschließlich der offizielle Weg (Strategie C: Metadaten über die Data API, Verweis auf YouTube Studio / Takeout).
  Empfehlung: iOS nur als Fernbedienung für die Mac-App.
- **Umgesetzt (21.10.2026):** genau diese Fernbedienung als Home-Bildschirm-Web-App (`YTD_LAN=1`, Kopplung per QR-Code,
  `server/access.js`). In Tauri später: dieselbe Kopplung im eingebetteten Server, keine eigene iOS-App nötig.
