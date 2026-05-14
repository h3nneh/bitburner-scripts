# AGENTS.md

Project-specific guidance for coding agents working in `bitburner-scripts`.

## Scope

- Prefer minimal, targeted patches.
- Preserve the existing script-oriented architecture and Bitburner conventions.
- Do not rewrite working subsystems just to “clean them up”.

## User Preferences

- Keep responses concise and direct.
- Do not make assumptions. Verify behavior, state, and root cause from code or runtime evidence before changing anything.
- Use `apply_patch` for file edits.
- Favor pragmatic fixes over theoretical refactors.
- Do real runtime verification, not just static checks.
- Add useful dev-console logs when debugging UI automation.
- Short infiltration status logs may go to the browser dev console only when it is open; keep detailed infiltration diagnostics behind explicit debug flags.
- Keep `infiltrate.js` debug logging optional and disabled by default.
- Do not disable `logError` in infiltration automation; error logging stays on.
- When a runtime incident reveals a durable project rule or user preference, update `AGENTS.md` in the same change unless the user says not to.
- Keep these notes current: remove or amend stale guidance when behavior changes, rather than accumulating contradictory rules.

## Infiltration Rules

- Infiltration orchestration belongs in `work-for-factions.js` and `infiltration-runner.js`.
- If changing infiltration behavior, prefer explicit parameters and small isolated helpers/scripts.
- When debugging repeated infiltration retries, log the concrete failure reason, not just the selected target.
- Short faction infiltration target logs should include approximate ETA along with remaining reputation, rep/run, and run count.
- Infiltration ETA should prefer observed successful run durations for the same company/location over static difficulty estimates, because static clearance-level estimates can be substantially wrong.
- Do not switch infiltration companies merely because a run ended in hospitalization. Treat hospitalization as a retryable execution failure for the same selected target; only travel/timeouts/reward-claim problems should temporarily cool down a target.
- Treat `go-to-location-failed` as a location/navigation failure, not as hospitalization. Do not switch companies just because the runner failed to click the location page; retry the same selected target after direct Singularity location navigation from `work-for-factions.js`, and keep dev-console status deduplicated.
- Treat `start-failed`, `infiltrate.js-start-failed`, `direct-go-to-location-failed`, `grafting-active`, `missing-result`, and runner launch failures as sticky retry failures for the selected infiltration company. Do not let normal target re-sorting switch to another company for these reasons while the original target is still reachable.
- For faction reputation infiltration, never downgrade to a lower `tradeRep` company merely because the best company had a recent travel/start/location failure. Retry or wait for the best reachable/highest-reward target instead; cooldowns may still apply to money-only infiltration fallback.
- In the normal faction/money automation flow, handle city travel in `work-for-factions.js` before launching `infiltration-runner.js`, then call the runner with travel disabled.
- `work-for-factions.js` must not pass `--allow-travel` to `infiltration-runner.js` in the normal Singularity flow. If the player is unexpectedly in the wrong city before launch, re-run direct Singularity travel in `work-for-factions.js` and return `direct-travel-failed` if that fails.
- If `GRAFTING` is active, faction infiltration should pause instead of trying to open company locations or start background gym training. Do not stop grafting for infiltration, except in BN3 where The Red Pill/faction progression has priority and active grafting may be treated as background instead of blocking infiltration.
- When `GRAFTING` pauses infiltration, do not keep printing changing `target ... travel ...` dev-console lines every loop. Log one concise paused status for the sticky target and wait.
- After normal `work-for-factions.js` infiltration attempts, check player HP and use `ns.singularity.hospitalize()` if HP is below max. Guard the call with the game's hospital cost formula and skip healing if cash is negative or the estimated cost would exceed available cash.
- Prefer a local infiltration target that can finish the remaining faction reputation in one run over unnecessary travel to a slightly better remote target.
- When multiple feasible infiltration targets can finish the remaining faction reputation in one run, choose the fastest/simplest sufficient target instead of the fattest rep/run target. Do not spend a long high-clearance company run to earn only a few thousand missing rep.
- Use `Departure from ...` and `Arrived from ...` wording for travel logs to avoid duplicate-looking messages.
- Remove dead infiltration helper code from `work-for-factions.js` when that logic has been moved into `infiltration-runner.js`; do not keep parallel stale implementations.
- Keep `Shadows of Anarchy` immediately after `Sector-12` in the default faction queue so it is joined early, but never target it directly for faction work or infiltration rewards. It gains reputation passively from successful infiltration done for other targets.

## Reputation / Augmentation Rules

