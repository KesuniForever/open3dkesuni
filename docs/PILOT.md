# Pilot definition (fill in before building payments)

Status: TODO. Nothing here is decided until a person writes it down.

- Customer / orderer:
- Product: custom lamp side table with 3D-printed components
- Printed parts, quantity, deadline:
- Payee (who gets paid) and payee address:
- Acceptance rule (what "accepted" means, who signs off):
- Budget mandate (max spend):
- Partner printer (real? name?): none confirmed
- Network / token / test amount: Arc testnet, USDC, small amount
- Mainnet payment planned? undecided

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
