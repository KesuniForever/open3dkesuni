# Pilot (Padang, October 2026)

Status: running since 15 Oct 2026. Customers are described, never named, in this repo.

- **Customers:** three small businesses in Padang, Indonesia: an accessories shop (50 lighter cases), a graphic
  designer (modular lamps) and a boarding-house owner who also sells accessories. They order through the customer
  portal (`/customer`) or Kesuni enters the order for them.
- **Products:** small batches in PLA or PETG, printed on Kesuni's three Bambu Lab A1 Combo printers. No partner printer
  yet: the three printers stand in for partner studios.
- **Price:** by weight from the slicer (`KESUNI_PRICE_PER_GRAM_IDR`, default Rp1.500 per gram, unit price rounded up to
  Rp500), inside the owner's rules in code (minimum order, approval limit, minimum margin; `.env.example`).
- **Budget mandate:** the customer's budget in rupiah, held as USDC at `IDR_PER_USDC` (default 16.500). The policy
  engine refuses a plan above it; the customer can raise it on their page to exactly Kesuni's price.
- **Payee:** Kesuni (`KESUNI_PAYOUT_ADDRESS`, a wallet on Arc Testnet).
- **Acceptance:** the customer accepts on their own order page after ticking that they checked size, colour, finish and
  function. Only then does code release the escrow, through the policy engine. A rejection refunds it.
- **Network and money:** Arc Testnet, test USDC, not customer money. Payment to Kesuni is in rupiah, outside the app; Kesuni's demo-funds wallet tops
  up the customer's order wallet with test USDC, which then goes into the escrow. The top-up is never counted.
- **Snapshot** (17 Oct 2026, about 02:00 WIB): 4 real orders from 3 customers, 2 escrow deposits verified on Arc, no
  release or refund on a real order yet. Live numbers: `/live`.
- **Mainnet:** not planned before legal advice (see below).

## Switching to mainnet (later; needs approval)

Today everything runs on **Arc Testnet** with test USDC. No real money moves. Wallets, escrow, release, refund and
labels switch to Arc mainnet by configuration. Customer payment on mainnet still needs code: there is no way yet for
a customer to fund their wallet or see its deposit address (see "Not built yet" below). Mainnet moves real money, so
it needs the **owner's and Sabina's approval** first.

Env vars to change (in `.env.local`, never committed):

- `CIRCLE_BLOCKCHAIN=ARC` (Circle's name for Arc mainnet; testnet is `ARC-TESTNET`).
- `KESUNI_ALLOW_MAINNET=1`: the safety switch. Without it the app refuses to create wallets or send USDC on a
  mainnet chain, even if `CIRCLE_BLOCKCHAIN=ARC` is set.
- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`: a mainnet (live) API key, its entity secret,
  and a new wallet set created on mainnet. Testnet keys and wallets do not work on mainnet.
- `KESUNI_USDC_ADDRESS`: USDC's contract address on Arc mainnet.
- `KESUNI_EXPLORER_TX_URL`: the Arc mainnet explorer's transaction URL (ending in `/tx/`).
- `KESUNI_ARC_RPC_URL` and `KESUNI_ARC_CHAIN_ID`: Arc mainnet RPC and chain id for the read-only receipt check and the
  health card. Without both, the check says "not configured" on mainnet (it never guesses).
- `CIRCLE_API_KEY` must be a `LIVE_API_KEY…` on mainnet: the app refuses a LIVE key without `KESUNI_ALLOW_MAINNET=1`,
  and a TEST key on a mainnet chain.
- `KESUNI_PAYOUT_ADDRESS`: Kesuni's mainnet payout wallet.
- `KESUNI_DEMO_FUNDS_ADDRESS`: not used on mainnet (test top-ups are testnet only).

Verify first:

- Circle mainnet account is approved, with the mainnet API key, entity secret and a new wallet set.
- Gas Station / billing is set up on mainnet (SCA wallets need it to pay gas).
- The USDC address on Arc mainnet (from Arc's or Circle's docs). The code default is the testnet address.
- The explorer URL. The built-in mainnet default (`https://explorer.arc.io/tx/`) is a guess and is not verified.
- One small transfer end to end with Kesuni's own money before any customer pays.
- Not built yet: on mainnet a customer's wallet must already hold USDC; there is no way in the app to fund it.
  The customer page says so instead of sending test USDC.
- Legal: in Indonesia, goods must be paid in Rupiah (Law No. 7/2011 on Currency). Get legal advice before taking
  real USDC as payment from customers in Indonesia.

After switching, the app labels escrows and the customer page as mainnet ("USDC sungguhan"). Orders paid on
testnet keep their testnet label and explorer links.