- `NeuroFlux Governor` must not be treated as a normal target augmentation for faction progression calculations.
- `NeuroFlux Governor` is a low-priority cash sink. Do not let it compete with concrete strategic goals such as BN10 Covenant sleeves/memory, The Red Pill, or other progression blockers.
- `NeuroFlux Governor` should only be purchased with leftover cash after all concrete desired/priority non-NeuroFlux augmentation goals are included in the current purchase order. It must be appended after those goals and dropped first if the real spendable budget shrinks.
- Do not use faction donations as a general automation shortcut for augmentation reputation. `faction-manager.js` may donate only for `The Red Pill` once that is the active path, because post-pill cash is no longer strategically useful; other reputation gaps should be closed by `work-for-factions.js` via infiltration/work.
- For `Shadows of Anarchy`, only treat `SoA - phyzical WKS harmonizer` as a target augmentation. Ignore the other SoA mini-game augmentations for progression and purchasing.
- Be careful with anything that feeds:
  - `mostExpensiveAugByFaction`
  - `mostExpensiveDesiredAugByFaction`
  - `mostExpensiveDesiredAugCostByFaction`
- `autopilot.js` reads augmentation status from `/Temp/affordable-augs.txt`.
- `faction-manager.js` should leave that file in a valid state even after purchases.
- `autopilot.js` should not directly launch long-running background automation. After the pre-casino infiltration/casino handoffs, it should launch or relaunch `daemon.js` with explicit mode flags; `daemon.js` owns RAM-gated launches for stockmaster, sleeves, corporation, darknet, grafting, gangs, faction work, hash spending, and hacking.
- After `daemon.js` takes over, RAM calculations and launch gating belong in `daemon.js`. Leaf scripts should not add local low-free-RAM preflights, cached-data fallbacks, or alternate behavior just to survive helper-script RAM pressure.
- `daemon.js` must preserve enough free home RAM for managed scripts' temp-helper bursts and pass the same reserve to `hack.js`; `hack.js` enforces the reserve for hacking jobs but should not independently decide orchestration RAM policy.
- `autopilot.js` must discover long-running child automation across all servers, not just `home`; launchers like `run-corporation.js` may start `corporation.js` remotely and then exit.
- `autopilot.js` should throttle relaunches of short-lived dispatcher scripts such as `run-corporation.js` and `work-for-factions.js`; if they exit quickly because there is nothing actionable, do not spam relaunches every script-check interval.
- When `autopilot.js` hands off to `daemon.js`, pass capability/progression intent and let `daemon.js` decide RAM-gated background launches.
- `autopilot.js` startup must not depend on temp-helper scripts for cheap core reads such as `ns.getResetInfo()` or `ns.getServerMaxRam("home")`; after casino/roulette there may be less than the temp-helper RAM burst free.
- `autopilot.js` Singularity availability detection must be isolated from optional temp-helper refreshes. A failed owned-augmentation helper should leave augmentation data unknown/cached, not set `singularityAvailable=false`.
- `autopilot.js` runs with a low `ramOverride`; do not call expensive Singularity purchase APIs such as `purchaseTor`, `purchaseProgram`, `getUpgradeHomeRamCost`, or `upgradeHomeRam` directly from it. Use a guarded temp-helper or spawn handoff so dynamic RAM does not kill autopilot.
- Version temp-helper output filenames when changing inline helper commands in `autopilot.js`, especially early bootstrap purchase helpers, to avoid noisy immutable-temp-script overwrite warnings in the terminal.
- Before reporting a TOR purchase, check `ns.hasTorRouter()` rather than relying on `ns.singularity.purchaseTor()` returning `true`; `purchaseTor()` may return success even when TOR was already owned.
- If early permanent home-RAM bootstrap only partially reaches the target, `autopilot.js` should keep workers stopped only when the next RAM upgrade is immediately affordable. If cash is short, launch workers and keep stock trading active; do not use `reserve.txt` as a long-running cash accumulator for RAM upgrades.
- When `autopilot.js` uses direct Netscript calls to avoid temp-helper RAM bursts, disable `disableLog` first, then disable standard logs for noisy calls such as `scan`, `getServerMaxRam`, and `getServerUsedRam`; keep useful explicit `INFO`/`WARNING` logs visible.
- `autopilot.js` instance counting must use direct `ns.ps("home")`, not helper `instanceCount()`, because `instanceCount()` uses a temp-helper and can fail immediately after roulette when RAM is still tight.
- `autopilot.js` should read `ns.getPlayer()` directly in the main loop. The direct RAM cost is lower and more reliable than a temp-helper burst on 8GB home after roulette.
- `autopilot.js` running-script discovery must use direct `ns.ps(server)` over the scanned server list. A temp-helper burst for all `ps` results can fail repeatedly after roulette on 8GB home and leave post-casino automation idle.
- When `singularityAvailable=true`, `autopilot.js` should buy critical permanent bootstrap items directly after casino and before launching workers: home RAM to at least 1TB, TOR, and available port crackers. Gate this on actual Singularity availability, not inferred Source-File metadata, and do it before `stockmaster.js`, `sleeve.js`, `daemon.js`, `work-for-factions.js`, or `host-manager.js` can consume the RAM/cash needed by the bootstrap helper.
- `autopilot.js` world-daemon availability checks should use direct `ns.scan`, `ns.getServerRequiredHackingLevel`, and `ns.hasRootAccess`; do not route these cheap checks through temp helpers on low-RAM starts.
- `autopilot.js` should read `ns.getMoneySources()` directly for casino completion checks; using a temp helper can fail immediately after roulette on 8GB home.
- `autopilot.js` should not call `ns.spawn(...)` directly after it has launched or killed worker scripts, because its low `ramOverride` can be exceeded by cumulative dynamic RAM. `spawn-handoff.js` needs 3.6GB in Bitburner DEV 3.0, so on fresh 8GB starts `autopilot.js` must launch it from an early low-RAM path before startup refreshes or worker orchestration.
- On 8GB home, `autopilot.js` should skip stock-value helper refreshes and treat cached stock value as zero rather than retrying `/Temp/stock-symbols.txt.js` under low free RAM.
- Keep `daemon.js` normal-mode logs concise. Full target ordering, toolkit/multiplier phase markers, and repeated helper launch notices belong behind `--verbose`; the per-loop summary and warnings should remain visible.
- `daemon.js` must not open tail windows by default. Tail windows are opt-in with `--tail-windows`; when not enabled, daemon-managed child scripts that support it should receive `--no-tail-windows`.
- Before the first casino run in a reset, if cash is below the casino travel/seed threshold, `autopilot.js` may launch exactly one direct `infiltration-runner.js` session at `Joe's Guns` for cash. Do not use `daemon.js`, `work-for-factions.js`, grafting, stockmaster, or any other fallback before casino.
- In pre-casino waiting mode, `autopilot.js` should stop existing autopilot-managed background scripts, preserve any currently running direct pre-casino `infiltration-runner.js`, and then wait for cash to reach the casino threshold after that runner session.
- `infiltration-runner.js` should internally retry hospitalization for the direct pre-casino `Joe's Guns` cash session, rather than requiring `autopilot.js` to relaunch the runner.
- For the direct pre-casino `Joe's Guns` cash session, `autopilot.js` should pass `casino.js --game roulette` as the runner completion handoff. Do not restart `autopilot.js` between the runner success and the first casino launch on 8GB home, because autopilot startup can hit low-RAM helper delays before making the casino decision.
- `infiltration-runner.js` completion handoff should use `ns.spawn(...)`, not `ns.run(...)`, for `casino.js`. `ns.run(casino.js)` can start the dispatcher while the runner still occupies RAM, causing the dispatcher to fail launching `casino-roulette.js`. If completion args are passed, parse a JSON args string before spreading it into `ns.spawn(...)`.
- `infiltration-runner.js` should not use temp-helper scripts for browser/UI state, button clicks, or `infiltrate.js` start/stop control. Use direct `document`/`window`, `ns.run`, and `ns.scriptKill` calls to avoid low-RAM temp-helper failures during infiltration.
- `infiltration-runner.js` must not reference `ns.singularity.*` directly; in BN1/SF4=0 that makes the runner too expensive to launch before casino. Use UI navigation for the direct pre-casino `Joe's Guns` path.
- Keep the direct pre-casino `infiltration-runner.js` standalone. Do not import `helpers.js` or call `ns.getPlayer()` there; both can make the runner too expensive for an 8GB fresh reset.
- `infiltration-runner.js` uses `ns.ramOverride(...)` because DOM automation is intentionally expensive in the static RAM analyzer. Keep the override high enough to cover dynamic Netscript calls such as `ns.run`, `ns.scriptKill`, and `ns.rm`.
- On an 8GB fresh reset, `infiltration-runner.js` and `infiltrate.js` must fit alongside `autopilot.js`; avoid adding dynamic RAM functions such as `ns.scriptKill`/`ns.rm` to the runner unless the override and total RAM budget are updated.
- `infiltration-runner.js` must stop `infiltrate.js` and clear blocking infiltration/faction-invite UI before spawning any completion script. Spawning `autopilot.js` while `infiltrate.js` still occupies RAM can silently fail on 8GB home.
- After direct cash infiltration, faction invitations such as `Shadows of Anarchy` can appear slightly after the reward click. `infiltration-runner.js` should wait long enough and repeatedly dismiss `Decide later` before handing off to casino, otherwise the modal can block casino navigation.
- If `/Temp/autopilot-pre-casino-infiltration-result.txt` contains a stale exception from an old temp-helper-based `infiltration-runner.js`, `autopilot.js` should treat it as retryable and launch the current runner again.
- `daemon.js --hack-only` must optimize and simulate hack-only jobs, not full HWGW batches. The optimizer must not reduce a hackable target below one hack thread, otherwise startup bootstrap can spin at 0 threads and spam tuning logs.
- XP farming worker jobs (`FarmXP`, `weakenForXp`, `growForXp`) should suppress remote misfire toasts by description as well as by explicit `silentMisfires` args, so already-scheduled or stale-arg workers do not spam warnings.
- `faction-manager.js --purchase` must respect `reserve.txt`; otherwise background purchase attempts can consume money reserved by higher-level orchestration.
- General reserve rule: `reserve.txt` should protect cash for a concrete near-term purchase or action, not act as a long-running savings account. If the money is not immediately actionable, prefer keeping stock trading active and liquidating only when net worth can fund the specific purchase.
- `reserve.txt` is a cash-only reserve. When `autopilot.js` is reserving for a concrete target and stock value is available, write only the cash gap not already covered by liquidatable stocks.
- Do not keep a default stock/bootstrap reserve in `reserve.txt`. If there is no concrete near-term purchase/action, write `0` and let progression scripts and stock trading use the money normally.

