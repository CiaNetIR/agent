# tunnel — Cloudflare Tunnel for panel.cianet.ir

Cloud-managed Cloudflare Tunnel that exposes the owner's panel
(Next.js on localhost:3000 behind the Caddy gateway on **localhost:81**)
at **https://panel.cianet.ir** — outbound-only connector, no public IP,
no inbound ports. This directory is fully self-contained and never touches
the watcher, dev server, Caddy or `src/`.

## Files

| file | role |
|---|---|
| `bin/cloudflared` | connector binary (linux-amd64, GitHub latest) |
| `provision.sh` | one-shot provisioner (arg: Cloudflare API token). Zone lookup → tunnel `cianet-panel` create/reuse → ingress `panel.cianet.ir → http://localhost:81` (fallback 404) → proxied CNAME `<tunnel-id>.cfargotunnel.com` → persists everything to `.secrets/cloudflare/`. **Never writes the API token anywhere.** |
| `tunnel-run.sh` | foreground `cloudflared tunnel run --token <file> --metrics 127.0.0.1:20241` |
| `supervisor.sh` | keep-alive wrapper (setsid daemon, backoff 2→60 s, `supervisor.pid`, `service.log`) |
| `tunnel_ctl.sh` | `start \| stop \| restart \| status` (start no-ops gracefully while no token exists) |
| `provision-watcher.sh` | 10 s auto-provisioner loop (flock `/tmp/tunnel-pw.lock`, heartbeat `watcher.heartbeat`) |
| `restore-tunnel.sh` | post-reset self-healing: re-download binary + restart watcher/connector |
| `package.json` | `npm run dev` → `tunnel_ctl.sh start` |

Secrets live in `/home/z/my-project/.secrets/cloudflare/` (dir 700, files 600):
`tunnel-id.txt`, `tunnel-token.txt`, `account-id.txt`, `zone-id.txt`,
`credentials.json`, `config.yml` (local-managed fallback), `provisioned.json`,
and the transient `api-token.txt` / `fail-count` handled by the watcher.

## Activation flow (what happens when)

1. Owner creates a Cloudflare API token (steps below) and pastes it in chat.
2. A future agent writes it to `/home/z/my-project/.secrets/cloudflare/api-token.txt`.
3. `provision-watcher.sh` picks it up within 10 s → runs `provision.sh`
   (output captured to `provision.log`).
4. On success: token file consumed, connector started, owner gets the
   Telegram success alert via sendq (see below), and
   https://panel.cianet.ir goes live.
5. On failure: `fail-count` increments; after **3** consecutive failures the
   token is moved to `api-token.invalid`, the owner gets one invalid-token
   alert, and the counter resets.

## Owner: how to create the API token

۱) برو به https://dash.cloudflare.com/profile/apiTokens → **Create Token** → **Custom token**.
۲) دسترسی‌ها: **Account → Cloudflare Tunnel → Edit** و **Zone → DNS → Edit** و **Zone → Zone → Read**.
۳) Zone Resources: **Include → Specific zone → cianet.ir**.
۴) **Continue → Create Token** و توکن ساخته‌شده رو همین‌جا در چت بفرست.

## Notifications rule

Alerts are delivered ONLY as sendq JSON files (never a second Telegram
client): `/home/z/tg-tools/watcher/sendq/sq-<epochms>-tunnel.json`
with schema `{"chat":"me","text":"..."}` — exact copy of the monitor's
schema; the running watcher process drains the queue.

## After a sandbox reset

```bash
bash /home/z/my-project/mini-services/tunnel/restore-tunnel.sh
```

Re-downloads the binary if missing, restarts the provision-watcher and the
connector. The tunnel configuration and DNS record persist in Cloudflare's
cloud; if `tunnel-token.txt` survived in `.secrets`, the connector just
reconnects — otherwise drop a fresh `api-token.txt` and the watcher
re-provisions from scratch.
