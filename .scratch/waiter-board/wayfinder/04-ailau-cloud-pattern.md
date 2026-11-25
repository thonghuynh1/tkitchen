# How aiLau's cloud extension dials out

Type: research
Status: resolved
Blocked by:

## Parent

[Waiter board](../map.md). Feeds [@waiter reaches the owner's machine](02-waiter-reaches-the-owner.md).

## Question

How does aiLau's `cloud` extension connect a machine to a Cloudflare Worker + Durable Object over `wss://`: the protocol and messages, authentication of the machine, reconnect and backoff, delivery guarantees (at-least-once, acks, dedupe), and what it does while offline? Cite `path:symbol`. aiLau is not cloned on the work laptop (`thonghuynh1/aiLau`; home `F:\MyWork\aiLau`).

## Slice when resolved

Feeds ticket 02: which parts of that pattern the board's connector reuses.

## Answer

- Source: `thonghuynh1/aiLau` main (`40d2f22`) has only plans; the actual extension is on `feature/init` (`a87a1a0`). The deployed Worker is in the separate private `HazAT/ultimate-fleet` repo, which was not inspected (`extensions/cloud/README.md:Cloud backups`).
- **The premise is not true of this revision:** the cloud extension backs up snapshots over HTTP(S), not a live `wss://` machine-to-DO mailbox. Its `wss://` setting is converted to HTTPS for requests; there are no cloud WebSocket messages or reconnect loop in the inspected extension (`lib/cloud.ts:httpBase`, `extensions/cloud/snapshot.ts:objectUrl`, `extensions/cloud/join.ts:cloudUrl`). Earlier versions or the private Worker may differ.
- Machine to Worker: `PUT|GET /sync/snapshots/<project-hash>/<snapshot-id>/<name>` for encrypted objects; `POST /sync/backups/<project-hash>/<id>` to register a completed snapshot; `GET /sync/register` to list projects and machines (`extensions/cloud/snapshot.ts:objectUrl`, `extensions/cloud/backup.ts:backUp`, `lib/cloud.ts:fetchRegister`). Project hash is SHA-256 of the project/chapter key.
- The POST body is `{ key, name, chapter: { name, number }, machine, parent, force?, createdAt, bytes, uploaded, tailnet? }`; success is HTTP 200; stale parent is 409 with `{ error, latest }`. The register is `{ projects, machines }` (`extensions/cloud/backup.ts:backUp`, `lib/cloud.ts:Register`, `extensions/cloud/README.md:Cloud backups`). These are HTTP shapes, not WebSocket messages.
- Auth: every sync request sends the shared `Authorization: Bearer <ULTIMATE_CLOUD_TOKEN>`; join checks the register before storing token, snapshot key, URL and machine in user secrets/settings (`extensions/cloud/join.ts:join`, `extensions/cloud/snapshot.ts:request`). The machine name is supplied metadata, defaulting to hostname, not a separate machine credential (`lib/cloud.ts:cloudConfig`). Server-side authorization details are unverified.
- Retry, not reconnect: snapshot PUT/GET retry network errors and 5xx at most twice, waiting 1s then 2s; other errors are final. The overall backup has a 10-minute cap. The commit POST has no general retry loop; a special 409 can trigger one retry (`extensions/cloud/snapshot.ts:request`, `extensions/cloud/server.ts:BACKUP_CAP`, `extensions/cloud/backup.ts:backUp`).
- Snapshot IDs combine time and random bytes; object PUT is write-once, and a 409 on a retried PUT is treated as success. A 409 naming this same snapshot acknowledges a previously accepted commit; a prior backup from the same machine on the recorded parent can be adopted before retrying once (`extensions/cloud/snapshot.ts:uploadSnapshot`, `extensions/cloud/snapshot.ts:request`, `extensions/cloud/backup.ts:backUp`). This is backup-specific retry handling, not exactly-once Trigger execution.
- Each home saves `{ key, parent, last }` in its chapter's `cloud-backup.json`; the parent check rejects a stale backup unless forced. Events are committed locally. Client comments say encrypted chunks and manifest are in private R2; the Worker register's storage and any DO use cannot be verified without its source (`extensions/cloud/backup.ts:BackupFile`, `extensions/cloud/server.ts:record`, `extensions/cloud/snapshot.ts:uploadSnapshot`).
- Offline: snapshot requests eventually fail and report the backup failure; no offline command/message queue or replay is present in this extension. Already uploaded chunks of a refused backup stay for Worker retention, but expiry/retention periods and server offline behavior are not visible (`extensions/cloud/server.ts:upload`, `extensions/cloud/backup.ts:backUp`, `extensions/cloud/README.md:Cloud backups`).
- Reuse limits: this is a personal shared-token, shared-encryption-key backup fleet; projects require a GitHub origin and machine names can collide. No member identity, card authorization, revocation, per-card routing or Trigger-delivery guarantee is established (`extensions/cloud/join.ts:join`, `lib/project-identity.ts:projectIdentity`, `extensions/cloud/backup.ts:backUp`). Design those for the board rather than assuming this extension supplies them.