## Work / Install Behavior

- Default automation should avoid company-work grinding unless intentionally enabled.
- Hacking study for faction invite requirements should use focused studying by default when focus penalties apply. Only force background studying when `--no-focus` is set or focus is no longer beneficial.
- By default in any BN, prioritize `Sector-12` for `CashRoot Starter Kit` before gang/crime invite rushing. Once CashRoot is affordable or awaiting install, install early, but run `ascend.js` in spend-all mode so current cash is spent on practical permanent purchases/upgrades before installing.
- Gang-based duplicate augmentation filtering must not remove uninstalled strategic desired augmentations such as `CashRoot Starter Kit` from their normal faction path.
- Before `CashRoot Starter Kit` is purchased, default automation and default `faction-manager.js --purchase` must not treat normal desired stats or the early-reset wildcard as permission to buy/install unrelated augmentations such as `Exploits in the BitNodes`; CashRoot gates the first default augmentation reset unless the user passes explicit desired aug/stat flags.
- `autopilot.js` must not own augmentation purchase or install decisions. It may launch `faction-manager.js --manage-installs` and display the resulting status, but purchase thresholds, countdowns, BN8/TRP preservation, CashRoot gating, and install handoff policy belong in `faction-manager.js`.
- `autopilot.js` should refresh `faction-manager.js --manage-installs` quietly and at a throttled interval. Do not print a launch line every autopilot loop while install status is stable.
- `faction-manager.js --manage-installs` should not buy affordable augmentations early and then wait for the install threshold. Hold cash/stock liquidity until the install policy is ready, then buy the selected batch immediately before the install handoff.
- `work-for-factions.js` must not launch `faction-manager.js --purchase` after earning reputation. Faction work earns invites/reputation only; automated player augmentation purchases and install handoffs must go through `faction-manager.js --manage-installs`.
- When `faction-manager.js --manage-installs` hands off to `ascend.js`, pass an explicit flag to skip `ascend.js`'s own faction-manager purchase passes. `ascend.js` may still perform non-augmentation pre-install spending, but augmentation purchase selection stays in `faction-manager.js`.
- When `faction-manager.js` invokes `ascend.js` because `CashRoot Starter Kit` is ready, pass an explicit CashRoot-only purchase mode. Do not let `ascend.js` make a final generic `faction-manager.js --purchase` pass that buys unrelated augmentations before installing CashRoot.
- `autopilot.js` should print a clear version/sync marker on startup so Bitburner logs reveal whether the in-game file matches the local code.
- `work-for-factions.js` should print a clear version/sync marker on startup when diagnosing runtime launch behavior.
- If Singularity is unavailable in the current runtime, do not launch faction work automation and do not print terminal errors from `work-for-factions.js`; exit quietly because this is an expected game-state limitation. Parent orchestration can pass `--singularity-confirmed` after verifying access.
- If `autopilot.js` has already verified Singularity availability, pass that fact explicitly to child faction automation rather than making `work-for-factions.js` rediscover it through a second fragile temp-helper path.
- Avoid arbitrary crime fallback behavior with no concrete goal.
- In the default daemon/autopilot flow, keep broad helper tail windows disabled. `work-for-factions.js` may keep its own tail window open by default because it owns focus/work actions; other helper tail windows should remain opt-in.
- In BN8, for money-gated faction invites, consider liquidatable stock value before declaring the invite impossible. If cash plus stock value satisfies the requirement, liquidate stocks and retry the invite path. Do not apply this broadly to other BNs without a concrete reason.
- When money-gated faction invites are blocked, throttle repeated per-faction logs and emit a concise waiting status with cash, stock value, and the closest missing net-worth gap.
- In BN8, avoid printing repeated scary per-faction `Cannot join ... insufficient money` lines while waiting on money-gated invites; record the gate internally and rely on the concise aggregate waiting status unless action is actually being taken.
- In BN8, money-gated waiting status should name the strategic Daedalus/TRP target instead of misleadingly reporting intermediate factions such as `The Covenant` as the closest target, and it should be throttled to avoid terminal spam.
- Do not use crimes as generic combat-stat training when a faction invite needs specific strength/defense/dexterity/agility thresholds. Use crimes only for kills/karma, then train deficient combat stats directly at the gym.
- Do not farm low-success Homicide just because a faction invite needs kills/karma. Use a practical homicide success threshold and fall back to safer crimes such as Mug until kill farming is no longer mostly wasted time.
- In BN3 `--crime-focus`, keep `Slum Snakes` available as the practical early crime/gang faction path, even when `--prioritize-invites` is set. Skip longer combat/crime faction reputation grinds such as `Tetrads`, `Speakers for the Dead`, `The Syndicate`, `The Dark Army`, and `The Covenant` unless explicitly requested with `--first` or all-faction mode.
- Paid gym training may count liquidatable stock value when cash is short, but only with a larger stock-backed reserve. In BN8 especially, do not liquidate stocks for small training costs unless net worth remains comfortably above the training requirement.
- BN8 travel for faction/infiltration work may also count liquidatable stock value, but should use the same larger stock-backed reserve as paid training before liquidating.
- Before gym combat training, estimate per-stat ETA from current exp/multipliers and choose the fastest practical gym/stat. Do not imply gym training can raise all combat stats at once; `gymWorkout` only supports one of `str`, `def`, `dex`, or `agi`.
- Background gym training may be started in a gym city before travelling to a different infiltration city, because current Bitburner keeps gym training active across city travel. Only do this when the route still has enough cash for gym setup plus the subsequent infiltration travel/buffer; do not spend travel cash on background training and then fail to reach the infiltration target.
- When preparing an infiltration location after starting background gym training, do not call `stopAction()` for current `CLASS` work. That stops the gym workout and makes the “Prepared background training” log false.
- Background combat training for a harder infiltration target must be ETA-gated. Do not train toward a high-stat company merely because it has better rep/run; only start that training when continuing current infiltration during training and then switching to the harder target is estimated to beat staying on the current best target.
- For factions with an `hacking OR combat` invite path such as `Daedalus`, do not start optional combat gym training when the sequential gym ETA is impractical. Defer the combat route and continue toward the hacking invite path instead.
- If `Daedalus` or another high-hack invite is currently impractical under `--training-stat-per-multi-threshold`, treat it as a deferred invite with throttled logging. Do not repeatedly print the full “insufficient hack” diagnostic or imply the script is waiting for a faction to join magically.
- Deferred invite requirements should not cause `work-for-factions.js` to rapidly expand through every work scope in one pass. If a pass only finds deferred invites, exit so background hacking/money automation can use RAM/focus; `daemon.js` should relaunch faction work later with a cooldown instead of keeping an idle faction worker alive.
- `autopilot.js` may launch corporation automation only when corporations are actually available: current BN3 or SF3.3+. Keep the launcher lightweight; do not import `corporation.js` from `run-corporation.js`.
- Even when corporations are available, `autopilot.js` should delay corporation automation until later progression. Require substantial home RAM, currently at least 4TB, and enough free RAM somewhere for the real `corporation.js`, not just the lightweight `run-corporation.js` launcher.
- In BN3, after casino and before launching background workers, the permanent bootstrap home RAM target should be 4TB so corporation automation can start when daemon's RAM gate allows it; do not wait for 8TB by default.
- In BN3, home RAM upgrades are a strategic money goal. Keep stockmaster active with normal cash settings, do not use a full global cash reserve, liquidate stocks only when net worth can immediately fund the next concrete RAM upgrade, and let `ram-manager.js` buy with `--budget 1 --reserve 0` once cash is available.
- `autopilot.js --money-focus` is an opt-in BN3 money mode, not the default: suppress timed XP mode and non-money side activities such as faction work, Go, gangs, sleeves, and grafting until the money engine is bootstrapped. Keep it active until home RAM reaches the BN3 bootstrap target and corporation automation is running; if corporation automation is explicitly disabled, exit money-focus once the RAM target is reached.
- When `autopilot.js --money-focus` is active, pass `--money-focus` through `daemon.js` to `hack.js`; `hack.js` should skip startup study/hack-XP kickstarts, ignore `--xp-only`, and disable opportunistic low-utilization XP farming so money targeting takes priority.
- In `--money-focus`, do not spend cash or RAM on non-money progression. Allowed spenders are only those with a concrete money path: hacking infrastructure, home RAM, stock trading, port crackers/TOR, corporation, and explicitly ROI-gated hacknet/hash spending.
- `stats.js` is display-only and may run during `--money-focus`; do not treat it as a blocked spender.
- In `--money-focus`, do not include `work-for-factions.js` in daemon-managed helpers at all. Do not kill a user-started instance just because money-focus is active.
- While BN3 `--money-focus` is still active, `autopilot.js` should not launch `faction-manager.js --manage-installs` just to receive a "not buying/installing" status. Report the concrete money-focus blocker directly, such as waiting for 4TB home RAM or waiting for `corporation.js` to start.
- In `--money-focus`, money infiltration is allowed, but it must use a dedicated cash-only helper such as `money-infiltration.js`, not `work-for-factions.js`.
- In BN3 `--money-focus`, `daemon.js` should prioritize corporation automation and bypass the normal 4TB home-RAM gate for `run-corporation.js`, while still requiring corporation availability and enough actual free RAM to launch `corporation.js`.
- The default BitNode route should complete `SF3.3` before BN8 and before relying on corporation automation outside BN3. Do not leave `SF3.3` behind stock/BN8 progression if corporation bootstrap errors show automation is blocked by missing corporation APIs.
- Keep `casino.js` as a lightweight dispatcher. Shared casino runtime helpers belong outside it, and autopilot RAM checks should target the selected casino game script, not just the dispatcher.
- `autopilot.js` should not idle for an arbitrary one-minute income baseline before deciding whether casino is needed. Make the casino/run-workers decision immediately from current cash, casino history, net worth, and concrete launch constraints.
- `casino.js` must `ns.spawn(...)` the selected casino game script, not `ns.run(...)` it. On 8GB home, `casino.js` plus `casino-roulette.js` can exceed RAM, especially because roulette uses `spawn` for its own completion handoff.
- `casino.js` should not be responsible for cleaning up RAM before roulette. `autopilot.js` should avoid launching scripts before the first casino run except the single direct `Joe's Guns` `infiltration-runner.js` cash session, then stop conflicting scripts immediately before launching casino.
- For the first casino run on low-RAM fresh resets, `autopilot.js` should spawn the lightweight `casino.js --game roulette` dispatcher instead of `casino-roulette.js` directly. Live DEV 3.0.0 testing showed direct delayed `ns.spawn` of `casino-roulette.js` can leave no process running even with free RAM, while the dispatcher can launch roulette after autopilot exits.
- `casino-roulette.js` must use `ns.spawn(...)` for `--on-completion-script` handoff. On 8GB home, `ns.run(...)` cannot restart `autopilot.js` while roulette still occupies RAM after being kicked out.
- `casino-roulette.js --kill-all-scripts` must not use temp-helper scripts on 8GB home. Directly use `ns.ps`, `ns.kill`, `ns.scan`, and `ns.killall`; skip remote file cleanup if necessary rather than crashing before roulette starts.
- After roulette, faction invitation modals such as the Aevum invite can remain over the UI. Dismiss `Decide later` before the casino completion handoff and on `autopilot.js` startup so post-casino automation is not hidden behind a modal.
- Do not reference `ns.singularity.*` directly from shared casino helpers; pass optional callbacks from scripts that can afford singularity, otherwise use UI clicks to avoid high no-SF4 RAM costs.
- Keep grafting automation conservative and isolated in `graft-manager.js`. `autopilot.js` may launch it, but should not choose graft targets inline. In BN8, grafting must preserve the Daedalus cash floor and focus on stock/cash acceleration via hacking speed/grow/chance, not broad augmentation collection or pure hack XP.
- In BN3, do not auto-launch `graft-manager.js` from `daemon.js`; grafting is not part of the SF3.3/Red Pill path and must not block faction infiltration.
- In BN8, frequent installs are desirable because each reset can rerun casino and restart stock growth from a stronger baseline. Prefer buying all currently affordable non-NeuroFlux augmentations as a batch, then installing immediately, instead of waiting for large augmentation thresholds.
- In BN8, purchase augmentations cheap-first. Do not let the normal value/priority ordering create a huge unaffordable batch; the purchase planner should build the affordable prefix in actual purchase order with augmentation price multipliers included.
- In BN8, never buy new `NeuroFlux Governor` levels from automation or manual `faction-manager.js --purchase` runs. If NF levels were already purchased before this rule and are awaiting install, do not use that as a reason to buy more.
- In BN8, already-purchased awaiting augmentations should override Daedalus-invite waiting heuristics. Leaving purchased augmentations uninstalled creates a price penalty and slows the cash-first loop.
- Do not use global `reserve.txt` to hold cash in BN8; it slows stock/casino-driven progress. Keep only targeted safety checks that prevent going negative on paid actions.
- In BN8, when waiting on money-gated faction invites or other cash-first blockers, keep stockmaster aggressive. Use a very low cash fraction and buy trigger so idle cash is invested instead of sitting below the default `--fracB` threshold.
- In BN8, gang income is hard-capped by `GangSoftcap = 0`, so do not spend cash on gang upgrades for money. If a gang is active, run it as a no-budget money-focus background trickle and keep cash prioritized for stocks/casino/Daedalus.
- In BN8, keep cheap-first frequent installs in the early game. Only switch to Red Pill preservation mode once Daedalus is joined or the installed augmentation and hacking requirements for Daedalus are effectively met; from that point, do not buy or install non-`The Red Pill` augmentations.
- In BN8 Red Pill preservation mode, `The Red Pill` must be considered purchasable directly from joined factions with sufficient reputation even if generic desired-stat filtering produces an empty purchase list; TRP has no stat multipliers, so do not rely only on stat filters for it.
- `The Red Pill` is a valid zero-cost purchase. Do not treat a non-empty augmentation purchase order with total cost `0` as empty or unaffordable.
- In BN8, once Daedalus is joined or `The Red Pill` has been purchased, stop pursuing other money-gated faction invites such as `Illuminati` or `The Covenant`; the remaining path is install TRP, unlock `w0r1d_d43m0n`, and destroy the BN.
- In BN8, if Daedalus is joined but `/Temp/affordable-augs.txt` does not list `The Red Pill` as affordable or awaiting install, `faction-manager.js --manage-installs` should force a no-NeuroFlux purchase attempt instead of idling on the generic frequent-install status.
- Throttle the forced BN8 `The Red Pill` purchase attempts. If Daedalus is joined but TRP is still not purchased/affordable, do not attempt a purchase every automation loop.
- Augmentation purchase profiles belong in `faction-manager.js` via `--purchase-mode`. Other scripts should invoke `faction-manager.js` with a short mode instead of duplicating long `--priority-aug` / `--aug-desired` / `--stat-desired` argument bundles or directly calling `ns.singularity.purchaseAugmentation`.
- In BN8 after `The Red Pill` is installed, `autopilot.js` must ensure the port crackers needed for `w0r1d_d43m0n` are bought. If most money is in stocks, liquidate enough stock value instead of waiting forever on low cash.
- In BN8, `faction-manager.js --manage-installs` should keep `/Temp/affordable-augs.txt` fresh before install decisions; stale output can incorrectly fall back to normal augmentation thresholds.
- In BN8, do not kill the live `stockmaster.js` trader when liquidating unless explicitly requested. Preserving pre-4S tick history is critical; prefer `stockmaster.js --liquidate` with keep-trader behavior, or `--liquidate --kill-trader` only when a full reset is intentional.
- `faction-manager.js --purchase` must not liquidate stocks unless there is a non-empty augmentation purchase order with positive total cost.
- If `stockmaster.js` detects an impossible mixed long/short position on the same symbol, close both positions and recover instead of only logging an error and leaving one side open.
- Do not trigger installs purely because many augmentations are awaiting install if there is no money for additional purchases and more non-NeuroFlux augmentations remain.
- `autopilot.js` timed `xp-mode` is not useful once hack level is already high; avoid reintroducing aggressive XP-mode relaunching at high hack.
- `autopilot.js` timed `xp-mode` should not activate at the start of an augmentation reset. The configured interval is the money-focused delay before each XP window, not a request to spend the first window in `--xp-only`.
- Keep Bitburner 3.0 Darknet orchestration in `Tasks/darknet-manager.js`. `autopilot.js` should only keep the manager running after later progression, currently at least 8TB home RAM, and Darknet scripts should avoid `tprint` in normal automation mode so they do not spam the main terminal.
- Darknet worker scripts can be copied and relaunched across remote darknet hosts with imperfect args. Parse worker args defensively; do not let a missing value for propagation metadata such as `--origin` crash the worker at startup.
- `Netburners` should be skipped in the default early-game autopilot flow while hacknet is intentionally deferred.
- If re-enabling `Netburners`, do it only in a late-game autopilot path that also enables actual hacknet progression; do not merely remove the skip and leave hacknet disabled.
- Company-work grinding, including the `Silhouette`/CEO path, should stay disabled in the default early-game autopilot flow.
- If re-enabling company-work in autopilot, do it only in an explicit late-game path; do not leave `--no-company-work` permanently enabled if late-game company factions are expected to progress.
- After BN10 is complete, if Covenant sleeves or sleeve memory are still incomplete, this becomes the top priority before leaving BN10.
- In BN10 sleeve-completion mode, do not buy NeuroFlux or install augmentations just because NF is available. Other spenders may use surplus cash, but should not spend the cash gap still needed after accounting for liquidatable stock value.
- In BN10 sleeve-completion mode, stocks are still valuable and should not be fully disabled. Do not pass the full sleeve cost as `stockmaster.js --reserve`, because that prevents stockmaster from investing. Prefer an aggressive low cash fraction such as `--fracH 0.001`, protect cash from other spenders with `reserve.txt`, and liquidate only when net worth is sufficient for the Covenant purchase but cash is not.
- Do not stop or skip relaunching `stockmaster.js` just because current cash is enough for the next BN10 Covenant sleeve/memory purchase. Buy the sleeve/memory immediately or let `sleeve.js` buy it, then keep stockmaster trading.
- If using `reserve.txt` to protect BN10 sleeve money, ensure `sleeve.js` itself can still spend that reserve on Covenant sleeve/memory purchases. The reserve is meant to block other spenders, not the intended purchase.

