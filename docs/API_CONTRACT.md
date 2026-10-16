# API contract

Types live in `src/lib/types.ts` and are the source of truth. Money is **integer
micro-USDC** (6 decimals): 30 USDC = `30000000`. Errors return `{ error, reasons? }`.
Data is stored in SQLite (`src/lib/store.ts`, file `data/local/kesuni.db`, git-ignored). Orders are labelled `real` or `simulated`.

| Method & path | Body | Result |
|---|---|---|
| `GET /api/orders` | none | `{ orders }` |
| `POST /api/orders` | `{ product, quantity, deadline: "YYYY-MM-DD", designVersion, label: "real"\|"simulated", customerName?, budgetIdr: "50.000" \| budgetUsdc: "32.5" (exactly one), material?: "PLA"\|"PETG", preferredColors?: [{ type, color: "#RRGGBB" }] }` | 201 `{ order }`, or 400 with reasons (budget, material, colours not loaded in the studio now). Rupiah typed is kept as `budgetIdr` with the app rate `rateIdrPerUsdc` (`IDR_PER_USDC`, default 16.500) and `mandateMicro = round(budgetIdr × 1e6 / rate)`; USDC typed keeps the mandate exactly and stores `budgetIdr = USDC × rate`. The server always uses its own rate |
| `GET /api/orders/:id` | none | order + vendors, quotes, decisions, evidence, acceptance, agentLog, paymentIntents |
| `POST /api/orders/:id/quotes` | `{ vendorId, priceUsdc: "30", etaHours }` (or `priceMicro`) | 201 `{ quote }`. Only while order is `CREATED` |
| `POST /api/orders/:id/decision` | `{ quoteId, decidedBy: "agent"\|"human", reason }` | 200 `{ order }`, or **422** with policy reasons |
| `POST /api/orders/:id/evidence` | `{ kind: "log"\|"photo"\|"qc", note, label }` | 201 `{ evidence }` |
| `POST /api/orders/:id/acceptance` | `{ accepted, by, note }` (human only) | 200 `{ acceptance, order }` |
| `POST /api/orders/:id/agent-plan` | none | 200 `{ result, log }`: runs the Chief Kesuni Officer on the order (Claude, or the rule-based planner in rules mode). `result` = `{ mode, outcome: "done"\|"fallback"\|"busy"\|"error", summary, turns }`; `log` lists every tool call |
| `POST /api/orders/:id/price-by-weight` | `{ gramsPerUnit, source, colorMode?, etaHours? }` (operator; `colorMode` is `"single"` by default or `"multi"`: it sets the ETA, not the price; always recorded `by: "human"`, `by: "agent"` is refused) | 201 `{ quote, price, gramPricing }`: Kesuni's own quote at grams × Rp1.500, unit price rounded up to Rp500. Only while `CREATED` |
| `POST /api/orders/:id/messages` | `{ text, by?: "human" }` | 200 `{ message }`: a short update on the customer's page. **422** for links, wallet addresses, phone numbers, emails or a repeat of the last message. Only the Chief writes as `agent` (its own tool, max one per 10 min) |
| `POST /api/orders/:id/slicer-grams` | `{ gramsPerUnit, source, by, colorMode? }` (operator; no agent tool; the Chief prices with this colour mode) | 200 `{ order }`: grams per unit from the slicer, the only grams the Chief may price with (`price_by_weight` refuses others). Wakes the Chief. Only while `CREATED` |
| `POST /api/orders/:id/owner-approval` | `{ quoteId?, by, note }` (owner only; no agent tool) | 200 `{ order }`: lifts the owner's own rule (minimum or approval limit) for this quote at its current price; a new or re-priced quote needs a new approval. Without `quoteId`, the only quote the owner can approve. Closes the order's open questions (`needs_info`) and wakes the Chief. Only while `CREATED` |
| `POST /api/orders/:id/payment-intent` | `{ recipient, amountMicro, idempotencyKey }` | 201 `{ intent, replayed:false }`, replay 200 `replayed:true`, or **422** |

| `GET /api/orders/:id/escrow` | none | Asks Circle once about pending transfers, then `{ escrow }` |
| `POST /api/orders/:id/escrow` | `{ action: "open" \| "topup" \| "deposit" \| "release" \| "refund" }` | `{ ok, escrow }` (+ `intent` on release), or **422** with policy reasons |
| `POST /api/reset` | none | Resets the `simulated` demo order. `real` orders are never touched |

