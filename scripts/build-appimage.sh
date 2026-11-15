#!/usr/bin/env bash
# AppImage bundles official Node. Python GI, GTK4 and WebKit6 remain host runtimes.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
[[ $(uname -m) == x86_64 ]] || { echo 'Only x86_64 is supported by this recipe.' >&2; exit 1; }
command -v mksquashfs >/dev/null
mkdir -p dist
runtime=${APPIMAGE_RUNTIME:-dist/runtime-x86_64}
sha=617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46
if [[ ! -f "$runtime" ]]; then
  curl -fL https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64 -o "$runtime"
fi
printf '%s  %s\n' "$sha" "$runtime" | sha256sum -c -
node_archive=dist/node-v24.22.3-linux-x64.tar.xz
if [[ ! -f "$node_archive" ]]; then
  curl -fL https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz -o "$node_archive"
fi
printf '4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb  %s\n' "$node_archive" | sha256sum -c -
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
app="$work/Ubi_Bureau.AppDir"
root="$app/usr/share/ubi-bureau"
mkdir -p "$root" "$app/usr/share/applications" "$app/usr/share/icons/hicolor/256x256/apps"
# Explicit allowlist. Never copy HOME, caches, logs, .git or build dependencies.
for item in bin src public assets package.json scenes.json LICENSE THIRD-PARTY-NOTICES.md THIRD-PARTY-LICENSES README.md README.ru.md README.zh-CN.md docs; do
  cp -a "$item" "$root/"
done
find "$root" -type d -name __pycache__ -prune -exec rm -rf {} +
mkdir -p "$app/usr/bin" "$work/node"
tar -xJf "$node_archive" -C "$work/node" --strip-components=1
cp "$work/node/bin/node" "$app/usr/bin/node"
cp "$work/node/LICENSE" "$root/THIRD-PARTY-LICENSES/node.txt"
cp packaging/runtime-LICENSE "$root/THIRD-PARTY-LICENSES/appimage-runtime.txt"
mkdir -p "$root/packaging"
cp packaging/runtime-LICENSE "$root/packaging/runtime-LICENSE"
source_commit=$(git rev-parse HEAD 2>/dev/null || printf unknown)
node -e 'console.log(JSON.stringify({version:process.argv[1],sourceCommit:process.argv[2],node:"24.22.3",appImageRuntime:"fedfad5"},null,2))' "$version" "$source_commit" > "$root/BUILD_INFO.json"
cp packaging/AppRun "$app/AppRun"
chmod +x "$app/AppRun"
cp packaging/io.github.romantrnt.UbiBureau.desktop "$app/"
cp packaging/io.github.romantrnt.UbiBureau.desktop "$app/usr/share/applications/"
cp assets/icons/256/local.roman.AgentOffice.png "$app/io.github.romantrnt.UbiBureau.png"
cp "$app/io.github.romantrnt.UbiBureau.png" "$app/usr/share/icons/hicolor/256x256/apps/"
ln -s io.github.romantrnt.UbiBureau.png "$app/.DirIcon"
mksquashfs "$app" "$work/payload.squashfs" -root-owned -noappend -comp zstd -all-time 0 -mkfs-time 0 -no-progress
output="dist/Ubi_Bureau-$version-x86_64.AppImage"
cat "$runtime" "$work/payload.squashfs" > "$output"
chmod +x "$output"
(cd dist && sha256sum "$(basename "$output")" > SHA256SUMS)
printf 'Built %s (bundled Node; system GTK/WebKit)\n' "$output"
