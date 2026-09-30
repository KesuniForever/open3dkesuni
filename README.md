# Kesuni 3D

Hackathon project for the Tameion Agents Hackathon (Sep 27 to Oct 10, 2026).

Kesuni 3D helps a small 3D-print business take an order, choose a production route
under a budget, record production and QC evidence, and pay the right party in USDC
(Circle on Arc) only when acceptance rules are met.

**Pilot:** one custom lamp side table with 3D-printed components (`JOB-001`).

## Status (honest)

Built and unit-tested (local, simulated data): policy engine, payment state machine,
order/quote/decision/evidence/acceptance/payment-intent API (`docs/API_CONTRACT.md`).

Not built or proven: LLM agent, printer status, Circle/Arc transfer and on-chain
verification, UI, real database, real order. See `docs/PILOT.md` and `docs/EVIDENCE_LABELS.md`.

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
npm run dev
npm test        # policy + flow tests
```

## Security

Never commit `.env*`, `~/.arc-canteen/wallet.yaml`, private keys, or RPC URLs that contain keys.
