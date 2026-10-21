// Texte der Oberfläche: Beschriftungen zu den Modell-IDs und Meldungen je Fehlercode.
// Später in Swift/Rust: String Catalog bzw. Fluent-Datei.

export const STRATEGY = {
  ytdlp: 'A · yt-dlp',
  'ytdlp-cookies': 'B · yt-dlp mit Browser-Cookies',
  official: 'C · Offizielle API',
  'browser-capture': 'D · Aufnahme im Browser',
};

export const STATE = {
  queued: 'Wartet',
  probing: 'Startet',
  downloading: 'Lädt',
  postprocessing: 'Wandelt um',
  done: 'Fertig',
  failed: 'Fehler',
  cancelled: 'Abgebrochen',
};

export const MODE = { video: 'Video', audio: 'Nur Audio' };
export const HEIGHT = (h) => (h === null ? 'Beste verfügbare' : `bis ${h}p`);
export const BITRATE = (b) => (b === null ? 'Beste / variabel' : `${b} kbit/s`);
export const AUDIO_FORMAT = { original: 'Original (m4a/opus, ohne Umwandlung)', mp3: 'MP3', m4a: 'M4A (AAC)', flac: 'FLAC (verlustfrei)', opus: 'Opus' };
export const CONTAINER = { mp4: 'MP4', webm: 'WebM', mkv: 'MKV' };
export const BROWSER = { chrome: 'Chrome', firefox: 'Firefox', safari: 'Safari', edge: 'Edge', brave: 'Brave', chromium: 'Chromium' };
export const LIVE = { none: null, is_live: 'Live', was_live: 'Livestream-Aufzeichnung', is_upcoming: 'Geplant', post_live: 'Live gerade beendet' };

export const URL_ERROR = {
  empty: 'Bitte eine URL einfügen.',
  invalid_url: 'Das sieht nicht nach einer gültigen URL aus.',
  unsupported_scheme: 'Nur http- und https-Adressen werden unterstützt.',
  missing_id: 'In dieser YouTube-URL fehlt die Video- oder Playlist-ID.',
};

const COOKIE_HOWTO = 'Melde dich in deinem Browser bei YouTube an und wähle ihn unter Einstellungen bei „Cookies aus Browser“ aus. Die App versucht es dann automatisch erneut mit Strategie B.';

/** Überschrift und Anleitung je Fehlercode. */
export const ERROR = {
  invalid_url: ['Ungültige URL', 'Bitte die Adresse prüfen.'],
  unsupported_site: ['Seite nicht unterstützt', 'yt-dlp kennt diese Seite nicht.'],
  private: ['Privates Video', `Nur für Berechtigte sichtbar. Wenn es dein eigenes Video ist: ${COOKIE_HOWTO}`],
  deleted: ['Video nicht mehr verfügbar', 'Das Video wurde gelöscht, entfernt oder existiert nicht.'],
  age_restricted: ['Altersbeschränkt', `YouTube verlangt eine Anmeldung. ${COOKIE_HOWTO}`],
  members_only: ['Nur für Kanalmitglieder', `Nur mit Mitgliedschaft abrufbar. ${COOKIE_HOWTO}`],
  login_required: ['Anmeldung nötig', COOKIE_HOWTO],
  region_blocked: ['In deiner Region gesperrt', 'Der Kanal hat das Video für dein Land nicht freigegeben. Die App umgeht Regionssperren nicht.'],
  rate_limited: ['Zu viele Anfragen', 'YouTube bremst gerade. Warte etwa eine Stunde und versuche es dann erneut. Mit Browser-Cookies (Strategie B) klappt es oft früher.'],
  bot_check: ['YouTube fragt nach einer Bestätigung', `YouTube möchte prüfen, dass du kein Bot ist. Die App löst keine Captchas. ${COOKIE_HOWTO}`],
  drm: ['DRM-geschützt', 'Geschützte Inhalte lädt die App grundsätzlich nicht.'],
  paid_content: ['Bezahlinhalt', 'Gekaufte, geliehene oder Premium-Inhalte lädt die App nicht.'],
  live_not_finished: ['Livestream noch nicht fertig', 'Warte, bis die Übertragung beendet und die Aufzeichnung verfügbar ist.'],
  network: ['Keine Verbindung', 'YouTube ist nicht erreichbar. Internetverbindung prüfen.'],
  tool_missing: ['Programm fehlt', 'yt-dlp oder ffmpeg ist nicht installiert. Auf dem Mac: brew install yt-dlp ffmpeg'],
  cookies_unavailable: ['Browser-Cookies nicht lesbar', 'Den gewählten Browser einmal öffnen und anmelden; unter macOS den Zugriff auf den Schlüsselbund erlauben. Safari braucht „Festplattenvollzugriff“ für das Terminal.'],
  needs_user_action: ['Handgriff nötig', 'Diese Strategie braucht dich: siehe Hinweis unten.'],
  needs_api_key: ['API-Schlüssel fehlt', 'Für Strategie C einen Schlüssel der YouTube Data API in den Einstellungen eintragen.'],
  not_supported_by_engine: ['Keine Strategie verfügbar', 'Keine der eingeschalteten Strategien kann diese Anfrage bearbeiten. Einstellungen prüfen.'],
  cancelled: ['Abgebrochen', ''],
  unknown: ['Unbekannter Fehler', 'Details stehen unten. Ein yt-dlp-Update hilft oft (Einstellungen → Update prüfen).'],
};