## Bitburner 3.0.0 Notes

- `ns.format.time(...)` should be used instead of legacy `ns.ui.time(...)`.
- Stock API naming changed: prefer `has4SDataTixApi()` instead of `has4SDataTIXAPI()`.
- `ns.singularity.gymWorkout(...)` now expects `GymType` enum values: `str`, `def`, `dex`, `agi`, not `"Strength"`, `"Defense"`, `"Dexterity"`, `"Agility"`.
- Some scripts that build temp helper scripts via `getNsDataThroughFile(...)` can hit much higher RAM costs in DEV 3.0.0 than expected on a fresh save.
- `autopilot.js` owned-augmentation refresh may use a temp helper after `singularityAvailable` is confirmed, but helper failure must not disable Singularity-dependent automation. Gate Singularity on actual cheap call availability, not Source-File metadata.
- Known helper bursts should be represented in `daemon.js` launch policy rather than duplicated in leaf scripts.

## Live Testing Workflow

- When the user asks to verify behavior, prefer live runtime validation against `../bitburner-src` over theory.
- Use headless Chromium / Playwright for UI/runtime verification when possible.
- Start the game dev server from `../bitburner-src` with `npm run start:dev`.
- Start the sync bridge from this repo with `node local-sync-server.js --source-root /Volumes/SRC/bitburner-scripts --port 12526`.
- Never kill or reuse an existing `ws://127.0.0.1:12525` Remote API bridge. Treat it as user-owned; start a separate sync bridge on another port such as `12526` for Codex validation.
- Bitburner's Remote API is file-only. `local-sync-server.js` must not pretend it can run scripts through the Remote API WebSocket. Script-free execution is only available through a separate Chrome DevTools Protocol endpoint, for example `--devtools-port ... --terminal-command ...`.
- A running `local-sync-server.js` process does not pick up code changes. If behavior on port `12525` must change, the user-owned process has to be restarted intentionally.
- Reuse the headless helpers in `/tmp/pwbb` if they already exist:
  - `run_bb_command.mjs`
  - `run_bb_multi.mjs`
  - `run_bb_suite.mjs`
