# Privacy and local trust model

[Home](../README.md)

## What the app reads

Ubi Bureau reads supported agents' session journals and local databases to infer activity and display available session metadata. Depending on the client, the UI may include prompts, replies, tool descriptions, project paths, identifiers, model names and usage records. Reading a source does not change the underlying conversation.

These are private files. The application is not a permission broker or a sandbox: it runs with the access of the user who launches it. Only run it in an account whose local session data you intend to inspect.

## Where data goes

The native window connects to its local HTTP server through `127.0.0.1`. The server rejects non-loopback Host names and does not provide an authenticated remote dashboard. **Other programs on the same computer may still be able to read the local server.** Do not expose it with a public tunnel, reverse proxy, container port publication or router forwarding.

There is no built-in upload of local conversations to a hosted Ubi Bureau service. The app is not a cloud-agent relay. Optional integrations configured by the user, such as a local Magpie source, have their own trust boundaries. Do not put their credentials in source files, screenshots or issues.

The office's bundled assets work locally. Selecting an extra scene can download a pack from the catalog's upstream URL; the downloaded bytes are checked against the pinned SHA-256. This is network traffic, not a session-data upload. The upstream self-updater remains disabled. Ubi Bureau 0.2.0 and later have a signed AppImage updater: by default it requests a public GitHub release manifest after 30 seconds and every 24 hours while the native AppImage is open. Manual-only mode disables automatic checks; automatic download is opt-in, installation always explicit. No session data, titles, IDs or credentials are included in update requests. GitHub/CDN still see normal connection metadata such as IP address. Preferences are stored in the local Ubi configuration directory. See [Updates](UPDATES.md) for trust and recovery limits.

## Private and demo modes

`--private` suppresses prompts, replies and titles and disables the transcript endpoint. It **does not fully anonymize** the office: identifiers, project paths, model/usage metadata and other contextual details may remain visible. It is not a promise that every screen is safe to share.

Use `--demo` for public screenshots, recordings and demonstrations. Review the final image before sharing. Never publish a screenshot merely because a test passed.

## Local state and actions

- Display preferences and saved camera angles are stored locally by the web view/browser.
- Optional scene packs are saved under `~/.whatsmyagentdoing/scenes`.
- Explicit Dot snapshots use a local JSON file; see [the snapshot contract](DOT.md). They contain only observations supplied by the operator; the UI collapses them to one coordinator with unavailable live status and active-worker count.
- Copy buttons write the selected command or metadata to the clipboard. They do not execute commands.
- Native Codex navigation passes a validated `codex://threads/<UUID>` link to the desktop's registered handler after a user action. That may open a conversation in another app.

## Reporting problems safely

Before attaching logs, remove prompts, replies, usernames, absolute home paths, session identifiers, API keys, tokens, cookies, authorization headers and database contents. Prefer a minimal synthetic fixture with the same shape as the failure. Do not attach session archives or authentication files to a public issue.

Do not store personal state, `.env` files, local snapshots, backups or generated diagnostic captures in the repository or AppImage. Release screenshots must use synthetic data. The MIT source license does not authorize redistribution of anyone's private session data.
