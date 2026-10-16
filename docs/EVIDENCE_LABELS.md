# Evidence labels

Every piece of evidence in the UI and README must carry exactly one label:

| Label | Meaning |
|---|---|
| `simulated` | Seed/mock data. Never counts as traction. |
| `real` | An order placed by a real customer. Only these count as traction. |
| `manual` | Entered by a human operator (e.g. QC result). |
| `device` | Read automatically from a machine, e.g. the Bambu A1 over LAN (unofficial API). Says what the machine reported, not that the part is good. |
| `local` | Ran on a local ledger/state only. No chain transaction. |
| `testnet` | Real transaction on Arc testnet (chain ID 5042002). |
| `mainnet` | Real transaction with real funds. |

A transaction hash proves a transaction, not lamp quality. "Print complete" is not "OK to pay".

Orders from the public customer form start `real`. A practice order (a judge's or the team's) is marked `simulated` on
the operator order page (`POST /api/orders/:id/label`, with the person's name in the decision log). Not while the
escrow holds money or a transfer is in progress (it counts until its release or refund), never with an escrow on
mainnet, and on mainnet not while the customer can still pay; a demo practice order or one marked printed for testing
never becomes `real`.
