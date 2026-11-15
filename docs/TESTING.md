# Release verification: 0.2.0

Source checks on 2026-11-15 used one Arch Linux x86_64 GNOME/Wayland machine. This is not multi-distribution certification. Artifact checks and the exact released source commit are recorded on the [release page](https://github.com/romantrnt/ubi-bureau/releases/tag/v0.2.0); passing source tests is not proof that a later package or CI run passed.

## Passed on the final integrated source

- `npm test`: **124 tests** covering provider/watchers, HTTP/privacy, transcripts, hooks/usage, dated Dot snapshots, scene lifecycle and signed updates.
- `npm run build`: the checked-in web bundle matches the source and lockfile toolchain.
- **Two native-policy tests**, including canonical UUIDs and blocked external/file/script navigation.
- **Seven browser suites**: UI/keyboard/search, focus, DPR2 picking, toolbar/settings, telemetry, updater controls, and live session lifecycle. They were run sequentially in parts after connection interruptions; all final parts passed. Tests use synthetic fixtures and isolated homes, not the operator's journals.
- Native GTK4/WebKitGTK6 with a real watcher and an isolated synthetic Codex store: the new session appeared in **2.43 seconds**, the office expanded from 8 to 12 desks, completion status updated, frames continued and the child server exited cleanly. This latency is one measurement, not a performance guarantee.
- Lifecycle regression: **7 to 8 occupied desks**, then a burst to **17 agents / 20 desks**, with preserved actor identity/camera and no renderer error. Three shrink/grow cycles held GPU allocations at **383 geometries / 11 textures**. Paused/reduced-motion removal and re-add do not leave ghost agents. The real 3D label visibility setting was checked, not only its stored preference.
- Update UI: background notification badge, preferences, token absent from visible DOM, explicit second-click installation confirmation, Escape/focus return, cancellation, changed-condition guard, installed/restart-needed lock, and unsupported/browser mode isolation. The UI suite mocks release states; it does not claim a real future release was installed.
- Offline updater tests: canonical RSA signatures/identity, strict manifest/URL/size/hash/header checks, malformed redirects, cancellation including late completion, FIFO/symlink/hardlink/permission refusal, atomic replacement and independent backup, signed rollback receipt, exclusive lock, fail-closed preferences and HTTP Host/Origin/token protection. Tests generate ephemeral keys and inert image bytes; they never use the release private key or replace a user's app.
- A separate read-only review found four updater/lifecycle edge cases (nonregular-file blocking, unsafe-preference fallback, short shutdown kill, late cancellation). All four were corrected and rechecked. This is not a comprehensive security audit.

The host used Python 3.14.7, PyGObject 3.56.3, GTK4 development package 4.25 and WebKitGTK 6.0 version 2.52.6. System libraries are not copied from this host into the package. Node 24.22.3 is bundled in the AppImage.

## Reproduce

```sh
npm ci
npm test
npm run build
git diff --exit-code -- public/office3d.js
python3 -m unittest discover -s tests -p 'test_*.py'
npx playwright install chromium
npm run test:bureau
# Needs a usable GNOME/Wayland session and host GTK/WebKit runtimes:
python3 tests/native-smoke.py
python3 tests/native-live-smoke.py
```

See [Updates](UPDATES.md) for the signed artifact procedure. Version **0.1.0 has no updater or pinned key**. Its first transition to 0.2.0 is manual; testing the new installation component against a disposable older image does not demonstrate in-app updating by 0.1.0. Future-version flows must be tested using a build that actually contains the updater.

## Not claimed

- No continuous cloud Dot feed, cloud worker enumeration or fabricated model/usage data.
- No automated real Codex conversation switch; link tests do not open private conversations.
- No exhaustive native pointer/keyboard suite. Browser interactions and native rendering/discovery are separate checks.
- No certification for every distro, desktop, GPU, musl/Alpine or ARM64. Python/GI, GTK4 and WebKitGTK6 remain system dependencies.
- No guarantee of stable third-party session formats or fully anonymized metadata in `--private` mode.
- No successful update to an unreleased future version, and no claim that local passes imply remote CI success.

GitHub Actions checks backend/build/native-policy/browser behavior for every push. Verify the exact commit's result rather than relying on another run.