### The Chief (operator only; `src/proxy.ts` guards everything except `/c`, `/api/c`, `/pesan` and the printer bridge)

| Method & path | Body | Result |
|---|---|---|
| `GET /api/settings/agent` | none | `{ mode: "claude"\|"rules", model, profile: "test"\|"demo"\|null, source: "setting"\|"env"\|"default", hasApiKey }` (never the key) |
| `POST /api/settings/agent` | `{ profile: "test"\|"demo" }` | Same as GET. Test = `claude-sonnet-5-5` (testing, debugging), Demo = `claude-opus-5-5` (demo, recording). 400 for anything else |
| `GET /api/heartbeat` | none | `{ last, intervalSeconds, enabled, schedulerRunning, nextRunAt, running, mode }`. `last` = the last beat's `{ at, trigger, mode, findings, woke, actions, errors, durationMs }` |
| `POST /api/heartbeat` | none | Runs one beat now ("run now" button), then the same as GET. **409** while a beat is running |
| `GET /api/daily-review` | none | `{ reviews }`, newest day first |
| `GET /api/daily-review?day=YYYY-MM-DD` | none | `{ review }`, 404 if that day has none, 400 for a bad date |
| `POST /api/daily-review` | `{ day?: "YYYY-MM-DD" }` (default today, Jakarta time) | `{ review }`: written now; replaces that day's review. 400 for a bad or future day, **409** while one is being written |
| `POST /api/arc/verify` | `{ txHash, from, to, amountUsdc }` | `{ check, explorerUrl }`: checks any USDC transfer on Arc, saves nothing. `check.status` = `verified` (+ `logId` = `chainId:txHash:logIndex`, `logIndex`, `blockNumber`) \| `mismatch` \| `not_found` (+ `reason`). **400** bad input, **502** RPC unreachable |
| `POST /api/arc/verify` | `{ orderId, idempotencyKey }` | Re-checks one stored escrow transfer (COMPLETE, with hash) and saves a definite result on it as `verified`; `{ check, saved, explorerUrl }`. 404 unknown tx, 409 not checkable |
| `GET /api/health/chain` | none (`?fresh=1` skips the ~60 s cache) | Always 200: `{ at, network, arc: { status: "ok"\|"stale"\|"wrong_chain"\|"bad_token"\|"unreachable"\|"not_configured", chainId, expectedChainId, blockNumber, blockAgeSec, usdcDecimals, reason? }, circle: { status: "ok"\|"unreachable"\|"not_configured", walletSet, wallet: { address (shortened), blockchain, state, usdc } \| null, reason? }, cached }`. Never returns the RPC URL or a key |
| `GET /api/traction` | none | Real usage for the submission (`src/lib/traction.ts`, read-only): `{ computedAt, rule, realCustomers, realOrders, realOrdersByStatus, arcTxs: { count, byKind: { deposit, release, refund }, verifiedOnArc, mismatchOnArc, notCheckedYet, volume: { testnet: { micro, usdc }, mainnet: { micro, usdc } }, last: [{ orderId, kind, amountMicro, amountUsdc, network, networkLabel, txHash, explorerUrl, verifiedOnArc: true\|false\|null, at }] }, excluded: { simulatedOrders, demoTopups } }`. Counts only `real` orders; a transfer counts when it is a deposit, release or refund, `COMPLETE`, with an Arc tx hash. Simulated orders, demo top-ups (`customer_topup` from the demo-funds wallet) and internal transfers are not counted. Volume is the sum of those transfers per network (a deposit and its release are two transfers). Customers are counted by name (the same name twice = one customer), never returned. Same numbers as the "Real usage" card on `/` |

`review` = `{ day, facts, text, mode: "claude" | "template", model, at, trigger: "schedule" | "button", error?, usage? }`.
`facts` are counted by code (`dailyFacts` in `src/lib/agent/daily-review.ts`): orders, plans (agent vs human), agreements,
escrow money (real and simulated orders apart, each labelled with its network: testnet = test USDC), operator tasks, the
Chief's activity (runs, heartbeat wake-ups, decisions, escalations, policy refusals, customer messages), deadlines, printers,
reputation and logged Claude tokens. No customer names, phones or addresses. `text` has five sections in simple English
("Summary", "What went well", "Risks & things to watch", "Chief's advice", "Needs your decision"); Claude writes
it with no tools from the facts only, or a code template does (rules mode, Claude error or refusal: `error` says why).

