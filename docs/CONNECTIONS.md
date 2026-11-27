# Agent connections

Bureau discovers local session stores automatically. It does not need model API keys, install hooks, change agent configuration, or launch agents. Start an agent normally, then open **Connections** to inspect its source. New file sessions are discovered within about five seconds; existing append-only logs are checked every second. SQLite stores refresh every five seconds.

English is the primary interface language. Connection instructions, errors and source names are available in English even when the agent itself runs in another language.

## What the connection states mean

| State | Meaning |
| --- | --- |
| Connected | Bureau found sessions in a readable local source within the selected time window. This does **not** assert that their processes are alive. |
| Ready | The source directory/database is readable, but no sessions were found in the selected time window. An empty directory does not establish compatibility with an unknown format. |
| Missing | No local source exists at the inspected paths. Install/run the agent separately, or set its documented environment override before launching Bureau. |
| Unreadable | A source exists but cannot be read/decoded, the SQLite runtime is unavailable, or the database schema is unsupported. Other providers continue working. Bureau retries automatically. A provider with multiple stores can report this while still showing sessions from its readable stores. |

`GET /api/connections` returns these states, the inspected paths, session counts, the latest recorded event time, English instructions and primary-source links. It contains no prompts, replies, tool arguments, credentials or configuration-file contents. `--private` removes source paths as well. The endpoint accepts GET only and shares the server's loopback host guard. It never changes a connection's configuration.

A log or database describes recorded activity. Nonterminal evidence older than two minutes becomes **Unknown**; copying or touching a historical file does not prove current activity. Explicit completed/error/interrupted events retain their terminal state. Only a separately configured, fresh reliable request feed can claim live presence. Dot has no reliable active-worker count unless such a source is actually available.

## Supported local stores

Paths below are relative to your home unless an environment override is set. Restart Bureau after changing environment variables.

| Connection | Default source | Override / notes |
| --- | --- | --- |
| Claude Code | `.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR`; child logs under session `subagents/` are discovered. |
| Codex CLI & Desktop | `.codex/sessions/YYYY/MM/DD/*.jsonl` | `CODEX_HOME`; the local desktop and CLI share these rollout logs. Cloud-only chats without local logs are not included. Resumed older date folders are scanned. |
| Gemini CLI | `.gemini/tmp/<project>/chats/session-*.jsonl` and legacy `.json` | `GEMINI_CLI_HOME` is a **home directory**, with `.gemini` appended by the CLI. The macOS sandbox fallback `.cache/.gemini` is also inspected. |
| Antigravity CLI | `.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` | `ANTIGRAVITY_HOME` |
| Antigravity App | `.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl` | `ANTIGRAVITY_APP_HOME` |
| Antigravity IDE | `.gemini/antigravity-ide/brain/<id>/.system_generated/logs/transcript.jsonl` | `ANTIGRAVITY_IDE_HOME`; binary/encrypted conversation stores without the documented transcript are not decoded. |
| GitHub Copilot CLI | `.copilot/session-state/<id>/events.jsonl` | Local CLI sessions; browser and editor-only chats without this store are not supported. |
| Hermes Agent | `.hermes/state.db` | `HERMES_HOME`; on Windows, `%LOCALAPPDATA%/hermes/state.db`. Default named profiles under `.hermes/profiles/<name>/state.db` are discovered. An explicit `HERMES_HOME` isolates the selected profile. |
| OpenCode | `.local/share/opencode/opencode.db` | `OPENCODE_DB` or `XDG_DATA_HOME`; legacy and current v2 table layouts are supported. |
| Oh My Pi | `.omp/agent/sessions/` and named profiles | `WMAD_OMP_SESSIONS_DIR`; existing OMP profile/XDG resolution is retained. |
| Pi | `.pi/agent/sessions/` | `PI_CODING_AGENT_SESSION_DIR` or `PI_CODING_AGENT_DIR` |
| Kimi Code | `.kimi-code/sessions/<project>/<id>/agents/<agent>/wire.jsonl` | `KIMI_CODE_HOME`; main and child agents retain distinct identities. |
| DeepSeek Harness | `.dsh/sessions/<project>/<id>/session[.vN].jsonl[.zstd]` | `DSH_HOME`; the highest recorded format version is selected. |
| Grok Build | `.grok/sessions/<project>/<id>/updates.jsonl` | `GROK_HOME` |

**DeepSeek is also a model provider.** A DeepSeek model running inside Hermes, OpenCode or another client appears under the client that actually owns its session; it is not counted again as a separate Harness agent.

**Hermes and OpenCode require `node:sqlite`.** Use Node.js 22.13 or newer with that built-in module. The packaged Linux AppImage bundles a compatible Node runtime. Database handles are opened read-only. Unsupported schemas report a connection problem instead of inventing sessions. Hermes `active=0` compaction archives do not replace the current message generation, and a compression predecessor does not by itself establish subagent identity. Named profile IDs are scoped in Bureau to prevent duplicate IDs from colliding; the original session ID is retained for resume.

**DeepSeek compression:** uncompressed logs need no additional tool. Compressed logs use native multi-frame Zstandard when available, otherwise the `zstd` executable. Whole-file replay is limited to 32 MB and throttled to once per five seconds. Partial writes retain the last readable state and retry; old evidence still expires normally. Oversized/undecodable logs are reported as unreadable, not live.

**Antigravity mirrors:** when App and IDE contain copies of the same conversation ID, Bureau shows one session selected by its recorded event time. The connection inventory assigns that observed session to its selected source. History/title metadata are read from that source's own home. File modification time cannot revive an old copied turn.

## Verified sources and limits

Source checks performed on 2026-11-27:

- [Google Antigravity hooks](https://antigravity.google/docs/hooks) documents separate App, CLI and IDE data directories and their shared transcript path. Existing synthetic parser fixtures plus discovery tests cover all three homes, mirrored conversations, new sessions and source-specific metadata. This is not a claim that every historical Antigravity binary store is supported.
- [Hermes session storage](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/session-storage.md) documents SQLite, profile isolation, workspace metadata, active compaction generations, message finish reasons and compression lineage. Fixtures cover readable/corrupt databases, errors, truncation, closed unfinished turns, named profile collisions and isolation.
- [DeepSeek Harness session storage](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/session) and [minimal SDK bundle](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/sdk-minimal) describe the durable session store. Existing fixtures cover approvals, explicit turn endings, child identity, log-format upgrades, partial writes, multi-frame compression and decode failures.
- [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Kimi Code](https://github.com/MoonshotAI/kimi-cli) and the existing repository parser fixtures establish the corresponding local adapters.

Fixture coverage is not a claim of real authenticated operation in every client. Bureau reads the local data those clients actually expose; a connected directory or installed executable alone is never evidence of an active agent. Remote machines, cloud-only sessions and an agent's private internal API require a supported explicit source rather than guessed process activity.
