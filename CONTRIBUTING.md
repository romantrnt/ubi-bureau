# Contributing to Ubi Bureau

Use an issue or a focused pull request for a reproducible problem or a proposed change. Keep the original upstream attribution and the distinction between local observations and Dot snapshots intact.

## Development

Follow [the build guide](docs/BUILD.md). Before submitting:

```sh
npm ci
npm test
npm run build
npm run test:bureau
python3 -m unittest discover -s tests -p 'test_*.py'
```

Report which checks passed, failed or could not run, with the relevant Node/Python/GTK/WebKit and desktop versions. Do not call headless browser testing an interactive native-window test.

## Test data and UI changes

Use synthetic sessions and an isolated temporary home/state directory. Never commit real agent transcripts, cloud snapshots, cookies, keys, local installation manifests, backup folders or screenshots containing private work.

For UI changes, cover selection identity, repeated selection, search, keyboard return, help dismissal, resize, focus, stale/missing data, and 3D-load failures. Verify light/dark appearance and readable text. Keep decorative animation separate from data freshness.

For native navigation, intercept the external launch in tests. Do not open a contributor's real Codex conversation as an automated side effect. Preserve the user-gesture requirement and validate the whole URI, not just its prefix.

## Release checklist

1. Test the final source and rebuild the committed web bundle.
2. Inspect the tracked file list and packaged filesystem for personal state and secrets.
3. Preserve full third-party license texts and provenance for downloaded build inputs.
4. Build the AppImage, check its version/dependencies, and test the actual artifact where possible.
5. Document host-runtime requirements and the precise compatibility/verification limits.
6. Publish checksums with the release. Verify the published commit and downloaded artifact match the intended versions.

Do not silently add a cloud connection, telemetry, automatic credential access or a misleading “live” indicator. Keep changes small enough to review, and describe any new network or persistence behavior.
