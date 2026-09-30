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

Not built or proven: LLM tool-calling loop, printer status, Circle/Arc transfer and on-chain
verification, hosted database for the live link, real order. See `docs/PILOT.md` and `docs/EVIDENCE_LABELS.md`.

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
