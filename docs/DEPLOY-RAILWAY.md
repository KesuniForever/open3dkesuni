# Deploying Open3DKesuni on Railway

One long-running Node server (`next start`) on Railway, with the SQLite database and the uploaded files on a
Railway **volume**. The printer bridge stays on the studio PC. The owners keep a step-by-step guide in Indonesian outside
this repo (in their notes folder, `catatan/panduan-railway.md`).

| Runs on Railway | Stays on the studio PC |
|---|---|
| The web app (operator pages, customer pages `/c/<token>`, order form `/request/<code>`) | `scripts/printer-bridge.mjs` (only the LAN reaches the printers) |
| The Chief's heartbeat timer and daily review (inside the server process) | `.env.local` with the printer IPs and access codes |
| SQLite database `/data/kesuni.db`, uploaded files `/data/files` (volume) | The old local database, kept as a frozen backup |

## Build: Dockerfile (why not Railpack or railway.json)

Railway builds the root `Dockerfile` automatically. It is the most reliable option here:

- **Exact Node version** (`node:24.19.0-bookworm-slim`, the same as the studio PC). The app needs `node:sqlite`
  without a flag and Node's TypeScript type stripping (used by the start script and the bridge). Railpack would pick
  a Node version from the `engines` range on its own.
- **Same image every time**, buildable and runnable anywhere with Docker.
- **Config as code (`railway.json` / `railway.toml`) is deprecated**: new services cannot opt in, existing files stop
  working on 2026-12-01. Its replacement (`.railway/railway.ts`) needs the Railway CLI. So the two settings that do
  not fit in a Dockerfile (the volume, optionally the healthcheck path) are set once in the dashboard.

What the image does:

| Step | Command |
|---|---|
| Build | `npm ci`, `npm run build` (Next.js + TypeScript check), `npm prune --omit=dev` |
| Start | `node scripts/railway-start.mjs` (same as `npm start`) which runs `next start` in-process |
| Port | Railway sets `PORT`; set `PORT=3000` as a variable so the domain's port is always 3000 |

No variable is needed at build time and none is baked into the image (`.dockerignore` keeps `.env*`, `data/`,
keys and wallet files out).

Checked on 15 Oct 2026 in a copy of the repo (not in the dev folder): `npm ci`, `npm run build` (exit 0, all routes
compiled, type check passed), `npm prune --omit=dev`, then `node scripts/railway-start.mjs` served on `PORT=3999`.
Turbopack prints three warnings about dynamic file access in `src/lib/files.ts`; they only matter for
`output: "standalone"`, which this image does not use.

## Volume and the start guard

Attach one volume to the service, **mount path `/data`**. Railway then sets `RAILWAY_VOLUME_MOUNT_PATH`, and the
start script fills in:

- `KESUNI_DB_PATH=/data/kesuni.db`
- `KESUNI_FILES_DIR=/data/files`

Leave both variables unset on Railway (or point them inside `/data`). On Railway the start script **refuses to
start** when no volume is attached or when either path is off the volume, with the reason in the deploy log. That
way no real order is ever written to the container disk, which is wiped on every deploy. `KESUNI_ALLOW_NO_VOLUME=1`
overrides this, for a throwaway demo copy only. Locally the script changes nothing.

Railway facts that follow from the volume: one replica only, and a short downtime on every redeploy (Railway stops
the old deployment before the new one mounts the volume). Volume backups are in the volume's settings (Backups).

## Variables (names only; values are typed into Railway's Variables tab, never into chat)

The fastest way: Variables, Raw Editor, paste the studio PC's `.env.local`, then delete the lines listed under
"not on the server". `GET /api/admin/status` (below) lists what is still missing.

**Required**

| Name | Why |
|---|---|
| `OPERATOR_PASSWORD` | Operator pages on a public host need it (Basic auth, any user name). Without it they answer 403. |
| `PRINTER_BRIDGE_TOKEN` | Same value as on the studio PC; `/api/printers/report` answers 503 without it. |
| `CUSTOMER_INVITE_CODE` | The order form link `/request/<code>`. |
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | Circle wallets and escrow (test key on Arc Testnet). |
| `KESUNI_PAYOUT_ADDRESS` | Kesuni's payout wallet. |
| `PORT` | Set to `3000`. |

**Recommended**: `ANTHROPIC_API_KEY` (the Chief on Claude; costs money, without it the rules fallback runs),
`KESUNI_DEMO_FUNDS_ADDRESS` (test USDC top-ups, testnet only).