- Run Bitburner headless validations strictly one at a time against a single Remote API port.
- Do not parallelize headless game sessions against the same Remote API connection.
- A websocket `409` from the Remote API is usually a test harness conflict, not a script bug.
- If a headless run says a script does not exist on `home`, first suspect Remote API/session conflicts before changing code.
- For Node-only helpers and CLI tools, use `node --check` or a direct CLI invocation instead of booting the game.

## Validation Heuristics

- Distinguish real compatibility bugs from normal game-state limitations on a fresh save.
- Common non-bugs during fresh-save validation:
  - Missing SF4 / singularity access
  - Missing SF7 / not being in BN7 for bladeburner automation
  - Missing BN10 access for sleeves
  - Missing TIX / 4S API
  - Not enough travel money
  - Not enough RAM to run temp helper scripts
- If a script is blocked only by game state, record that and do not “fix” it as a DEV compatibility issue.
- If a runtime script depends on UI state, verify it in live headless runtime, not just with `node --check`.

## Validation

- After changing JS files, run `node --check` on each edited script.
- Do not close runtime-affecting changes on theory alone. Verify them in live headless Bitburner runtime before the final response.
- For orchestration/runtime changes, always include a separate final live check on a fresh 8GB home save, even if the main regression uses a later-game save.
- If a behavior depends on runtime UI state, say so explicitly in the final response.
- Keep verifier-only debug enablement isolated to the verifier path; do not globally enable infiltration debug logs for live gameplay.
- Infiltration dev-console diagnostics must stay opt-in: use `work-for-factions.js --infiltration-debug`, `infiltration-runner.js --debug`, or `infiltrate.js --debug`; normal automation should launch `infiltrate.js --quiet` without console status spam.
- If changing `work-for-factions.js`, `autopilot.js`, or other orchestration scripts, prefer at least one live headless run that reaches the touched path.

