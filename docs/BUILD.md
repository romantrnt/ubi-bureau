# Build and runtime guide

[Home](../README.md)

## Runtime requirements

The source native application uses these components. The AppImage bundles its own official Node.js 24.22.3 runtime; the other dependencies remain system-provided:

- glibc-based Linux x86_64 for the published AppImage. Its bundled Node requires glibc 2.28+ and compatible libstdc++/libgcc. Alpine/musl is not a supported target.
- **Node.js 22.13+** for the native launcher and OpenCode/Hermes through `node:sqlite`. The basic browser-mode watcher can run on Node.js 18+, with those SQLite-backed clients unavailable.
- Python 3, PyGObject (`gi`), GTK 4.0 and **WebKit 6.0** introspection bindings.
- A graphical desktop session and working WebGL support. GNOME/Wayland is the primary target.

WebKitGTK 4.0 or 4.1 is not a substitute for the required WebKit 6.0 GI namespace. Distribution package names vary. Install dependencies through your distribution's supported packages; the AppImage does not install them or request administrator access.

On Arch Linux, the native runtime packages used by the tested build are:

```sh
sudo pacman -S --needed python python-gobject gtk4 webkitgtk-6.0
```

This is an installation command for the user to review, not something the AppImage runs.

Check a Python environment without starting the office:

```sh
node --version
python3 -c "import gi; gi.require_version('Gtk', '4.0'); gi.require_version('WebKit', '6.0'); from gi.repository import Gtk, WebKit; print('GTK4 / WebKit6 available')"
```

A virtual environment may hide system `gi` bindings. Prefer the system Python with the distribution's PyGObject packages.

## Run from source

```sh
git clone https://github.com/romantrnt/ubi-bureau.git
cd ubi-bureau
python3 bin/agent-office.py
```

The web bundle and office assets are committed. No `npm install` is needed merely to run them.

Browser mode only needs Node and a WebGL-capable browser:

```sh
node bin/cli.js --port 4547
node bin/cli.js --port 4547 --demo
node bin/cli.js --port 4547 --private
```

The release uses application ID `io.github.romantrnt.UbiBureau` and native loopback port **4547**, separate from the older local variants. Use a separate directory and port to keep an upstream installation unchanged. Do not replace a working installation with an untested build.

## Development checks

```sh
npm ci
npm test
npm run build
npm run test:bureau
python3 -m unittest discover -s tests -p 'test_*.py'
# Explicit native demo smoke, opens and closes its own QA window:
GDK_BACKEND=wayland BUREAU_PORT=0 python3 tests/native-smoke.py
GDK_BACKEND=wayland BUREAU_PORT=0 python3 tests/native-acceptance.py
GDK_BACKEND=wayland BUREAU_PORT=0 python3 tests/native-scene.py
```

`npm ci` installs pinned development dependencies, including esbuild, Three.js and Playwright. UI tests need a compatible Chromium installation; configure `WMAD_CHROMIUM` when applicable. Browser binaries are separate from the npm package. Use synthetic fixtures and isolated test state, never copies of real conversations.

The bundle is generated from `web/office3d.js` into `public/office3d.js`. Include both source changes and the rebuilt bundle in a release. A successful build is not a substitute for browser interaction tests or native GTK/WebKit validation.

## AppImage packaging

```sh
npm run appimage
```

The build produces the x86_64 AppImage under `dist/`. The package includes the app source, prebuilt web assets, official Node.js 24.22.3 Linux x64 runtime and licenses. Its Type 2 runtime mounts or extracts the filesystem and starts `AppRun`. **Python, GTK4, PyGObject and WebKitGTK remain host dependencies; system Node is not needed.** This deliberately avoids bundling one distribution's native libraries and claiming unverified portability.

The packaging process uses the official AppImage Type 2 runtime and Node.js distribution, checking their pinned digests before use. Building requires the download tools used by the packaging script plus `mksquashfs` from squashfs-tools and tools to unpack the Node archive. Review the script and its pinned runtime source before changing the pin.

```sh
chmod +x dist/Ubi_Bureau-0.3.0-x86_64.AppImage
dist/Ubi_Bureau-0.3.0-x86_64.AppImage --version
dist/Ubi_Bureau-0.3.0-x86_64.AppImage --check
dist/Ubi_Bureau-0.3.0-x86_64.AppImage --demo
```

The native app is single-instance. Close its window before relaunching with different data/privacy flags; activating an existing window does not change its mode.

If FUSE is unavailable, use `--appimage-extract-and-run`. Extraction does not provide the missing host dependencies. AppImage is packaging, **not a sandbox**.

## Troubleshooting

- **`gi` missing or WebKit namespace unavailable:** install the distribution's Python GObject/GTK4/WebKitGTK 6.0 packages and use the matching system Python.
- **Blank office or 3D error:** check WebGL/graphics-driver support. This interface is 3D-first; an error is not silently represented as a working scene.
- **No agents:** confirm that supported local clients have written readable session records. Client format changes or a different home directory can prevent discovery. Do not run the app as root to work around this.
- **Dot status unavailable:** one coordinator is shown, but this release does not connect to a cloud API. Read [Dot snapshots](DOT.md).
- **Codex button does nothing:** a compatible `codex://` desktop handler must already be installed. The app does not install a handler or guarantee the destination application's behavior.
- **Port in use:** stop only the instance you own, or choose a separate browser-mode port. Do not terminate unrelated servers.

For each release, read its verification notes for the exact environment and checks actually run. A dependency check, a headless Chromium test and an interactive Wayland launch are different levels of validation.
