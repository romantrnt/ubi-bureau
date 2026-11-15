# Signed AppImage updates

Ubi Bureau 0.2.0 introduces in-app updates for the Linux x86_64 AppImage. Version 0.1.0 has no updater and must be replaced manually once. Source/CLI/demo runs do not check the network for Ubi updates.

## Controls

Open **Updates** in the native window. Defaults: **notify**, every **24 hours** while the application is open, with the first check after 30 seconds. Choose manual-only (`off`), notify, or automatic download; intervals are 1, 6, 24 or 168 hours. Skip hides one version until a manual check. Cancel stops a check/download or an installation before its atomic replacement.

**Installation is always explicit.** The confirmation names the current/new version and target AppImage. A verified download is required. The updater never executes a downloaded image, silently installs, closes the window, or restarts the program. After installation, close and reopen the same AppImage yourself. Sessions, preferences, and other user data are not moved or deleted. A separate backup of the previous executable remains beside the AppImage; its path is shown after installation.

Updates are not a daemon, scheduled OS job, or permanent connection. Automatic requests stop when the app closes. Network activity contains only a generic updater User-Agent and requests for release files, never session data, titles, machine IDs or credentials. GitHub and its release CDN receive normal connection metadata such as the IP address.

## Trust and transport

The pinned public key is `assets/update-public-key.pem`. Manifests are signed with a **separate Ubi Bureau RSA release identity**, not the metuxa key. Node's built-in crypto verifies RSA PKCS#1 v1.5 / SHA-256 before parsing a canonical, size-bounded manifest. The signature covers product/protocol, version/code, Linux x86_64 platform, exact byte size and SHA-256. Release URLs are derived from the verified version and fixed `romantrnt/ubi-bureau` repository, not supplied by the server.

The client fetches `https://github.com/romantrnt/ubi-bureau/releases/latest/download/update-manifest.txt`. HTTPS certificate and hostname verification remain enabled. Every redirect is validated against GitHub's three allowed release hosts, with at most five redirects, bounded headers, a 16 KiB manifest cap, a 512 MiB image cap, idle and total timeouts, and exact signed size/hash checks. Only ELF64 little-endian x86_64 Type 2 AppImage headers are accepted. There is no unsigned fallback or shell-script installer.

A checksum file alone does not authenticate a release. A compromised signing key could authorize malicious software. There is no transparency log, independent online revocation, or automatic trust migration: a key compromise requires a new trusted manual release. A network attacker can block/withhold releases but cannot forge the signed replacement. Manual installation of an old executable can bypass the running-version check; a signed receipt beside the same target retains the floor for subsequent in-app installs.

## Safe replacement and limits

Self-install requires an absolute `APPIMAGE` path, an owned writable/executable regular file, a parent directory owned by the user and not writable by other users, and no final symlinks, hardlinks or set-ID files. Native packages and unsafe/read-only locations require a manual download. GTK4, WebKitGTK 6, Python and PyGObject remain **system dependencies**; updating the AppImage does not install these. Node is bundled. x86_64/glibc only, not ARM64 or musl.

The updater serializes operations. Network transfers and chunked copies use asynchronous I/O rather than blocking the render/server loop. Downloads are private and non-executable. Install re-verifies the signature and hash, checks for concurrent changes, uses a directory-descriptor-anchored same-filesystem temporary replacement, fsyncs it, creates an independent backup, commits a private signed rollback receipt, and atomically renames the replacement. No updater request accepts a file path, URL, key, or command from the UI. The native-only HTTP API requires exact loopback Host/Origin, JSON, and an unpredictable per-process token for changes; it does not enable CORS.

Closing the window cancels outstanding work. The child server stops watching/listening immediately and finishes cleanup or a pending disk flush before exiting; the wrapper does not SIGKILL a filesystem commit after a short timeout. A power loss, forced kill, filesystem failure or full disk can still leave a `.update-lock` or `.ubi-update-*` file. Close every Ubi copy before manually removing a stale `.update-lock`; do not remove the signed `.update-manifest` receipt. On a filesystem that correctly implements atomic rename and fsync, the target contains the previous or new image rather than a partial replacement. This is not a guarantee against arbitrary filesystem or hardware corruption. A receipt prepared before a crash permits retrying the same signed candidate, but prevents substituting an older or different candidate at that version. Keep the backup until the new version runs successfully.

## Release procedure

1. Run backend, updater, browser and native regression tests. Bump `package.json` and lockfile together, commit the complete source, and build the final AppImage from that commit.
2. Keep the private key **outside the checkout**, owned by the release maintainer with mode 0600 and a mode 0700 parent. Back it up securely; losing it requires a deliberate trust migration. Never upload it to a release, CI log or repository. The signing helper refuses a key that differs from the pinned public identity.
3. Run `node scripts/sign-update-manifest.cjs /private/path/release-private.pem dist/Ubi_Bureau-VERSION-x86_64.AppImage dist/update-manifest.txt`. It refuses to overwrite an existing manifest. Review version, checksum, exact build/source commit and dependencies.
4. Upload the AppImage, `SHA256SUMS`, and `update-manifest.txt` to a draft release for the corresponding `vVERSION`. Verify all uploaded bytes and signature, then publish/promote it to latest. Never promote a partial release.

The design follows the security principles of [metuxa's updater](https://github.com/romantrnt/metuxa/blob/4ee1536f18e412e53a0b3f12f80fda6074af9d19/client/gtk/update_manager.cpp), implemented independently in Node for Ubi's bundled runtime. Offline tests use ephemeral test keys and inert synthetic bytes, not the release key or a user's real AppImage. They cover canonical signatures, identities, redirect policy, byte/hash limits, cancellation, explicit install, rollback receipts, atomic replacement/backups, unsafe files/directories/FIFOs, preferences, and HTTP origin/token checks.
