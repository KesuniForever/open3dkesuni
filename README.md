# Kesuni 3D

Hackathon project for the Tameion Agents Hackathon (Sep 27 to Oct 10, 2026).

Kesuni 3D helps a small 3D-print business take an order, choose a production route
under a budget, record production and QC evidence, and pay the right party in USDC
(Circle on Arc) only when acceptance rules are met.

**Pilot:** one custom lamp side table with 3D-printed components (`JOB-001`).

## Status (honest)

Built and unit-tested (local, simulated data): policy engine, payment state machine,
order/quote/decision/evidence/acceptance/payment-intent API (`docs/API_CONTRACT.md`),
seven agent tools with a decision log, a rule-based planner standing in for the LLM,
a basic UI (create orders, add quotes, walk the whole flow), and SQLite storage
(`data/local/kesuni.db`, git-ignored) so data survives restarts.

Built and tested on Arc testnet (4 Oct 2026): per-order USDC escrow through Circle developer-controlled
wallets (customer pays into escrow, release to Kesuni only after the customer accepts and the policy engine
approves, refund on rejection). Unit tests use a fake Circle; `RUN_ARC_E2E=1 npx vitest run src/lib/escrow.e2e.test.ts`
runs the real flow. One-time setup: `node scripts/circle-setup.mjs` (see `.env.example`).

Built, tested with simulated reports (not yet on the real printer): a read-only Bambu A1 LAN bridge
(`node scripts/printer-bridge.mjs`, MQTT) that posts printer status to the app; the agent turns it into
`device` evidence and operator tasks (change filament, collect + QC). Field names match `bambulabs_api`.

Not built or proven: LLM tool-calling loop, bridge on the real A1, independent on-chain verification of releases,
hosted database for the live link, real order. See `docs/PILOT.md` and `docs/EVIDENCE_LABELS.md`.

## Design rules

- The LLM compares options and calls allowed tools. It never computes or sends money.
- A deterministic policy engine locks budget, vendor, recipient, amount, token/decimals,
  acceptance prerequisite, and idempotency.
- Agent writes use the same validation as the human UI.
- Payment state: `ALLOCATED, PAYMENT_INTENT_CREATED, SUBMITTED, CONFIRMED, UNKNOWN, PARTIALLY_PAID`.
  On `UNKNOWN`, check the original transaction before any retry.

## Run

```bash
npm install
cp .env.example .env.local   # fill in; never commit
npm run dev     # open http://localhost:3000, then click the order
npm test        # policy + flow + storage tests
```

Node 24 prints `ExperimentalWarning: SQLite is an experimental feature`. That is expected: storage uses Node's built-in `node:sqlite`.

## Security

Never commit `.env*`, `~/.arc-canteen/wallet.yaml`, private keys, or RPC URLs that contain keys.