**Optional (have defaults)**: `CIRCLE_BLOCKCHAIN` (ARC-TESTNET), `KESUNI_HEARTBEAT_SECONDS` (120; 0 = off),
`KESUNI_DAILY_REVIEW_HOUR` (21, Jakarta time; `off`), `KESUNI_AGENT_MODE`, `KESUNI_AGENT_MODEL`,
`KESUNI_MAX_WAKES_PER_HOUR`, `IDR_PER_USDC`, `DEMO_VIDEO_URL` (the landing page's video; unset hides it),
`KESUNI_WHATSAPP` (the studio's WhatsApp, digits like 62812…, for the customers' Chat button; unset hides it, so set it
for the pilot),
`KESUNI_PRICE_PER_GRAM_IDR`, `KESUNI_COST_PER_GRAM_IDR`,
`KESUNI_PRICE_PER_GRAM_IDR_PETG`, `KESUNI_COST_PER_GRAM_IDR_PETG` (PLA numbers),
`KESUNI_PRICE_ROUND_IDR`, `KESUNI_PRINT_MIN_PER_GRAM_SINGLE` (3-5), `KESUNI_PRINT_MIN_PER_GRAM_MULTI` (5-15),
`KESUNI_HANDLING_HOURS` (1), `KESUNI_PRINTER_COUNT` (3), `KESUNI_MIN_ORDER_IDR`,
`KESUNI_PARTNER_MIN_IDR`, `KESUNI_OWNER_APPROVAL_ABOVE_IDR`, `KESUNI_MIN_MARGIN_PCT`, `KESUNI_PARTNER_MARGIN_PCT`,
`KESUNI_EXPLORER_TX_URL`, `KESUNI_USDC_ADDRESS`, `KESUNI_ARC_RPC_URL`, `KESUNI_ARC_CHAIN_ID`, `KESUNI_DB_PATH`,
`KESUNI_FILES_DIR`. `KESUNI_GRAMS_PER_HOUR` is retired (the print time now comes from minutes per gram and the colour
mode); nothing reads it any more, and the deploy check warns while it is still set, so delete it.

**Keep unset**: `KESUNI_ALLOW_MAINNET` (real money; needs the owner's and Sabina's approval, see `docs/PILOT.md`),
`KESUNI_ALLOW_NO_VOLUME`.

**Not on the server** (printer bridge only): `APP_URL`, `PRINTER_IP`, `PRINTER_SERIAL`, `PRINTER_ACCESS_CODE`,
`PRINTER_2_*`, `PRINTER_3_*` ...

The full list lives in `src/lib/deploy.ts` (`ENV_VARS`); a test fails when the code reads a variable that is not
listed there. The deploy check also names pasted secrets the app never reads (for example a wallet key from
`.env.local`), so they can be deleted from the server.

## The Chief's heartbeat on Railway

`src/instrumentation.ts` runs `register()` once when the server starts, also under `next start` in production, and it
starts the heartbeat timer (`src/lib/agent/heartbeat.ts`): first beat 20 s after start, then every
`KESUNI_HEARTBEAT_SECONDS`. Checked in the production test run: `GET /api/heartbeat` reported
`schedulerRunning: true`.

- Keep `KESUNI_HEARTBEAT_SECONDS=0` until the data import is done, so the Chief does not spend Claude credits on the
  demo order of an empty server. Then delete the variable (Railway redeploys).
- **Only one place may run the Chief.** After the move, do not run the app on the studio PC with the same keys
  (or set `KESUNI_HEARTBEAT_SECONDS=0` in its `.env.local`): two heartbeats would pay Claude twice and act on two
  different copies of the orders.

## Who can open what (src/proxy.ts)

On a public host every page and API needs `OPERATOR_PASSWORD` (Basic auth). Open without it: `/c/<token>` and
`/api/c/...` (customer), `/request/<code>` (order form), `GET /api/studio/colors` (the loaded spool colours for the
customer's colour picker: type, colour and name only), the printer bridge's own routes, which check
`PRINTER_BRIDGE_TOKEN` themselves (`/api/printers/report`, `/api/printers/queue`, `/api/printers/queue/<id>`,
`/api/print-jobs/<id>/file`, `POST /api/printers/<id>/camera`), and `/favicon.ico`. The admin routes below check the
password themselves as well, also from the home network.

Printer controls, print starts and cancels and the camera picture (`POST /api/printers/<id>/command`,
`POST /api/print-jobs[/<id>]`, `GET /api/printers/<id>/camera`) need the password from every device except the
studio PC itself (`localhost`), including phones on the studio Wi-Fi. Set `OPERATOR_PASSWORD` in `.env.local` too if
a phone at the printer should start or stop prints.

Optional healthcheck: service Settings, Deploy, Healthcheck Path `/favicon.ico` (the only path that answers 200
without a login; it proves the server is listening). With a volume it does not prevent the short redeploy downtime.

## Printer bridge

The bridge keeps running on the studio PC and posts to every address in `APP_URL` (comma separated):

```
APP_URL=https://<your-app>.up.railway.app
```

(`http://localhost:3000,https://<your-app>.up.railway.app` while both run.) `PRINTER_BRIDGE_TOKEN` must be identical
on the PC and on Railway. Plain `http://` is refused for anything but the studio PC and the studio network. Restart
the bridge after changing `.env.local`.

**Who may control the printers.** Status goes to every `APP_URL`, but controls and print jobs come from ONE app:
by default the first `APP_URL` on the studio PC or the studio network (`http://localhost:3000`). Each app has its own
database, so two control apps could each think a printer is free. To let the Railway app start and stop prints
instead, name it, and the bridge says so loudly at start:

```
CONTROL_APP_URL=https://<your-app>.up.railway.app
```

Anyone with Railway's `OPERATOR_PASSWORD` can then run the physical printers from the internet: choose a strong one.
`BRIDGE_CONTROL=off` (or `node scripts/printer-bridge.mjs --read-only`) takes no commands at all.
`node scripts/printer-bridge.mjs --dry-run` does everything except publish to the printers and upload to their SD
cards, prints the exact messages, and logs to `logs/printer-bridge-dry-run.log`.

## Moving the existing data (once)

The studio PC's database (orders, escrows, decisions, Chief logs, settings) and its uploaded files are copied into
the volume once:

```
node scripts/railway-import-db.mjs https://<your-app>.up.railway.app --check   # checks only, sends nothing
node scripts/railway-import-db.mjs https://<your-app>.up.railway.app           # asks, then uploads
```

1. The script makes a consistent snapshot with `VACUUM INTO` into a temp file (the local database is only read),
   checks it, and asks for the operator password (hidden; or `OPERATOR_PASSWORD` in the environment).
2. `GET /api/admin/import-db` tells whether the server is still fresh.
3. `POST /api/admin/import-db` receives the snapshot (gzip, with its size and SHA-256 in headers).
4. `POST /api/admin/import-file?key=<storageKey>` receives each attachment file.

Safety rules on the server (`src/lib/deploy-import.ts`, tested in `src/lib/deploy-import.test.ts`):

- Works only when `OPERATOR_PASSWORD` is set **and** the request carries Basic auth with it.
- Only a **fresh** server takes an import: no non-simulated order, no escrow, no payment intent, no attachment.
  (A new volume always has the seeded demo order, so "zero orders" never happens; the demo order is replaced.) After
  one import the server holds real data and every further import is refused (409). If a server was used before the
  import by mistake, the only reset is deleting and re-adding the volume, which is a deliberate step in the dashboard.
- The upload must be an intact SQLite file (header, `PRAGMA integrity_check`), have the app's core tables, no views or
  triggers, and the same tables and columns as the server. Size and SHA-256 must match (Next.js cuts request bodies
  over 60 MB, `proxyClientMaxBodySize`, without failing the request).
- The rows are copied in one SQLite transaction (`BEGIN IMMEDIATE`, checked again under the lock) through a second
  connection, so the server's open connection keeps working and sees the new rows at once. Nothing is replaced
  on disk, so there is no half-written database.
- An attachment file is written only for an attachment the database knows, with exactly its recorded size, and never
  over an existing file.

Checked end to end on 15 Oct 2026 against the production build on the dev PC (temp database, no keys): check mode,
upload, the file copied byte for byte, and a second run refused.

## After a deploy: the deploy check

Open `https://<your-app>.up.railway.app/api/admin/status` (log in with the operator password). It shows the storage
paths and the volume, variable names that are set or missing (never values), real vs simulated order counts, whether
the import is still possible, and the heartbeat. `ok: true` means storage and required variables are in place.

## Circle on Railway

No ISP DNS block on Railway, so no WARP is needed. The Circle API key and entity secret are Railway variables. If the
Circle API key has an IP allowlist, Railway's outgoing address must be on it (fixed outgoing IPs are a paid Railway
feature) or the allowlist must be off.

## Known limits

- Request bodies over 60 MB are cut by Next.js (`experimental.proxyClientMaxBodySize` in `next.config.ts`, kept
  equal to `BODY_LIMIT_MB` in `src/lib/deploy.ts`). Design files up to 50 MB upload fine. The import script sends
  the database and each file up to 58 MB packed; a database above that stops the script before anything is sent.
- Customer links change domain: `/c/<token>` keeps the same token on the new address, so resend the links.
- Expected start-up warnings in the log: `ExperimentalWarning: SQLite is an experimental feature` and
  `MODULE_TYPELESS_PACKAGE_JSON` (Node loading `src/lib/deploy.ts` for the start guard).