## Known Fresh-Save Runtime Outcomes

- `casino.js` may fail only because the player lacks the minimum money needed to travel to the casino.
- `ascend.js` is safe to run without `--reset` / `--install-augmentations`; by default it should not perform a reset.
- `crime.js`, `stanek.js`, and `stanek.js.create.js` may encounter temp-helper RAM limits on low-RAM saves.

## Files of Interest

- `work-for-factions.js`: faction progression, infiltration orchestration, crime/training flow
- `infiltration-runner.js`: one-shot infiltration executor with explicit args
- `faction-manager.js`: augmentation affordability/purchase/status output
- `autopilot.js`: top-level orchestration and install decisions
- `daemon.js`: orchestration launcher/helper scheduler. All non-hacking script launches stay here, and it must launch `hack.js` as a separate Netscript process, not import it or duplicate the hacking scheduler.
- `hack.js`: dedicated hacking/prep/targeting entrypoint. It should run the hacking process by default and must not launch helper/periodic automation.
- Rooting servers and port-cracker state such as `updatePortCrackers` belong in `hack.js`, not `daemon.js`.
- `daemon.js` should forward only hacking-relevant flags to `hack.js`. Do not keep daemon orchestration flags in `hack.js` merely to tolerate raw `ns.args` passthrough.
- Do not keep stock-manipulation mode in `hack.js`. If stock orchestration is reintroduced, keep it outside the dedicated hacking runner and pass only explicit low-level scheduling inputs.
- Do not keep `use-hacknet-nodes` / `use-hacknet-servers` mode in `hack.js`. The dedicated hacking runner should avoid consuming hacknet server RAM by default.
- Do not keep `share` / `no-share` / share-fill scheduling in `hack.js`. The dedicated hacking runner should not launch faction-reputation sharing work.

## Original source code of the game
- `../bitburner-src`: all sources to build/test the scripts and game itself
- `nix develop`: to run and test the game
