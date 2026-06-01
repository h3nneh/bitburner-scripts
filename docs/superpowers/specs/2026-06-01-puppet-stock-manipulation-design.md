# Puppet Stock Manipulation + Darkweb Stock/Share/Induce Modes

Date: 2026-06-01
Status: Approved (design), pending implementation plan

## Problem

`puppet.js` (the default SphyxOS-ported saturation batcher) is a pure-money,
single-target HWGW batcher. Its runtime-generated workers call
`ns.hack/grow/weaken` with **no** `{ stock: true }` option, so it never
manipulates stock prices. In BitNodes with a stock market (especially BN8,
where stocks are the money engine), this leaves the manipulation lever unused.

SphyxOS itself never manipulated via the batcher either — it traded forecasts
(`tStocks.js`) and additionally used a darkweb action `ns.dnet.promoteStock(sym)`
inside its darknet controller. The local `darknet-worker.js` cracks darkweb
servers but has no stock-promotion / share / induce modes.

## Goal

1. Add an **optional, flag-gated stock-manipulation phase** to `puppet.js`:
   grow servers whose stock we hold **long**, hack servers whose stock we hold
   **short**, with `{ stock: true }`.
2. Port SphyxOS darkweb **stock / share / induce** modes into
   `darknet-worker.js` (no React UI, no telemetry, no port-IPC).
3. Keep all new behavior **off by default**; let `daemon.js` / `autopilot.js`
   enable it where sensible (e.g. BN8).

Non-goals: replacing `stockmaster.js`; embedding a trader in puppet; porting the
full 6993-line SphyxOS `darknet.jsx` controller (UI/telemetry/port-IPC).

## Key Decision: coordination file, not port-IPC

`stockmaster.js` is the only script that already pays `ns.stock.*` RAM. It
remains the single owner of stock-API access and **writes** a coordination file.
`puppet.js` and `darknet-worker.js` only **read** it (`ns.read`), so they pay no
stock-API RAM. Chosen over port-IPC for simplicity, durability across restarts,
and inspectability.

### Coordination file: `/Temp/stock-positions.txt`

Written by `stockmaster.js` each trading tick. JSON dict keyed by symbol:

```json
{
  "ECP":  { "server": "ecorp",      "position": "long",  "shares": 12000, "forecast": 0.62 },
  "SLRS": { "server": "solaris",    "position": "short", "shares": 4000,  "forecast": 0.39 },
  "FNS":  { "server": "foodnstuff", "position": "none",  "shares": 0,     "forecast": 0.51 }
}
```

- `server`: hostname owned by the symbol's organization (lowercased hostname).
- `position`: `"long"` if `sharesLong > 0`, `"short"` if `sharesShort > 0`, else `"none"`.
- `shares`: net shares held in the active position direction.
- `forecast`: current probability (for tie-break / leverage sorting).
- File also carries a top-level `lastUpdate` timestamp (ms) for staleness checks,
  e.g. stored as `{ "lastUpdate": 1730000000000, "positions": { ... } }`.

## Components

### 1. `stockmaster.js` — position writer (new, ~30 lines)

- **Symbol→Server map** built once at startup: for each symbol, resolve owning
  organization via `ns.stock.getOrganization(sym)` (RAM-dodged through a temp
  script per existing helper patterns) and match it to the server whose
  `organizationName` equals that org. Cache the map to `/Temp/stock-symbol-servers.txt`.
- Each trading tick, after position bookkeeping, serialize the current positions
  (using the in-memory stock objects: `sharesLong`, `sharesShort`, forecast/prob)
  to `/Temp/stock-positions.txt` with `jsonReplacer`.
- On liquidation / shutdown, write an empty positions dict so consumers stop
  manipulating immediately.

### 2. `puppet.js` — manipulation phase (new, flag-gated)

New flags (defaults in **bold**):

- `--stock-manipulation` (**false**): master enable for the phase.
- `--stock-manip-ram-frac` (**0.1**): fraction of total available manipulation
  RAM to reserve for the manipulation phase each cycle.

Behavior when enabled:

1. Read `/Temp/stock-positions.txt`. If missing or `lastUpdate` older than 30s,
   skip the phase entirely (normal money batch uses 100% RAM).
2. Build manipulation targets from positions with `position != "none"` whose
   `server` is rooted/hackable. Sort by leverage (shares × |forecast−0.5|, tie
   on forecast).