## The Chief's heartbeat and daily review
Every `KESUNI_HEARTBEAT_SECONDS` (default 120) cheap code checks look at active orders, payments and printers. Code
handles what it can for free (sync a pending payment, open an operator task); Claude is woken only for a new problem that
needs a decision (max 3 orders per beat) and never again for the same unchanged problem. When Claude is unavailable (no
credits, overloaded), the problem is not counted as handled: it is tried again after 30 minutes. Background wake-ups
(new order, payment, owner approval) are capped at `KESUNI_MAX_WAKES_PER_HOUR` (default 20); the order form allows 5
orders per network address per hour. Last in a beat, once per Jakarta day after `KESUNI_DAILY_REVIEW_HOUR` (default 21
WIB), it writes the daily review; a button review made earlier that day is replaced, and a missing review of yesterday
is caught up on the next beat. Page: `/review`.

## Arc receipt check (`src/lib/arc-verify.ts`, read-only)
Circle reports a transfer COMPLETE; this asks Arc itself over JSON-RPC (viem): the receipt's status is success, its block
is canonical, and it holds **exactly one** USDC `Transfer` log (token = `network().usdcAddress`) from the tx's sender to its
recipient for exactly `amountMicro` (ERC-20 USDC on Arc has 6 decimals). The result is stored on the `ChainTx` as
`verified: { ok, at, logId?, reason?, internal? }` (`internal` = a `customer_topup` from the demo-funds wallet, not a customer
payment). It never changes escrow state, never blocks a release or refund and holds no key. The heartbeat checks up to 5
COMPLETE, unchecked transfers per beat (code, no Claude): a mismatch opens one `needs_info` operator task and an
`arc_verify` log entry; an RPC outage, or a hash the RPC does not know yet, is retried on a later beat (a hash still
unknown an hour after the transfer is reported). Shown as "verified on Arc" on the operator escrow panel and `/arc`, and as
"Terverifikasi di Arc" on the customer page.
- `KESUNI_ARC_RPC_URL`: Arc RPC (may contain an API key; never logged or returned). Default `https://rpc.testnet.arc.io`.
- `KESUNI_ARC_CHAIN_ID`: expected chain id. Default 5042002 (Arc Testnet). On a mainnet chain both must be set, or
  the check reports "not configured" instead of guessing.

The Circle gateway refuses an API key from the wrong environment before any client is made: a `LIVE_API_KEY…` needs
`KESUNI_ALLOW_MAINNET=1` and a mainnet chain; a `TEST_API_KEY…` cannot be used on a mainnet chain.

## Order files (operator; `src/lib/files.ts`)
Design files for the slicer, reference images and QC photos. Bytes are stored under the file id (never the uploaded
name) and never go to the Chief, which only sees file names and kinds. A QC photo is also photo evidence on the order
(the customer sees it). The Chief has no tool to add or remove a file.

| Method & path | Body | Result |
|---|---|---|
| `GET /api/orders/:id/files` | none | `{ attachments }` |
| `POST /api/orders/:id/files` | multipart: `file`, `kind: "design"\|"reference"\|"qc_photo"`, `by` (≤ 50 MB) | 201 `{ attachment, evidence }` (`evidence` for a QC photo, else `null`); 400 with reasons |
| `GET /api/files/:fileId` | none | The bytes: images inline, design files as a download |
| `DELETE /api/orders/:id/files/:fileId` | `{ by }` (JSON; a person's name) | 200 `{ attachment, evidenceRemoved, bytesRemoved }`: the file is off the order (and, for a QC photo, its photo evidence), written in one transaction with the `remove_file` log row (actor `human`, output `{ evidenceRemoved, storageKey }`). The stored bytes are then deleted when possible: `bytesRemoved: false` means they stayed, and a second, failed `remove_file` row names the `storageKey`. 400 "Expected { by }" for a body that is not JSON, 400 no name (or not a person's), 404 unknown order or file (or a file of another order), **409** with `reasons` while a print job holds the file (queued, uploading or sent; printing only while that print is on an online printer: cancel or stop it first), or for a QC photo once the order is `EVIDENCE_SUBMITTED` or later |

