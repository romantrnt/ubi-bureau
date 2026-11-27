# Verification: Ubi Bureau 0.4

Release checks are performed against the final source and the actual AppImage. The [release page](https://github.com/romantrnt/ubi-bureau/releases/tag/v0.4.0) records the source revision, exact checksum and CI result. A source run does not prove a later artifact passed.

## Automated checks

- `npm test`: 150 parser, discovery, evidence, API/privacy, update-security and model-lifecycle tests. Added regressions cover Antigravity App/IDE/CLI transcript discovery and mirrors, Hermes profiles/current message generation/resume quoting, unsupported database schemas and connection diagnostics.
- `npm run build`: rebuilds the committed Three.js bundle; `git diff --exit-code -- public/office3d.js` confirms it matches its source.
- Two Python native navigation-policy tests preserve the exact local-origin and user-gesture URI rules.
- `npm run test:bureau`: isolated browser scenarios for the English interface, history/current/unknown states, settings, keyboard/focus, save/restore camera, connection failures/retry, updater confirmation, raycast identity at DPR2, new-session discovery, capacity changes, outlines and clipped-label hover. The UI is checked at 1440, 1280, 900 and 640 CSS pixels.
- `tests/pixel-scene.cjs` exercises the actual 3D renderer with all named provider models, low-resolution pixel framebuffer, focus, orbit silhouettes and 50 synthetic actors. Software Chromium measurements are diagnostic, not a native frame-rate promise.
- `tests/pixel-lifecycle.cjs` writes isolated synthetic Codex journals, then exercises the production watcher → SSE → Three.js pipeline. It checks discovery, retained actor identity/zoom, completion while paused, 30 journals, one unknown Dot and removal of unconfirmed work after a transport failure.

The browser fixtures and updater UI mocks never submit a model turn, start an agent, or prove authenticated operation of every provider.

## Native checks

`tests/native-pixel.py` launches the production GTK4/WebKit window with isolated stores. It exercises a new session, completion while paused, settings, reload persistence, a burst to 14 visible bodies and the connection dialog. It saves JSON evidence and WebKit snapshots. `tests/native-scene.py` exercises 14 scenarios: overview and sidebar state, Dot/Codex focus and camera rotations, body selection with labels removed, and 1/10/25 bodies with outlines on/off.

The source acceptance run on 2026-11-27 passed these scenarios. Pixel font loading and English were observed in the native window; there were no JavaScript errors. At 25 bodies with outlines, one native sample measured approximately 6 ms for render plus GPU completion and 16 ms between ordinary frames. These short measurements come from one Linux host and do not guarantee performance on other GPUs. Cold growth and large bursts can still cause a visible pause.

Use `BUREAU_QA_ROOT` to run the same acceptance against an extracted AppImage's `usr/share/ubi-bureau`, and `AGENT_OFFICE_NODE` for its bundled Node. Only the final release record establishes artifact acceptance. Native screenshots use synthetic data; they contain no private conversations. Harnesses clear inherited provider/feed overrides before constructing fixture stores.

## Actual local providers

A metadata-only production watcher scan on this host took 67 ms. Codex returned 11 local sessions. Antigravity App/IDE/CLI and Kimi directories existed but had no supported recent sessions; they reported Ready. Hermes, DeepSeek Harness, Claude Code and other missing sources reported Missing. This verifies truthful discovery and diagnostics on this host, not authenticated end-to-end operation of absent clients. Supported schema fixtures are described in [Connections](CONNECTIONS.md).

## Reproduce

```sh
npm ci
npm test
npm run build
git diff --exit-code -- public/office3d.js
python3 -m unittest discover -s tests -p 'test_*.py'
npx playwright install chromium
npm run test:bureau
# A graphical Linux session and system GTK/WebKit are required:
GDK_BACKEND=wayland python3 tests/native-pixel.py
GDK_BACKEND=wayland python3 tests/native-scene.py
```

`WMAD_CHROMIUM=/path/to/chromium` selects an installed browser; `BUREAU_TEST_FILES` selects comma-separated suites. `BUREAU_QA_OUTPUT` selects native evidence output. Native tests must finish with their child server stopped.

## Release and limits

The final AppImage is compared with the packaged source allowlist and `BUILD_INFO.json`. Its manifest is verified with the unchanged pinned release key. Uploaded/downloaded GitHub bytes must match the tested artifact. A real network update from a disposable previous-version image is a separate check after publication; offline signature or mocked UI tests cannot establish it. Never use an operator's installed image for that test.

No reliable continuous cloud Dot feed or active cloud-worker count is claimed. Local events describe observed activity, not process liveness. Remote machines and cloud-only chats need an explicit supported source. Antigravity stores without the documented transcript are not decoded. No Windows/macOS native package, ARM64, musl/Alpine, every GPU or every future provider format is certified.
