# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

These are scripts for the browser game **Bitburner**. They run *inside the game*, not via Node.js or any standard runtime. There is no build system, no package manager, and no test suite. The game executes `.js` (and `.ts`) files directly in its NetscriptJS sandbox.

## Deploying to the game

Scripts are downloaded into the game via `git-pull.js`. From the in-game terminal:

```
run git-pull.js
```

To push local edits to remote game servers (servers other than `home`), run `sync-scripts.js` inside the game.

## Script structure

Every script that the game can run must export a `main` function:

```js
export async function main(ns) { ... }
```

`ns` is the Netscript API object injected by the game. Every NS API call has a RAM cost; the game refuses to run scripts that declare more RAM than available.

### Standard patterns

**Argument parsing** — use `argsSchema` + `getConfiguration` from `helpers.js`:

```js
const argsSchema = [
    ['some-flag', false],   // [name, default] — trailing comment becomes --help text
    ['some-value', 10],
];
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // --help was shown or args were invalid
}
```

Config file overrides: create `script-name.js.config.txt` with a JSON dict to change defaults without editing source.

**Tab-completion** — export `autocomplete(data, args)` alongside `main`.

**RAM-efficient NS access** — many NS functions cost RAM just by being referenced. Use `getNsDataThroughFile` / `getNsDataThroughFile_Custom` from `helpers.js` to run expensive queries in disposable temp scripts (written to `/Temp/`). Pass a custom `fnRun` (e.g. `getFnRunViaNsExec`) to avoid paying the `ns.run` RAM cost if you already reference `ns.exec`.

## Architecture

```
autopilot.js          ← top-level orchestrator; manages the full game loop
  └─ daemon.js        ← hacking engine; schedules batch HWGW cycles, spawns helpers
       └─ Remote/     ← long-lived worker scripts deployed to remote servers
            hack-target.js
            grow-target.js
            weak-target.js
            share.js
```

**`helpers.js`** is the shared utility library imported by almost every other script. Key exports:
- `formatMoney`, `formatRam`, `formatDuration`, `formatNumber` — display formatting
- `getNsDataThroughFile` / `getNsDataThroughFile_Custom` — RAM-safe NS API calls via temp files
- `runCommand` / `runCommand_Custom` — execute arbitrary NS code in a temp script
- `getConfiguration` — unified arg parsing with config-file overrides and --help rendering
- `getActiveSourceFiles` — detect which Source Files the player owns
- `tryGetBitNodeMultipliers` — get current BN multipliers (falls back to hard-coded table)
- `scanAllServers` — BFS over the entire server graph
- `log`, `tail`, `autoRetry`, `instanceCount`, `getErrorInfo` — runtime utilities
- `jsonReplacer` / `jsonReviver` — serialize `Map`, `Set`, `Infinity`, `NaN`, `BigInt` through JSON

**`Tasks/`** — utility scripts run on demand or spawned by `daemon.js`:
- `crack-host.js` — opens ports and nukes a server
- `backdoor-all-servers.js` — installs backdoors everywhere
- `contractor.js` — solves coding contracts
- `ram-manager.js` — buys/upgrades home RAM
- `program-manager.js` / `tor-manager.js` — purchases programs

**Top-level convenience scripts** (run from the in-game terminal):
`autopilot.js`, `daemon.js`, `stockmaster.js`, `faction-manager.js`, `ascend.js`, `gangs.js`, `sleeve.js`, `bladeburner.js`, `casino.js`, `crime.js`, `work-for-factions.js`, `hacknet-upgrade-manager.js`, `host-manager.js`, `scan.js`, `stats.js`, `reserve.js`, `cleanup.js`

**`darknet.ts`** — TypeScript script using the experimental `ns.dnet` API (darkweb puzzle-cracking); loaded by the game's built-in TS transpiler.

## Key conventions

- Scripts support both Bitburner v2 and v3 APIs. `checkBackwardsCompatibility` in `helpers.js` rewrites API calls at runtime; write v3 API names and let the helper downgrade them.
- Temp scripts are written to `/Temp/` and marked `{ temporary: true }` so the game auto-deletes them on save.
- `reserve.txt` stores a global money reserve that all auto-spending scripts respect.
- RAM is the primary constraint. Prefer importing from `helpers.js` over adding new `ns.*` references; each unique NS function reference adds RAM cost.