## Customer page (`/c/<token>`, open: the token is the secret)
| Method & path | Body | Result |
|---|---|---|
| `POST /api/c` | `{ invite, name, product, quantity, deadline, budgetIdr, note, material?: "PLA"\|"PETG", colors?: [{ type, color }] }` | The invite order form (`/request/<code>`). Colours must be loaded in the studio now (one material, at most 4); names are stored in English. 201 `{ order }`; 429 after 5 orders per address or 20 in total per hour |
| `GET /api/studio/colors` | none (open) | `{ colors: [{ type, color, name, checked }], at }`: the PLA/PETG colours loaded in the studio's AMS now (no printers or slots). `checked` = an RFID spool or a person confirmed it |
| `GET /api/c/:token` | none | The customer's view (`CustomerView` in `src/lib/customer.ts`), no wallet ids, vendor addresses or agent log. `overTolerance: true` when the operator's measured `maxDeviationMm` is above the agreed `spec.toleranceMm`. `choice: { material, colors, canChange, materialLocked }`. `design` (the customer's own STL/OBJ, else `null`): `{ name, bytes, sizeMm, state: "weighing"\|"weighed"\|"check", gramsPerPiece, printMinutesPerPiece, material, colourName, colourHex, estimate: { unitIdr, totalIdr, usdc } \| null, priced }`: the estimate is `priceByWeight` for the order's material and quantity until a quote is chosen; never cost, margin, printer, tray, slicer settings or file ids. `canAddDesign` |
| `GET /api/c/:token/design` | none | The customer's own design file (uploaded as `Customer (order form)`, kind `design`, STL/OBJ ≤ 25 MB) for the 3D view: `application/octet-stream`, `nosniff`, `private, max-age=3600`, `attachment`. Never a sliced `.gcode.3mf` or a file a person added (404). 429 after 30 per address per hour |
| `POST /api/c/:token/design` | multipart: `design` (STL or OBJ, one piece, ≤ 25 MB) | "Add your design" while the order is `CREATED` without a quote, without grams per unit and without any design yet, the customer's own or one a person added (else **409**). Same checks and limits as the order form's design (tries and designs per address, 2 received at once until stored, content check), then stored, weighed automatically and the Chief woken like a design sent with the order. 201 `{ ok, design: { stored, weighing } }`; 400/403/404/413/429/503; 500 when the file could not be stored |
| `POST /api/c/:token` | `{ action: "colors", material: "PLA"\|"PETG"\|null, colors: [{ type, color }] }` | While the order is `CREATED`: the customer changes material and colours (material locked once a quote exists). Logged as `customer_colors`; does not wake the Chief |
| `POST /api/c/:token` | `{ action: "agree", by }` \| `{ action: "pay", agree?: true, by? }` | Approve the price and spec; pay into escrow (testnet: test USDC first) |
| `POST /api/c/:token` | `{ action: "accept", by, note, checked: true }` | Accept the goods. `checked` must be exactly `true` (the customer ticked "Saya sudah memeriksa ukuran, warna, finishing, dan fungsi barang yang saya terima."), else **400**. Above the tolerance the page warns but accepting is allowed: the acceptance note gets "[Diterima walau selisih ukuran X mm melebihi batas ±Y mm]" and the `customer_decision` log entry `acceptedOverTolerance: { maxDeviationMm, toleranceMm }`. Then code releases the escrow through the policy (`checkRelease`, unchanged). `{ ok, settled, reasons? }` |
| `POST /api/c/:token` | `{ action: "reject", by, note }` | Reject (no tick needed); code refunds through the policy. `{ ok, settled, reasons? }` |
| `POST /api/c/:token` | `{ action: "review", quality, communication, value, text, by }` | The customer's review after payout |

## Printing from the website (people, and agent prints in code; the LAN bridge carries it out)
Operator routes (`src/proxy.ts`): from any device but the studio PC itself they need `OPERATOR_PASSWORD`, also on the
studio Wi-Fi (also `POST /api/printers/:id/bed`, the "Bed is empty" that lets the agent print, the switch and an order's
runs). Marking a task done, the colour check and `clear_bed` stay open on the studio Wi-Fi: none of them lets the agent print.
Bridge routes check `Authorization: Bearer PRINTER_BRIDGE_TOKEN` (503 unset, 401 wrong). The Chief has no route or tool
here: it can read printer status, never control a printer (agent prints are code: see "Agent prints" below).

| Method & path | Who | Body | Result |
|---|---|---|---|
| `POST /api/printers/:id/command` | person | `{ kind: "pause"\|"resume"\|"stop"\|"speed"\|"light"\|"camera_snapshot"\|"get_version", params?, by, confirm? }`. `speed {level: 1..4}`, `light {on}`, `resume {fixed?: true}` (needed after a fault pause). `confirm: true` for pause, resume, stop | 201 `{ command }`; 400 name/confirm/kind, 404, 409 with `reasons` (printer state), 429 one control per 3 s per printer (camera frames and firmware checks do not count; Stop is never held back) |
| `GET /api/printers/:id/command` | operator | none | `{ commands }`, the last 20 |
| `POST /api/printers/:id` | person | `{ action: "link", orderId }` \| `"unlink"` \| `{ action: "clear_bed", by }` \| `{ action: "confirm_colors", by }` | `{ printer, dispatch? }`. `clear_bed` needs a person's name (400 otherwise), is logged (`clear_bed`) and only frees the bed: no `bedCheck`, so never an agent print (the order page's button). `confirm_colors` runs the dispatcher: `dispatch: { on, started[], sliced[] }` |
| `POST /api/printers/:id/bed` | person | `{ by, confirm: true }` | `{ printer, granted, dispatch: { on, started[], sliced[] } }`: "Bed is empty" on My machines (a dialog: the print is off, the plate on, clean and empty). Frees the bed and records `printer.bedCheck`, good for ONE agent print for 2 h (not while an agent print uses the last one: `granted: false`); logged (`clear_bed`); runs the dispatcher. 400 name or confirm; password from other devices |
| `GET /api/printers` | operator | none | `{ printers, autoPrint }`: the dispatcher's read-only plan (`on`; per printer `why`, `next`, `bed`, `jobOnItsWay`; per order `why`, `action`, runs), or null |
| `POST /api/tasks/:id` | person | `{ by }` | `{ task, dispatch }`: the printer's latest collect-and-QC or reprint task frees its bed (an older one frees nothing), never a `bedCheck`; runs the dispatcher (a closed reprint or "agent print did not start" task can free an order) |
| `POST /api/print-jobs` | person | `{ orderId?, printerId, attachmentId, plate, amsMapping, options?, by, bedEmptyConfirmed: true, personPresent: true, warningsChecked?, urlForm?: "sdcard"\|"ftp" }` | 201 `{ job, warnings, match }`; 409 `{ error, reasons, warnings, match }` |
| `GET /api/print-jobs?orderId=` / `?printerId=` | operator | none | `{ jobs }`, newest first |
| `POST /api/print-jobs/:id` | person | `{ action: "cancel", by }` | `{ job }`: while queued or uploading (the bridge then sends nothing) |
| `GET /api/printers/:id/camera` | operator | none | `image/jpeg`, header `x-frame-at`; 404 none yet |
| `GET /api/printers/queue?printers=a1,a1-2` | bridge | none | `{ commands, jobs, now }`. A job carries `fileUrl`, `md5`, `size`, `urlForm`, `sendBy`, `actor` (`"person"`\|`"agent"`) and, for an agent print, `bedConfirmedBy` and `expectedTrays` (`[{ tray, type, color }]`: the bridge sends nothing once a mapped tray holds another spool) |
| `POST /api/printers/queue/:id` | bridge | `{ state, error?, result?, md5? }` | Forward moves only; taking an item (queued → sent / uploading) works once. A job's `sent` is refused (409, job failed) more than 10 min after the person confirmed the bed, or when a print ended on that printer since; an agent print's also when agent prints were turned off, its bed confirmation is no longer the printer's (voided or replaced), or a spool changed since it was queued (colours no longer confirmed, or a mapped tray holds another material or colour). A failed agent print raises one task (key `autoprint:failed:<job>`) |
| `GET /api/print-jobs/:id/file` | bridge | none | The 3MF (`x-file-md5`), while queued or uploading |
| `POST /api/printers/:id/camera` | bridge | `image/jpeg` ≤ 2 MB | 201 `{ at, size }` |
| `POST /api/printers/report` | bridge | `{ printerId, snapshot, events }` | Status, AMS, faults; moves the print job (sent → printing → done / failed / cancelled); times each print's start and end (when the bridge missed an end, or never saw the print running: IDLE → FINISH, or a new job name while FINISH/FAILED, the app raises the `finished`/`failed` event itself and the bed counts as full), voids an unused bed confirmation, also after more than 2 min without a report since it was given; then runs the dispatcher |

