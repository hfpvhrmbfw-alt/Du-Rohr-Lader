#!/bin/bash
# Baut DU-Rohr-Lader.app für eine Mac-Architektur und packt sie als .zip.
# Nur auf macOS (braucht swiftc, sips, iconutil, codesign, ditto). Läuft in .github/workflows/mac-app.yml,
# geht aber genauso auf dem eigenen Mac:   mac/build.sh arm64   oder   mac/build.sh x86_64
# Ergebnis: dist/<arch>/DU-Rohr-Lader.app und dist/DU-Rohr-Lader-<version>-mac-<arch>.zip
set -euo pipefail

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64)  NODE_ARCH=arm64; FF_ARCH=arm64; LABEL=apple-silicon ;;
  x86_64) NODE_ARCH=x64;   FF_ARCH=amd64; LABEL=intel ;;
  *) echo "Unbekannte Architektur: $ARCH (arm64 oder x86_64)"; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_MAJOR="${NODE_MAJOR:-22}"
OUT="$ROOT/dist/$ARCH"
APP="$OUT/DU-Rohr-Lader.app"
CACHE="$ROOT/dist/cache/$ARCH"
mkdir -p "$CACHE"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/bin" "$APP/Contents/Resources/app"
BIN="$APP/Contents/Resources/bin"

fetch() { [ -s "$2" ] || curl -fsSL --retry 3 -o "$2" "$1"; }

echo "== Node.js $NODE_MAJOR ($NODE_ARCH)"
fetch "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt" "$CACHE/node-sums.txt"
NODE_TGZ="$(grep -oE "node-v[0-9.]+-darwin-$NODE_ARCH\.tar\.gz" "$CACHE/node-sums.txt" | head -1)"
fetch "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$NODE_TGZ" "$CACHE/$NODE_TGZ"
(cd "$CACHE" && grep " $NODE_TGZ\$" node-sums.txt | shasum -a 256 -c -)
tar -xzf "$CACHE/$NODE_TGZ" -C "$CACHE" "${NODE_TGZ%.tar.gz}/bin/node"
cp "$CACHE/${NODE_TGZ%.tar.gz}/bin/node" "$BIN/node"

echo "== yt-dlp (macOS, universal)"
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "$CACHE/yt-dlp_macos"
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS" "$CACHE/ytdlp-sums.txt"
(cd "$CACHE" && grep " yt-dlp_macos\$" ytdlp-sums.txt | shasum -a 256 -c -)
cp "$CACHE/yt-dlp_macos" "$BIN/yt-dlp"
curl -fsSL --retry 3 -o /dev/null -w '%{url_effective}\n' "https://github.com/yt-dlp/yt-dlp/releases/latest" \
  | sed -E 's#.*/tag/##' > "$BIN/yt-dlp.version"
echo "yt-dlp $(cat "$BIN/yt-dlp.version")"

echo "== ffmpeg und ffprobe ($FF_ARCH, statisch, ffmpeg.martin-riedl.de)"
for tool in ffmpeg ffprobe; do
  fetch "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$FF_ARCH/release/$tool.zip" "$CACHE/$tool.zip"
  rm -rf "$CACHE/$tool-x" && mkdir "$CACHE/$tool-x" && ditto -x -k "$CACHE/$tool.zip" "$CACHE/$tool-x"
  cp "$(find "$CACHE/$tool-x" -type f -name "$tool" | head -1)" "$BIN/$tool"
done
chmod 755 "$BIN"/node "$BIN"/yt-dlp "$BIN"/ffmpeg "$BIN"/ffprobe
for f in node ffmpeg ffprobe; do
  lipo -archs "$BIN/$f" | grep -qw "$ARCH" || { echo "$f passt nicht zu $ARCH: $(lipo -archs "$BIN/$f")"; exit 1; }
done

echo "== Programmdateien"
cp "$ROOT/package.json" "$APP/Contents/Resources/app/"
cp -R "$ROOT/server" "$ROOT/src" "$ROOT/web" "$APP/Contents/Resources/app/"

echo "== Symbol"
ICONSET="$CACHE/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/mac/AppIcon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$ROOT/mac/AppIcon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "== Swift-Hülle"
sed "s/__VERSION__/$VERSION/g" "$ROOT/mac/Info.plist" > "$APP/Contents/Info.plist"
swiftc -O -target "$ARCH-apple-macos12.0" -framework Cocoa -framework WebKit \
  -o "$APP/Contents/MacOS/DU-Rohr-Lader" "$ROOT/mac/main.swift"

echo "== Signieren (ad hoc, ohne Apple-Konto)"
for f in "$BIN"/node "$BIN"/yt-dlp "$BIN"/ffmpeg "$BIN"/ffprobe; do codesign --force --sign - "$f"; done
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"

ZIP="$ROOT/dist/DU-Rohr-Lader-$VERSION-mac-$LABEL.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Fertig: $ZIP ($(du -h "$ZIP" | cut -f1))"