export const DETAIL = {
  studio_or_takeout: 'Eigene Videos kannst du offiziell in YouTube Studio (Inhalte → ⋮ → Herunterladen) oder gesammelt über Google Takeout laden.',
  not_started: 'Im geöffneten Browserfenster wurde das Video nicht gestartet.',
  nothing_recorded: 'Es wurde nichts aufgenommen.',
  not_found_or_private: 'Die API findet das Video nicht (gelöscht oder privat).',
};

export const IMPORT_ERROR = {
  not_json: 'Die Datei ist kein gültiges JSON.',
  wrong_app: 'Die Datei stammt nicht aus dieser App.',
  newer_version: 'Die Datei stammt aus einer neueren Version der App.',
  bad_format: 'Die Datei hat ein unbekanntes Format.',
};

export const LEGAL =
  'Lade nur eigene Videos, Inhalte unter Creative-Commons-Lizenz oder gemeinfreie Werke. Du bist selbst dafür verantwortlich, dass du die Rechte hast. DRM-geschützte und bezahlte Inhalte lädt die App nicht, und sie umgeht keine Captchas oder Sperren.';

export const CAPTURE_NOTE =
  'Strategie D öffnet ein Browserfenster. Starte dort das Video selbst; die App nimmt in Echtzeit auf, bis es endet oder du das Fenster schließt. Die Qualität ist geringer als beim direkten Download, Werbung wird mit aufgenommen, DRM-Inhalte gehen nicht.';

export const DEVICE = {
  title: 'iPhone und iPad',
  lanOff: 'Der Server ist nur auf diesem Rechner erreichbar. Für iPhone oder iPad im selben WLAN mit „YTD_LAN=1 npm start“ neu starten. Das iPhone steuert dann den Mac; geladen wird weiterhin hier.',
  scan: 'Mit der Kamera des iPhones scannen, Link in Safari öffnen, dann Teilen → „Zum Home-Bildschirm“. Der Code ist ein geheimer Schlüssel: nicht weitergeben.',
  noAddress: 'Keine Adresse im Heimnetz gefunden. Ist der Mac mit einem WLAN oder Netzwerk verbunden?',
  copy: 'Link kopieren',
  copied: 'Kopiert. Auf dem iPhone über die Zwischenablage einfügen.',
  remote: 'Du steuerst den Mac von diesem Gerät aus. Downloads landen auf dem Mac; fertige Dateien kannst du hier mit „Auf dieses Gerät laden“ in die App „Dateien“ holen.',
  notPaired: 'Dieses Gerät ist nicht (mehr) gekoppelt. Auf dem Mac unter Einstellungen → iPhone und iPad den QR-Code neu scannen.',
};