Stale requests never fire later: a command not taken in 60 s expires; a job not taken in 5 min fails; a job stuck
uploading 30 min, or sent but never seen on the printer for 15 min, fails. The bridge takes commands from one app
(`CONTROL_APP_URL`, default the studio's own app) and checks everything again against its live view of the printer.

## Agent prints (`src/lib/printer/dispatch.ts`, `autoprint.ts`; code, never Claude)
A person turns "Agent may start prints" on (Chief page; meta `autoPrint`, OFF when missing; `KESUNI_AUTO_PRINT=off` forces it
off). Then the dispatcher (deterministic code, no Claude call) takes the orders in PLAN_CHOSEN or IN_PRODUCTION by earliest
deadline and either asks the studio PC for ONE slice (the order's newest design file, only an STL/OBJ, in the order's single
colour, standard quality, the spec's infill, supports auto; never asked again after the model failed or a person cancelled it;
a failure of the studio PC or a cancel by the switch is retried, at most 3 tries) or starts the order's sliced A1 file on the
best printer.
`createAgentPrintJob` (`src/lib/printer/jobs.ts`) re-checks every gate inside one write transaction (`BEGIN IMMEDIATE`), and two
UNIQUE indexes on `print_jobs` (one job per `bedCheckId`, one agent job on its way per printer) are the second guard. Gates,
each alone blocks a start:
- the switch is on;
- bed: a person's "Bed is empty" on My machines (`POST /api/printers/:id/bed`; `Printer.bedCheck`, a person's name) given
  after the last print started and ended, unused, at most 2 h old. The agent's print or a person's own uses it up; any print
  that starts or ends first voids it, also one the app never saw running, and so do more than 2 min without a report after
  it was given. A task marked done or the order page's "Bed is empty" never gives one;
