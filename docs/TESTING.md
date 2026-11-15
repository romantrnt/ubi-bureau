# Release verification: 0.3.0

Source checks on 2026-11-15 used one Arch Linux x86_64 GNOME/Wayland machine. Artifact verification, the exact source commit and its GitHub Actions result belong to the [release page](https://github.com/romantrnt/ubi-bureau/releases/tag/v0.3.0). A source pass does not establish that a later package passed.

## Source acceptance evidence

- `npm test`: **142 tests** covering parsers/watchers, HTTP/privacy, transcripts, usage, evidence freshness, one unknown Dot, scene lifecycle, cached mascot ownership and signed updates.
- `npm run build` and two Python native-policy tests passed. The pinned update public key and updater implementation are unchanged from 0.2.0.
- A genuine new Codex CLI session, run in a temporary working directory with the read-only sandbox and normal configured authentication/model, was discovered by the production watcher/API in approximately **5 seconds**. It progressed through `thinking → tool → thinking → done`, executed a harmless 15-second sleep and exited successfully. Every observation reported `source: session-log`, `live: false`. This used a real model turn and was separate from native rendering checks. Existing journals were not edited.
- `tests/native-acceptance.py` used the production GTK/WebKit window, real watcher and isolated synthetic Codex journals. A newly written session appeared and rendered in **1.99 seconds**; completion removed its body even while motion was paused. Label preferences survived reload, the native flag remained set, and a burst reached 14 bodies / 16 stations in **4.09 seconds**. Dark background was `rgb(33, 33, 33)` and the bundled font loaded. These are single measurements, not latency guarantees.
- `tests/native-scene.py` passed **14 native scenarios**: overview, sidebar closed, Dot/Codex focus and two rotated views, and 1/10/25 bodies with outlines disabled/enabled. Body picking was checked with overlay labels temporarily removed. Unknown Dot had no movement path and stayed at its dock across room growth; terminal fixtures never acquired bodies. Native snapshots were visually inspected. The README image contains clearly marked synthetic data from this native test.
- Independent review reproduced and verified corrections for Gemini metadata freshness, batched message/metadata appends, keyboard focus across heartbeat updates, stale working labels during departure, and hover when a body's label anchor is outside the viewport. This was a scoped review, not a comprehensive security audit.

The browser suite exercises current/history filters, truthful unknown states, source health, real SSE socket interruption/reconnection, keyboard focus/search, narrow layout, appearance/settings persistence, camera/body picking, toolbar controls, updater UI, discovery/completion, repeated capacity changes and clipped-anchor hover. It uses isolated synthetic data. Run the complete suite against the release commit and check its actual CI result; mocked update UI states do not establish a network update.

## Native rendering measurements and limits

Short WebKit samples are noisy, especially while other browser tests run. With outlines enabled, synchronous render plus GPU completion averaged approximately **5 / 8 / 16.5 ms** for **1 / 10 / 25** bodies. Ordinary frame intervals averaged **20 / 19 / 41 ms**. This does **not** establish 60 fps at 25 bodies.

Static furniture batching and shared mascot geometry reduced draw calls at those loads from **421 / 1129 / 2637** to **127 / 561 / 1295**. Registered geometry counts were **105 / 149 / 167**; textures stayed at 7 and shader programs at 6. Growth to 10 and 25 bodies still produced one settling gap of roughly **0.68 and 1.06 seconds**. Large simultaneous arrivals can therefore cause a visible pause; steady-state rendering and new-session discovery are separate measurements. Silhouette outlines add no postprocessing render targets.

The native host uses Python 3.14.7, PyGObject 3.56.3, GTK4 4.25 and WebKitGTK 6.0 version 2.52.6. These system libraries are not bundled. The AppImage contains Node 24.22.3.

## Reproduce

```sh
npm ci
npm test
npm run build
git diff --exit-code -- public/office3d.js
python3 -m unittest discover -s tests -p 'test_*.py'
npx playwright install chromium
npm run test:bureau
# Requires an actual desktop session and host GTK/WebKit runtimes:
GDK_BACKEND=wayland python3 tests/native-acceptance.py
GDK_BACKEND=wayland python3 tests/native-scene.py
```

`WMAD_CHROMIUM=/path/to/chromium` selects an existing browser. `BUREAU_TEST_FILES` accepts a comma-separated subset for a focused rerun. Native harnesses accept `BUREAU_QA_ROOT` pointing to an extracted AppImage's `usr/share/ubi-bureau`, `AGENT_OFFICE_NODE` pointing to its bundled Node, and `BUREAU_QA_OUTPUT` for evidence. Verify the final artifact separately from the source tree. See [Updates](UPDATES.md) for signing and publication.

## Not claimed

- No continuous cloud Dot feed or reliable active cloud-worker count; both remain unavailable.
- A fresh local event is evidence of an action, not proof that a process is still alive. Missing fresh evidence becomes unknown; it is never guessed to be completion.
- No automated real Codex conversation switch or exhaustive native keyboard/pointer suite. Browser interaction, real CLI discovery and native rendering are distinct checks.
- No certification for every distribution, desktop, GPU, ARM64, musl/Alpine, or future provider log format.
- No network update is established by offline signature tests. A real released-version download/install must be checked separately using a disposable AppImage, never the operator's installed copy.
