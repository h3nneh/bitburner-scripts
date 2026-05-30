# Autopilot HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `hud.js`, a tail-window dashboard showing BN/time, cash+stocks total, karma/kills, hacking multipliers, autopilot status, aug progress with faction-manager purchase list, best hack target, home RAM utilisation, and running script health — with zero impact on existing script RAM budgets.

**Architecture:** `autopilot.js` writes a JSON state blob to `/Temp/autopilot-hud.txt` once per main loop (adds `stocksValue`, `homeRamUsed`, existing internal flags). `hud.js` reads that file plus existing `/Temp/affordable-augs.txt` (aug lists + costs) and `/Temp/analyze-hack.txt` (best hack target), then calls `ns.getPlayer()`, `ns.ps('home')`, `ns.heart.break()`, `ns.getServerMaxRam/UsedRam('home')` directly. Renders a box-drawn ANSI dashboard in its own tail window every 2 seconds.

**Tech Stack:** Vanilla NetscriptJS (ES module), Bitburner NS API, ANSI escape codes (`[…m`), Unicode box-drawing characters. No build tooling.

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `autopilot.js` | Modify | Write `/Temp/autopilot-hud.txt` each main loop |
| `hud.js` | Create | Read state files + live NS calls, render dashboard |

---

## Task 1: Write HUD state from autopilot.js

**Files:**
- Modify: `autopilot.js` (~line 13, ~line 1586, ~line 394)

Expose autopilot's internal state as a JSON file that `hud.js` reads for free. Adds `stocksValue` (already tracked as `cachedStocksValue`) and `homeRamUsed` (cheap call, log already disabled).

- [ ] **Step 1: Add the state file constant**

  After line 13 (`const earlyBootstrapPurchasesFile = ...`), add:

  ```js
  const hudStateFile = "/Temp/autopilot-hud.txt";
  ```

- [ ] **Step 2: Add the writeHudState function**

  Directly after the `persist_log` function (~line 1586), add:

  ```js
  /** Write current autopilot state for hud.js to display. Zero RAM overhead (ramOverride already declared). */
  function writeHudState(ns) {
      ns.write(hudStateFile, JSON.stringify({
          ts: Date.now(),
          bn: resetInfo?.currentNode ?? 0,
          timeInBn: resetInfo ? getTimeInBitnode() : 0,
          timeInAug: resetInfo ? getTimeInAug() : 0,
          status: lastStatusLog,
          stocksValue: cachedStocksValue,
          homeRam: homeRam,
          homeRamUsed: ns.getServerUsedRam('home'),
          ranCasino,
          playerInGang,
          playerInBladeburner,
          augInstallTarget: options?.['install-at-aug-count'] ?? 0,
          augPlusNfTarget: options?.['install-at-aug-plus-nf-count'] ?? 0,
          version: autopilotVersion,
      }), "w");
  }
  ```

- [ ] **Step 3: Call writeHudState at the end of mainLoop**

  The last line of `mainLoop` (~line 394) reads:

  ```js
      return shouldWeKeepRunning(ns); // Return false to shut down autopilot.js if we installed augs, or don't have enough home RAM
  ```

  Replace with:

  ```js
      writeHudState(ns);
      return shouldWeKeepRunning(ns); // Return false to shut down autopilot.js if we installed augs, or don't have enough home RAM
  ```

- [ ] **Step 4: Verify no syntax errors**

  In-game terminal:
  ```
  run autopilot.js --help
  ```
  Expected: help text prints, no error. After one real loop, `/Temp/autopilot-hud.txt` exists and is valid JSON.

- [ ] **Step 5: Commit**

  ```bash
  git add autopilot.js
  git commit -m "feat(hud): write autopilot state to /Temp/autopilot-hud.txt each loop"
  ```

---

## Task 2: Create hud.js

**Files:**
- Create: `hud.js`

Standalone script — run once, opens its own tail window, refreshes every 2 s.

**Dashboard sections:**

```
┌────────────────────────────────────────────────────────────────────┐
│ BN3  │  In BN: 2h 34m  │  Since reset: 14m 22s                    │
│ Cash: $892.3B  Stocks: $124.5B  Total: $1.02T                      │
│ Hack: 2,847  │  Karma: -54,123  │  Kills: 18                       │
├────────────────────────────────────────────────────────────────────┤
│ MULTS  hack ×2.45  money ×3.12  speed ×1.87  chance ×1.00  rep ×1.34│
├────────────────────────────────────────────────────────────────────┤
│ STATUS: Faction manager managing augmentation purchases             │
├────────────────────────────────────────────────────────────────────┤
│ [████████████░░░░░░░░] 4/6  (inst:4  afford:2  pend:0)             │
│ Buy:     SombraAugmentation, OtherAug  (+2 more)   Cost: $450M     │
│ Install: AugReadyToInstall                                          │
├────────────────────────────────────────────────────────────────────┤
│ Target: n00dles ($2.40M/s)  │  Home: 8TB  72.3%                    │
├────────────────────────────────────────────────────────────────────┤
│ autopilot✓  daemon✓  faction-mgr✓  stocks✓  sleeves✓  work-fac✓   │
└────────────────────────────────────────────────────────────────────┘
```

