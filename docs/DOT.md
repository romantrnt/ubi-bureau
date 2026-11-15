# Dot observations and local presence

[Home](../README.md)

Ubi Bureau 0.3 shows one **Dot** coordinator. Its triple-server mascot is an identity, not evidence of a running cloud task. It remains visible without a snapshot. Current Dot status is always **unknown** and the active-subagent count is **unavailable**, never zero or the size of an old worker list.

There is no supported continuous cloud Dot API connection in this release. The application does not poll private runtimes, recover hidden credentials, or infer current work from saved observations.

## Local sessions

Local stores are watched for new sessions and appended events. A recent lifecycle event can show thinking, tool execution, typing, or a request for attention. Each session carries its source and observation time. Local files do not prove that a process is still alive.

A nonterminal local observation older than **120 seconds** becomes unknown. Silence does not prove completion. Explicit completed, interrupted, and error events remain recorded outcomes. History stays accessible in the inspector and is excluded from the office scene. A fresh event can make a session current again. The separately supported local Magpie request feed has its own polling freshness and is identified as such; it does not provide live cloud Dot workers.

## Manual Dot snapshots

A valid snapshot adds the actual observation time and, when present, the last recorded `/root` status. Even a fresh snapshot does **not** establish current status. After 120 seconds it is also marked stale. Missing, malformed, or unavailable input leaves the single coordinator disconnected. Worker rows are not rendered as individual agents.

Never refresh an old snapshot's timestamp merely to keep its date current. Import only genuinely new observations with their actual observation time.

From a source checkout:

```sh
node bin/update-dot-snapshot.js < snapshot.json
```

The default file remains `~/.local/state/agent-office/dot-snapshot.json`, preserving compatibility. The importer validates the input and writes atomically with a private file mode. Keep the file out of Git and release archives.

Version 1 input remains supported, including worker rows from older exporters:

```json
{
  "version": 1,
  "observedAt": 1794750000000,
  "agents": [
    {"id": "/root", "title": "Example coordinator", "status": "idle", "parentId": null},
    {"id": "/root/example-worker", "title": "Example worker", "status": "completed", "parentId": "/root"}
  ]
}
```

This is dated illustrative data, not a current heartbeat. `observedAt` is Unix time in **milliseconds**. Allowed statuses are `running`, `completed`, `idle`, `error`, `interrupted`, and `waiting`. IDs must be unique strings of letters, numbers, `_`, `/`, or `-`, up to 160 characters. The bounded reader accepts at most 100 agents and 256 KiB, and rejects invalid or future timestamps more than five seconds ahead.

## Intentionally absent

Dot has no fabricated model, tokens, project path, prompts, replies, instructions, transcript, or resume command. `activeSubagents` is `null`; historical rows cannot establish this count. A future live integration requires an explicitly supported current source, appropriate permissions, and a freshness contract. Rewriting a snapshot repeatedly is not such an integration.