- printer: reported in the last minute, IDLE or FINISH (after a failed print a person starts the next one), no job on its way,
  one start a minute, no fault and no warning HMS, SD card in and fine, AMS reported, colours confirmed by a person since the
  spools changed, not linked to another order;
- order: a real order is paid (escrow FUNDED); any other order only after a person set its runs; runs left
  (`Order.autoPrint.runsNeeded`, default 1 for a real order; each finished print of the order counts one: its done print jobs,
  or its collect tasks from a printer if more, so a print made outside the website counts; one at a time, and a printer linked
  to the order that is printing counts as a run on its way); no open reprint task and no open "agent print did not start" task;
- file: only a `.gcode.3mf` the studio PC sliced from the order's NEWEST design file, an STL or OBJ, with the studio's presets
  (a done `SliceJob` with `mode: "mesh"` links it). Never a sliced file someone uploaded and never a 3MF project sliced with
  its own settings (nobody reviewed that G-code: a person prints those). For the Bambu Lab A1, 0.4 mm, textured PEI plate, one
  plate, in the order's material and colours;
- pairing: a spool of the same material within the colour limit for every filament, of the file AND of the order's colour,
  and `canStartPrint` as the agent with no reason and no warning. The bridge checks the same again (`actor: "agent"`,
  `bedConfirmedBy`, `expectedTrays`) and takes agent prints only with `BRIDGE_AGENT_PRINTS=on` on the studio PC.

