# Release verification: 0.1.0

Verified on 2026-11-15 on one Arch Linux x86_64 GNOME/Wayland machine. This is not a multi-distribution compatibility claim.

## Passed locally

- Locked dependency install (`npm ci`); npm audit reported no known vulnerabilities for the six installed packages at test time. This is not a security guarantee.
- 104 backend tests: watcher discovery, supported providers, local HTTP guards, transcript/privacy behavior, hooks, usage and dated Dot snapshots.
- `npm run build`, using the lockfile's esbuild and Three.js.
- Two native-policy unit tests covering valid UUIDs, malformed links and blocked external/file/script navigation.
- Native GTK4/WebKit6 smoke using a synthetic 12-agent team: 3D frames rendered, pixel font loaded, eight toolbar controls present. The separate QA window closed and its own server exited.
- Actual AppImage `--version` and `--check` through FUSE, plus `--appimage-extract-and-run --check`.
- Actual AppImage `--demo` launched on Wayland with bundled Node 24.22.3 and an isolated home; its local API showed the 12 synthetic agents. The GTK Quit action closed the app and its server.
- The extracted AppImage's native code was hash-compared to the source and rendered successfully in the WebKit/Wayland smoke test using its bundled Node.

The native test host used Python 3.14.7, PyGObject 3.56.3, GTK4 development package 4.25 and WebKitGTK 6.0 version 2.52.6. System libraries are deliberately not copied from this machine into the release.

## Browser regression suite: all four passed

`npm run test:bureau` uses an in-memory fixture and an isolated home, never the operator's session files. It covers title/font loading, light/dark views, search, same-name identity, stale Dot state, inspector return, keyboard navigation, failure/retry UI, camera focus, DPR2 raycast hover/click, focused resize, zoom, saved views, movement pause, help, sidebar and synthetic Codex link generation. Screenshots in this repository come from that fixture.

## Not claimed

- No continuous cloud Dot feed, cloud worker enumeration or fabricated activity.
- No automated real Codex conversation switch: links and policy are tested without opening a user's private conversation.
- No full native pointer/keyboard regression suite. Browser interactions and native rendering are separate checks.
- No certification for another distro, desktop, GPU, musl/Alpine or ARM64. Python/GI, GTK4 and WebKitGTK6 remain host dependencies.
- No promise that local session formats will never change, or that `--private` fully anonymizes metadata.

GitHub Actions runs the backend/build/native-policy/synthetic browser checks for each push. Check the status of the exact release commit; a local test pass does not imply remote CI has finished.
