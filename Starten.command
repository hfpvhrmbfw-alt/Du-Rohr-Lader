#!/bin/bash
# Doppelklick-Start für macOS: startet den Server und öffnet die App im Browser.
# Läuft der Server schon, wird nur der Browser geöffnet. Beenden: dieses Fenster schließen oder ctrl C.
# Für das iPhone als Fernbedienung vorher YTD_LAN=1 setzen (siehe README).

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-8787}"
URL="http://127.0.0.1:$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Einmal im Terminal ausführen: brew install node yt-dlp ffmpeg"
  read -r -p "Enter drücken zum Schließen …"
  exit 1
fi

if curl -fs "$URL/" >/dev/null 2>&1; then
  echo "Läuft schon, öffne $URL"
  open "$URL"
  exit 0
fi

node server/main.js &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM

for _ in $(seq 1 50); do
  curl -fs "$URL/" >/dev/null 2>&1 && break
  kill -0 $SERVER 2>/dev/null || { read -r -p "Server ließ sich nicht starten. Enter drücken zum Schließen …"; exit 1; }
  sleep 0.2
done
open "$URL"
echo "Zum Beenden dieses Fenster schließen oder ctrl C drücken."
wait $SERVER