**Data sources per section:**

| Section | Source |
|---------|--------|
| BN / timers | `/Temp/autopilot-hud.txt` (ap state) |
| Cash + Stocks | `ns.getPlayer().money` + `ap.stocksValue` |
| Karma / Kills | `ns.heart.break()` + `player.numPeopleKilled` |
| Multipliers | `ns.getPlayer().mults.*` |
| Status | `ap.status` |
| Aug progress | `/Temp/affordable-augs.txt` counts + `ap.augInstallTarget` |
| Buy/Install lists | `fm.affordable_augs` + `fm.awaiting_install_augs` |
| Hack target | `/Temp/analyze-hack.txt[0]` (sorted by gainRate desc) |
| Home RAM | `ap.homeRam` + `ap.homeRamUsed` |
| Scripts | `ns.ps('home')` |

- [ ] **Step 1: Create hud.js**

  ```js
  /** @param {NS} ns */
  export async function main(ns) {
      ns.disableLog('ALL');
      ns.tail();
      ns.resizeTail(590, 330);
      ns.moveTail(675, 240);

      const W = 68; // inner width between │ chars

      const ESC = '';
      const c = {
          reset:   `${ESC}[0m`,
          bold:    `${ESC}[1m`,
          cyan:    `${ESC}[36m`,
          green:   `${ESC}[32m`,
          yellow:  `${ESC}[33m`,
          red:     `${ESC}[31m`,
          blue:    `${ESC}[34m`,
          grey:    `${ESC}[90m`,
      };

      const top = '┌' + '─'.repeat(W + 2) + '┐';
      const mid = '├' + '─'.repeat(W + 2) + '┤';
      const bot = '└' + '─'.repeat(W + 2) + '┘';

      /** Pad a line (which may contain ANSI codes) to fill the box width. */
      const row = (text) => {
          const visible = text.replace(/\[[0-9;]*m/g, '');
          const pad = Math.max(0, W - visible.length);
          return `│ ${text}${' '.repeat(pad)} │`;
      };

      const fmtMoney = (n) => {
          if (!n || isNaN(n)) return '$0';
          if (n >= 1e15) return `$${(n / 1e15).toFixed(2)}Q`;
          if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
          if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
          if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
          if (n >= 1e3)  return `$${(n / 1e3).toFixed(2)}K`;
          return `$${n.toFixed(0)}`;
      };

      const fmtDur = (ms) => {
          if (!ms || ms < 0) return '—';
          const s = Math.floor(ms / 1000);
          const m = Math.floor(s / 60);
          const h = Math.floor(m / 60);
          if (h > 0) return `${h}h ${m % 60}m`;
          if (m > 0) return `${m}m ${s % 60}s`;
          return `${s}s`;
      };

      const fmtRamShort = (gb) => {
          if (gb >= 1024) return `${(gb / 1024).toFixed(0)}TB`;
          return `${gb}GB`;
      };

      const fmtMult = (n) => (n != null && !isNaN(n)) ? `×${n.toFixed(2)}` : '—';

      const progressBar = (current, target, width = 20) => {
          const pct = Math.min(1, current / Math.max(1, target));
          const filled = Math.round(pct * width);
          return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
      };

      const NF = 'Neuroflux Governor';

      const scriptChecks = [
          { label: 'autopilot',   match: 'autopilot.js' },
          { label: 'daemon',      match: 'daemon.js' },
          { label: 'faction-mgr', match: 'faction-manager.js' },
          { label: 'stocks',      match: 'stockmaster.js' },
          { label: 'sleeves',     match: 'sleeve.js' },
          { label: 'bladeburner', match: 'bladeburner.js' },
          { label: 'work-fac',    match: 'work-for-factions.js' },
      ];

      while (true) {
          // ── Read state files ──────────────────────────────────────
          const ap = (() => { try { return JSON.parse(ns.read('/Temp/autopilot-hud.txt') || 'null'); } catch { return null; } })();
          const fm = (() => { try { return JSON.parse(ns.read('/Temp/affordable-augs.txt') || 'null'); } catch { return null; } })();
          const ah = (() => { try { return JSON.parse(ns.read('/Temp/analyze-hack.txt') || 'null'); } catch { return null; } })();

          // ── Live NS calls ─────────────────────────────────────────
          const player = ns.getPlayer();
          const procs  = ns.ps('home').map(p => p.filename);
          const karma  = ns.heart.break();

          // ── Section 1: BN + timers ────────────────────────────────
          const bnTag  = ap ? `${c.cyan}${c.bold}BN${ap.bn}${c.reset}` : `${c.grey}BN?${c.reset}`;
          const bnLine = `${bnTag}  │  In BN: ${fmtDur(ap?.timeInBn)}  │  Since reset: ${fmtDur(ap?.timeInAug)}`;

          // ── Section 2: Money (Cash + Stocks + Total) ──────────────
          const cash      = player.money;
          const stocks    = ap?.stocksValue ?? 0;
          const total     = cash + stocks;
          const moneyLine = `Cash: ${c.green}${fmtMoney(cash)}${c.reset}` +
                            `  Stocks: ${c.green}${fmtMoney(stocks)}${c.reset}` +
                            `  Total: ${c.bold}${c.green}${fmtMoney(total)}${c.reset}`;

          // ── Section 3: Skills + Karma + Kills ─────────────────────
          const hackStr   = player.skills.hacking.toLocaleString('en');
          const karmaStr  = Math.round(karma).toLocaleString('en');
          const killsStr  = player.numPeopleKilled.toLocaleString('en');
          const statsLine = `Hack: ${hackStr}  │  Karma: ${karmaStr}  │  Kills: ${killsStr}`;

          // ── Section 4: Multipliers ────────────────────────────────
          const m = player.mults;
          const multLine  = `hack ${c.yellow}${fmtMult(m?.hacking)}${c.reset}` +
                            `  money ${c.yellow}${fmtMult(m?.hacking_money)}${c.reset}` +
                            `  speed ${c.yellow}${fmtMult(m?.hacking_speed)}${c.reset}` +
                            `  chance ${c.yellow}${fmtMult(m?.hacking_chance)}${c.reset}` +
                            `  rep ${c.yellow}${fmtMult(m?.faction_rep)}${c.reset}`;

          // ── Section 5: Autopilot status ───────────────────────────
          const status = (ap?.status ?? `${c.grey}(no autopilot data — is autopilot.js running?)${c.reset}`).substring(0, W + 20);

          // ── Section 6: Aug progress ───────────────────────────────
          const instCount  = fm?.installed_count_ex_nf  ?? 0;
          const affordCount= fm?.affordable_count_ex_nf ?? 0;
          const awaitCount = fm?.awaiting_install_count_ex_nf ?? 0;
          const target     = ap?.augInstallTarget ?? 6;
          const progress   = instCount + affordCount + awaitCount;
          const bar        = progressBar(progress, target);
          const augLine    = `${c.bold}${bar}${c.reset} ${progress}/${target}` +
                             `  (inst:${instCount}  afford:${affordCount}  pend:${awaitCount})`;

          // ── Section 7: Faction manager aug lists ──────────────────
          const affordList = (fm?.affordable_augs ?? []).filter(a => a !== NF);
          const awaitList  = (fm?.awaiting_install_augs ?? []).filter(a => a !== NF);
          const augCost    = fm?.total_aug_cost ? `  Cost: ${c.yellow}${fmtMoney(fm.total_aug_cost)}${c.reset}` : '';

          const fmtAugList = (list, max = 3) =>
              list.length === 0 ? `${c.grey}—${c.reset}` :
              list.slice(0, max).join(', ') + (list.length > max ? ` ${c.grey}+${list.length - max} more${c.reset}` : '');

          const buyLine    = `${c.green}Buy:${c.reset}     ${fmtAugList(affordList)}${augCost}`;
          const installLine= `${c.blue}Install:${c.reset} ${fmtAugList(awaitList)}`;

          // ── Section 8: Hack target + Home RAM ────────────────────
          let targetStr = `${c.grey}(no analyze-hack data)${c.reset}`;
          if (ah?.length > 0)
              targetStr = `${c.yellow}${ah[0].hostname}${c.reset}  (${fmtMoney(ah[0].gainRate)}/s)`;

          const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
          const homeUsed = ap?.homeRamUsed ?? 0;
          const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';
          const ramLine  = `Home: ${fmtRamShort(homeMax)} ${homePct}%`;

          const targetRamLine = `Target: ${targetStr}  │  ${ramLine}`;

          // ── Section 9: Script health ──────────────────────────────
          const scriptRow = scriptChecks
              .map(({ label, match }) => {
                  const running = procs.some(p => p.includes(match));
                  return running ? `${c.green}${label}✓${c.reset}` : `${c.grey}${label}✗${c.reset}`;
              })
              .join('  ');

          // ── Render ────────────────────────────────────────────────
          ns.clearLog();
          ns.print(top);
          ns.print(row(bnLine));
          ns.print(row(moneyLine));
          ns.print(row(statsLine));
          ns.print(mid);
          ns.print(row(`MULTS  ${multLine}`));
          ns.print(mid);
          ns.print(row(`STATUS: ${status}`));
          ns.print(mid);
          ns.print(row(augLine));
          ns.print(row(buyLine));
          ns.print(row(installLine));
          ns.print(mid);
          ns.print(row(targetRamLine));
          ns.print(mid);
          ns.print(row(scriptRow));
          ns.print(bot);

          await ns.sleep(2000);
      }
  }
  ```

- [ ] **Step 2: Deploy and open in game**

  ```
  run git-pull.js
  run hud.js
  ```

  Expected: tail window opens. If autopilot is not running all ap-sourced fields show `—` or grey fallback text — correct.

- [ ] **Step 3: Verify with full stack running**

  Start the full script stack if not running:
  ```
  run autopilot.js
  ```

  After one autopilot loop (~2 s), verify each section:
  - **BN/timers**: BN number matches game UI; "Since reset" resets to 0 after each aug install
  - **Money**: Cash matches player money display; Stocks matches stockmaster portfolio; Total = sum
  - **Karma/Kills**: Karma matches `ns.heart.break()` value shown in stats.js; Kills matches player stat
  - **Multipliers**: All show `×N.NN` — cross-check `hack` mult against stats.js overview
  - **Status**: Matches last line printed in autopilot.js tail window
  - **Aug bar**: Progress `X/6` reflects actual aug count; Buy/Install lists match faction-manager output
  - **Target**: Hostname matches best server from `run analyze-hack.js`
  - **RAM**: Percentage matches home RAM used shown in stats.js overview
  - **Scripts**: `✓` only appears for scripts confirmed running via `ps` in terminal

- [ ] **Step 4: Adjust tail window position if needed**

  Autopilot tail defaults to `x=675, y=0` (600×230). The HUD is placed at `y=240` to sit below it. If overlap occurs, change the `ns.moveTail(675, 240)` call. If the box text overflows the window width, reduce `W` from `68` to `62`.

- [ ] **Step 5: Commit**

  ```bash
  git add hud.js
  git commit -m "feat: add expanded tail-window HUD dashboard (hud.js)"
  ```

---

## Self-Review

**Spec coverage:**
- Current status ✓ — `ap.status` (lastStatusLog from autopilot)
- Activity ✓ — script health row with ✓/✗
- All relevant multipliers ✓ — `player.mults`: hack, money, speed, chance, faction_rep
- Cash + Stocks total ✓ — `player.money` + `ap.stocksValue` (cachedStocksValue from autopilot)
- Karma and Kills ✓ — `ns.heart.break()` + `player.numPeopleKilled`
- RAM utilisation ✓ — home RAM via `ap.homeRam` / `ap.homeRamUsed` from autopilot state
- ETA for current activity ✓ — aug progress bar with `progress/target` count; true time-ETA requires rate tracking (out of scope, noted)
- Faction manager purchase output ✓ — `affordable_augs` (Buy row) + `awaiting_install_augs` (Install row) + `total_aug_cost`, all from `/Temp/affordable-augs.txt`
- Hack target ✓ — best server from `/Temp/analyze-hack.txt[0]`

**Placeholder scan:** None. All code complete and executable.

**Type consistency:**
- `fmtMoney` used in Money row, Aug cost, Target row — same function everywhere
- `fmtDur` used in BN/timers only
- `fmtMult` used in Multipliers row only
- `fmtRamShort` used in RAM display only
- `c.*` color constants used throughout — all defined at top of `main`
- `NF` constant (`'Neuroflux Governor'`) used in both aug list filters

**Edge cases handled:**
- All file reads wrapped in try/catch → null on parse failure → graceful fallback text
- `ap === null` (autopilot not running) → grey fallback messages, no crash
- `fm === null` (faction-manager never ran) → aug counts show 0, lists show `—`
- `ah === null` or empty → "no analyze-hack data" fallback
- ANSI codes stripped in `row()` before padding → box alignment preserved regardless of color codes
- `homeMax === 0` → RAM% shows `?` instead of dividing by zero
- Aug lists truncated at 3 entries with `+N more` suffix → no line overflow
