# Dot observations: snapshots, not a live feed

[Home](../README.md)

The office has two distinct sources:

- **LOCAL:** statuses derived from actual local agent stores.
- **DOT:** an explicitly supplied, dated observation of Dot workers.

This release has **no supported continuous cloud Dot API connection**. It does not poll private cloud runtimes, recover hidden credentials or infer current work from old observations. A snapshot is not a heartbeat.

## Freshness

A valid snapshot displays its observation time. After **120 seconds**, its agents become `unknown`, shown as “Нет свежих данных” in the current UI. An unavailable or invalid file is disconnected. A completed worker in a stale file is still stale; the app does not pretend to know what happened afterwards.

Never refresh an old snapshot's timestamp merely to keep the display green. Import only genuinely new observations, using their actual observation time.

## Import

From a source checkout:

```sh
node bin/update-dot-snapshot.js < snapshot.json
```

The current default file is `~/.local/state/agent-office/dot-snapshot.json`. The updater writes atomically and uses a private file mode. Keep this file out of Git and release archives.

Schema, illustrated with deliberately stale synthetic data:

```json
{
  "version": 1,
  "observedAt": 0,
  "agents": [
    {
      "id": "/root",
      "title": "Example coordinator",
      "status": "idle",
      "parentId": null
    },
    {
      "id": "/root/example-worker",
      "title": "Example worker",
      "status": "completed",
      "parentId": "/root"
    }
  ]
}
```

`observedAt` is Unix time in **milliseconds**, not seconds. The `0` above is an example, not a command to claim freshness. Allowed statuses are `running`, `completed`, `idle`, `error`, `interrupted` and `waiting`. IDs must be unique strings using letters, numbers, `_`, `/` or `-`, up to 160 characters. The reader accepts at most 100 agents and a 256 KiB input file, rejects invalid timestamps and future observations more than five seconds ahead, and bounds displayed titles.

## Data intentionally absent

Dot rows do not invent or export model names, token usage, project paths, prompts, replies, private instructions or conversation transcripts. They have no local resume command. The parent/worker relationship comes only from supplied observation metadata, not from a claim that the local app can enumerate cloud workers itself.

A future live integration would require an explicitly supported source and a separate review of permissions, freshness and data minimization. It should not be implemented by disguising repeatedly rewritten snapshots as live telemetry.
