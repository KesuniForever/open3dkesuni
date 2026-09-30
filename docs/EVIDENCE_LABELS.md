# Evidence labels

Every piece of evidence in the UI and README must carry exactly one label:

| Label | Meaning |
|---|---|
| `simulated` | Seed/mock data. Never counts as traction. |
| `real` | An order placed by a real customer. Only these count as traction. |
| `manual` | Entered by a human operator (e.g. printer status, QC result). |
| `local` | Ran on a local ledger/state only. No chain transaction. |
| `testnet` | Real transaction on Arc testnet (chain ID 5042002). |
| `mainnet` | Real transaction with real funds. |

A transaction hash proves a transaction, not lamp quality. "Print complete" is not "OK to pay".