The dispatcher runs after "Bed is empty", a task done, every printer report, a colour check, a slice arriving,
the switch turned on, an order's runs set, each heartbeat (before any Claude wake: with the switch on, a paid order waiting
for a printer no longer wakes Claude) and the Chief's `request_dispatch` (orderId only: it cannot change a gate or the order
of the queue). A missing spool raises ONE `change_filament` task "Load <material> <colour> (<hex>) in an AMS" (key
`autoprint:load:<type>:<hex>`), closed by code once it is loaded. Log rows (actor agent): `auto_print` (a start, with the person
whose bed confirmation it used), `slice_request`, `auto_print_wait` (an order's reason, only when it changes),
`request_dispatch`; a person's (actor human): `auto_print_switch` (filed under `studio`), `auto_print_runs`, `clear_bed`.

| Method & path | Who | Body | Result |
|---|---|---|---|
| `GET /api/auto-print` | operator | none | `{ on, by, at, locked, plan, feed }`: the switch, the dispatcher's read-only plan, the last decisions |
| `POST /api/auto-print` | person | `{ on, by, confirm: true }` (`on`: true or false) | `{ on, by, at, cancelled, dispatch }`; 400 name/confirm/on, 409 `KESUNI_AUTO_PRINT=off`. Off cancels the agent's prints and slices that have not reached a printer and closes its spool tasks; on runs the dispatcher |
| `POST /api/orders/:id/auto-print` | person | `{ runsNeeded: 0..50, by }` | `{ order, autoPrint, started, sliced }`; 400, 404. 0 = the agent never prints it |
| `GET /api/orders/:id` | operator | none | also `autoPrint: { on, runsSet, line }`: this order's runs and why it waits |

## Slicing on the website (`src/lib/slicing.ts`; the studio PC slices through the LAN bridge)
An order's STL/OBJ (or an unsliced Bambu Studio 3MF set up for the A1 0.4 mm with one filament, which keeps its own
settings) becomes a printable A1 `.gcode.3mf` in ONE colour: the material and colour of the AMS spool picked. Bambu
Studio's command line runs on the studio PC (`scripts/bridge/slicer.mjs`: argument array, fresh temp folder, flattened
system profiles, 10 min timeout, 50 MB in and out), never on the app's server. STEP is refused ("export an STL").
The sliced file becomes a design file on the order (`uploadedBy: "Bambu Studio (slicer)"`); "Colours & print" prints it
like any sliced file, its AMS mapping preset to the picked spool. Nothing here prints or reaches a printer. Library:
`requestSlice({ orderId, attachmentId, printerId, tray, quality?, infillPct?, supports?, by, actor?: "person"|"agent", why? })`;
`actor: "agent"` (code only, never a route) needs the `autoPrint` switch on, an order in PLAN_CHOSEN or IN_PRODUCTION,
a reporting printer and a person's colour check.

