<div align="center">

[**English**](README.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md)

# Ubi Bureau

**Your agents. One pixel workspace.**

[Download for Linux](https://github.com/romantrnt/ubi-bureau/releases/latest) · [Connect agents](docs/CONNECTIONS.md) · [Build](docs/BUILD.md) · [Privacy](docs/PRIVACY.md)

<img src="docs/assets/overview.png" alt="Ubi Bureau pixel workspace with synthetic agent activity and an English session ledger" width="1100">

<sub>Synthetic demo sessions. No private conversations.</sub>

</div>

Ubi Bureau is a local agent observatory. See who is working, who needs an answer, what each agent last did, and where the evidence came from. A hand-built voxel workspace sits beside a searchable session ledger and detailed telemetry. The entire application opens in English.

## Inside the bureau

- **An original pixel workspace.** Isometric furniture, provider-specific characters, a triple-server Dot and crisp pixel rendering, a freely rotating 3D camera and silhouette outlines. The default scene is built from geometry authored for Ubi Bureau; it does not download third-party scene models.
- **A useful scene.** Work states, names and selected activity belong to the characters. Select a character to inspect its session; use the ledger to find a task, provider, project or session ID.
- **Connections you can inspect.** The Connections screen lists supported stores, their availability and setup guidance. Adapters cover Claude Code, Codex, Gemini CLI, Antigravity CLI, Hermes, DeepSeek Harness, OpenCode, Copilot CLI, Kimi Code, Grok Build, OMP and Pi. Antigravity App, IDE and CLI use separate documented transcript sources. Detecting an installation without a readable transcript does not establish access to its conversations. [Exact coverage and paths](docs/CONNECTIONS.md).
- **Evidence, not guesses.** Every status carries its source and observation time. A fresh local event is not proof of a running process. Nonterminal evidence older than 120 seconds becomes unknown; a disconnected stream stops presenting unconfirmed work as current.
- **Current sessions and history.** Completed work stays searchable in history and leaves the workspace. Unknown sessions remain inspectable. Pausing decorative motion never pauses status updates.
- **Details at hand.** Read available messages, model/context/token fields, copy session IDs or resume commands, and open supported Codex links from the native window. Missing fields stay missing.
- **One Dot.** The coordinator keeps its three-server silhouette. Cloud snapshots never create a crowd or a fabricated active-worker count; current cloud status stays unavailable without a reliable live feed.

## Start

Download `Ubi_Bureau-0.4.0-x86_64.AppImage` and `SHA256SUMS` from [Releases](https://github.com/romantrnt/ubi-bureau/releases/latest).

```sh
chmod +x Ubi_Bureau-0.4.0-x86_64.AppImage
./Ubi_Bureau-0.4.0-x86_64.AppImage --check
./Ubi_Bureau-0.4.0-x86_64.AppImage --demo
# Close the demo; launch normally for local sessions:
./Ubi_Bureau-0.4.0-x86_64.AppImage
```

Linux x86_64/glibc is the packaged target. Node.js is bundled; **Python 3, PyGObject, GTK4 and WebKitGTK 6.0 are system requirements**. The AppImage does not bundle a whole desktop runtime. Without FUSE, use `--appimage-extract-and-run`. [Runtime requirements and troubleshooting](docs/BUILD.md).

Open **Connections** to inspect discovery. No account login or API key is required for local stores. Start the supported client normally; new sessions appear automatically. This is an observatory, not a service that starts agents or submits paid model calls.

## Controls

| Control | Action |
| --- | --- |
| Click a character or session | Inspect the same session |
| Drag / mouse wheel | Orbit / zoom the workspace |
| `Ctrl K`, `⌘ K` or `/` | Search sessions |
| `↑`, `↓`, `Enter` | Navigate and inspect the ledger |
| `F` | Find the selected character |
| `N` | Next session needing attention |
| `B` | Toggle the ledger |
| `+`, `−`, `0` | Zoom / overview |
| `M` | Pause decorative motion |
| `?`, `Esc` | Shortcuts / close or return |

Settings and appearance are saved locally. Reduced motion is respected. Telemetry remains available independently of the scene.

## Updates and privacy

Signed AppImage updates retain the release identity introduced in 0.2.0. Downloads are verified before installation, installation needs explicit confirmation, and the old image is preserved as an independent backup. There is no automatic restart. See [Updates](docs/UPDATES.md).

Provider stores are read locally. Ubi does not alter conversations, ask for provider credentials or upload session data. The server listens on loopback. **Do not expose it through a tunnel or reverse proxy.** Other local programs can access it. `--private` hides prompts, replies and titles but does not anonymize every metadata field. [Privacy](docs/PRIVACY.md).

## Development

```sh
git clone https://github.com/romantrnt/ubi-bureau.git
cd ubi-bureau
npm ci
npm test
npm run build
npm run test:bureau
node bin/cli.js --port 4547
# Native window:
python3 bin/agent-office.py
```

The 3D scene is `web/office3d.js`, mascots are `web/mascots.js`, and interface styles are `public/bureau.css`. The generated `public/office3d.js` bundle is committed for direct launch. [Verification](docs/TESTING.md) distinguishes synthetic scenarios, native evidence and actual provider coverage.

## Credits

Ubi Bureau is an independent derivative of [whatsmyagentdoing](https://github.com/Charonyuu/whatsmyagentdoing), originally based on v0.8.1 commit `c69bf2bc98cf96a63d146070e9bbc83b507bf0bf`. Its [MIT attribution](LICENSE) is preserved. The 0.4 default pixel scene and interface are authored for Ubi Bureau; retained optional third-party assets, fonts and provider marks keep their respective licenses. See [third-party notices](THIRD-PARTY-NOTICES.md). This project is not affiliated with the agent providers.