3. Reserve `floor(availableThreads × stock-manip-ram-frac)` threads. Allocate
   them across targets:
   - **long** server → pure `grow(server, { stock: true })` threads.
   - **short** server → pure `hack(server, { stock: true })` threads.
4. Remaining RAM continues into puppet's normal money-saturation salvo, unchanged.

Worker change: the runtime-generated `puppet-hack.js` / `puppet-grow.js` gain a
third arg `stock` (boolean), so the body becomes
`await ns.hack(ns.args[0], { additionalMsec: ns.args[1], stock: ns.args[2] })`
(and the equivalent for grow). `puppet-weaken.js` is unchanged (weaken does not
affect stock price). Existing call sites pass `false` to preserve current
behavior; the manipulation phase passes `true`.

This is an isolated `manipulateStocks(ns, ...)` function gated behind the flag;
when the flag is off, `puppet.js` behaves exactly as today.

### 3. `darknet-worker.js` — new modes (flag-gated, ported from SphyxOS)

New flags (defaults in **bold**):

- `--enable-stock` (**false**): when the darkweb session has idle (unblocked)
  RAM, call `ns.dnet.promoteStock(sym)` for each symbol held **long** per the
  coordination file.
- `--enable-share` (**false**): call `ns.dnet.share` when idle.
- `--enable-induce` (**false**): pick the best migration target and call
  `ns.dnet.induceServerMigration(target)` when idle (SphyxOS logic, minus the
  React UI / telemetry / port-IPC).

Modes run only when `ns.dnet.getBlockedRam(self) === 0` (idle), mirroring
SphyxOS's gating. Each mode is its own small function; absent `ns.dnet`
capability or coordination file, the mode is a no-op.

### 4. Activation wiring (`daemon.js` / `autopilot.js`)

- All new flags default off. Manual `run` keeps current behavior.
- `daemon.js` adds the flags to `puppet.js` / `darknet-worker.js` launch args
  where sensible — at minimum BN8 gets `--stock-manipulation` on puppet and
  `--enable-stock` on darknet. Exact non-BN8 policy decided in the plan.
- Per-flag overrides remain available via config files.

## Data Flow

```
stockmaster.js (owns ns.stock.*)
   └─ writes /Temp/stock-symbol-servers.txt  (once)
   └─ writes /Temp/stock-positions.txt       (each tick)
          │
          ├─→ puppet.js (--stock-manipulation): grow long-servers / hack short-servers with {stock:true}
          └─→ darknet-worker.js (--enable-stock): ns.dnet.promoteStock(long symbols)
```

## Error Handling

- Coordination file missing or stale (`lastUpdate` > 30s) → manipulation/promotion
  skipped; money batching and darkweb cracking proceed normally.
- No held position for a symbol → no manipulation threads; RAM returns to the
  money batch.
- `ns.dnet` unavailable or stock API not yet purchased → modes stay silently off.
- Server in positions file not yet rooted → skipped as a manipulation target.

## Testing

No in-repo runtime (scripts run inside Bitburner). Verification:

- `node --check` on every modified file (syntax).
- Static review that off-by-default flags leave existing code paths unchanged.
- In-game smoke test in BN8: confirm `/Temp/stock-positions.txt` appears and
  updates; puppet tail logs show manipulation threads against held-position
  servers; darknet logs show `promoteStock` calls; observe forecast movement on
  manipulated symbols.

## RAM Considerations

- `puppet.js` adds no new `ns.*` references beyond `ns.read` (already used) and
  the existing `ns.hack` / `ns.grow` (the `{ stock: true }` option is free).
- `darknet-worker.js` adds `ns.dnet.promoteStock` / `ns.dnet.share` /
  `ns.dnet.induceServerMigration` references (only loaded on the darkweb session
  host, which is dedicated).
- `stockmaster.js` adds `ns.stock.getOrganization` (RAM-dodged via temp script)
  and `ns.write` (already paid). Net RAM cost concentrated in stockmaster, which
  already owns stock-API RAM.

## Out of Scope

- Replacing `stockmaster.js` trading logic.
- Full SphyxOS `darknet.jsx` controller (UI, telemetry, port-IPC, stasis-link
  management beyond what cracking already needs).
- Looping-mode interaction with manipulation (puppet looping mode is disabled).