| Method & path | Who | Body | Result |
|---|---|---|---|
| `POST /api/slice-jobs` | person | `{ orderId, attachmentId, printerId, tray (ams*4 + slot, 0-based), quality?: "standard"\|"fine"\|"draft", infillPct?: 0..100 (default the spec's, else 20), supports?: "auto"\|"off", by }` | 201 `{ job, warnings, reused: null }`; 200 `{ job, warnings, reused: "active"\|"done" }` for the same source and settings already waiting or sliced; 400 name/settings/file (`reasons`), 404, 409 slot empty or not PLA/PETG, order status; 429 more than 3 waiting per order (10 in all) |
| `GET /api/slice-jobs?orderId=` | operator | none | `{ jobs, slicer: { seenAt, ready } }`, newest first; `ready` = the studio PC asked for slices in the last 2 min |
| `GET /api/slice-jobs/:id` | operator | none | `{ job }` |
| `POST /api/slice-jobs/:id` | person | `{ action: "cancel", by }` | `{ job }`: while queued or slicing (the studio PC's result is then refused) |
| `GET /api/slicer/queue` | bridge | none | `{ slices, now }`: queued slices, oldest first, each with `sourceUrl`, `resultUrl`, `sourceName`, `size`, `mode`, `material`, `color`, `quality`, `infillPct`, `supports` |
| `POST /api/slicer/queue/:id` | bridge | `{ state: "slicing"\|"alive"\|"failed", error?, kind?: "studio"\|"model" }` | Taking (queued → slicing) works once; `alive` (every 45 s while the studio PC works on it) keeps a slice running; `failed` with a short English reason and why (`kind`, stored as `failKind`; missing = the model) |
| `GET /api/slicer/jobs/:id/source` | bridge | none | The model (`x-file-md5`), only while slicing |
| `POST /api/slicer/jobs/:id/result` | bridge | the `.gcode.3mf` (`model/3mf`, ≤ 50 MB), headers `x-file-md5`, `x-slice-ms` | 201 `{ job, attachment }`; 400 checksum, 409 not slicing (cancelled: the file stays on the order), 415, 413, **422** the file is not sliced for the A1 0.4 mm / textured PEI plate / one filament of the asked material and colour (the slice fails) |

A slice is a `SliceJob` (`src/lib/types.ts`): `queued → slicing → done | failed`, or `cancelled` by a person. Stale ones
fail: not taken in 15 min, or 3 min without `alive` while slicing (a bridge closed mid-slice). `failKind`: `model` (the
slicer refused the model, a wrong or too large output, a timeout), `studio` (not taken, went quiet, download/upload, no Bambu
Studio), `person` (cancelled on the order page), `switch` (agent prints turned off). The 413 for a too large result fails the
slice at once. The same source and settings never wait twice (UNIQUE index on the key); a finished one is reused. Before an
unsliced 3MF project reaches Bambu Studio the bridge refuses one that unpacks to more than 500 MB, runs a post-processing
script, or uses printer settings other than "Bambu Lab A1 0.4 nozzle"; the output must name that preset too. A model named
like a Windows device (`nul.stl`, `COM1.obj`) is written as `model_<name>`. `node scripts/printer-bridge.mjs --slice-only
--once` slices at most one waiting slice and exits, contacting no printer (no MQTT, no FTPS, no print queue). Log rows: `slice_request` (actor human or agent), `slice_result`
(ok with file, grams, minutes, price; or the reason), `slice_cancel`. The bridge (`scripts/bridge/slice-runner.mjs`)
takes slices only from the control app, one at a time; `BAMBU_STUDIO_PATH`, `BAMBU_PROFILES_DIR`, `BRIDGE_SLICER=off`.

## Order status flow
`CREATED → PLAN_CHOSEN → IN_PRODUCTION → EVIDENCE_SUBMITTED → ACCEPTED | REJECTED`, then `ACCEPTED → PAID`
when the escrow release is `COMPLETE` on Arc.

## Escrow (`src/lib/escrow.ts`, Circle developer-controlled SCA wallets on Arc)
`AWAITING_DEPOSIT → FUNDED → RELEASED | REFUNDED`
- `open`: needs a chosen quote. Creates a customer wallet and a per-order escrow wallet. Amount = quote price.
- `topup` (testnet only): Kesuni's demo-funds wallet sends test USDC to the customer wallet.
- `deposit`: customer wallet → escrow wallet.
- `release`: policy `checkRelease` (customer accepted, QC evidence, escrow funded with at least the amount, recipient = the
  approved vendor's real address, never a placeholder, nothing released before), then creates/reuses the payment intent and
  sends escrow → vendor. Intent goes `SUBMITTED → CONFIRMED` with the tx hash.
- `refund`: policy `checkRefund` (customer rejected), escrow → customer.
- Every transfer saves a UUID idempotency key before calling Circle. A lost call stays `NOT_SUBMITTED` and the next
  sync retries with the same key, so Circle never executes it twice. SCA wallets have gas paid by Circle Gas Station,
  so an escrow can hold exactly the order amount.

## Who may change what
- **decision**: agent or human. Policy engine checks budget, approved vendor, order match.
- **evidence**: operator (manual) or, later, a printer bridge. Always carries a `label`.
- **acceptance**: human only. Never derived from model output.
- **payment-intent**: allowed only when accepted, QC evidence exists, recipient equals the
  approved vendor address, amount equals the accepted quote and is within mandate, and no
  other intent exists for the order. Same `idempotencyKey` returns the original intent.

## Payment states
`ALLOCATED → PAYMENT_INTENT_CREATED → SUBMITTED → CONFIRMED`, with `UNKNOWN` and
`PARTIALLY_PAID` (`src/lib/payment-state.ts`). On `UNKNOWN`, check the original transaction
before any retry.

## Agent tools (`src/lib/agent/tools.ts`)
The Chief (Claude) gets `get_order`, `get_quotes`, `get_available_budget`, `check_vendor_policy`, `choose_plan`,
`request_human_decision`, `estimate_cost` (a check only), `price_by_weight`, `get_production_status`, `choose_printer`,
`request_dispatch` (asks the agent-print dispatcher to look now; orderId only, no gate or order to pick),
`create_operator_task` and `message_customer`. It never gets a payment tool: `propose_payment` (and
`price_with_calculator`) exist for code and tests only; money moves only through the policy-gated escrow code. The agent
never sees the customer's name, phone, address or email. Writes go through `src/lib/actions.ts`, the same code the HTTP
routes use, so an agent cannot bypass policy. Every call is stored in `agentLog` (returned by `GET /api/orders/:id`).

## Not built yet
Circle webhooks, vendor
management, and hosted storage for the live link. Customer payment on mainnet: a customer cannot fund their wallet or
see its deposit address in the app (on testnet Kesuni sends test USDC).
