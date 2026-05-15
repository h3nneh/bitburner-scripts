/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.tail();
    ns.resizeTail(590, 330);
    ns.moveTail(675, 240);

    const W = 68; // inner width between │ chars

    const ESC = '';
    const c = {
        reset:  `${ESC}[0m`,
        bold:   `${ESC}[1m`,
        cyan:   `${ESC}[36m`,
        green:  `${ESC}[32m`,
        yellow: `${ESC}[33m`,
        red:    `${ESC}[31m`,
        blue:   `${ESC}[34m`,
        grey:   `${ESC}[90m`,
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
        const status = ap?.status
            ? ap.status.substring(0, W)
            : `${c.grey}(no autopilot data — is autopilot.js running?)${c.reset}`;

        // ── Section 6: Aug progress ───────────────────────────────
        const instCount   = fm?.installed_count_ex_nf          ?? 0;
        const affordCount = fm?.affordable_count_ex_nf          ?? 0;
        const awaitCount  = fm?.awaiting_install_count_ex_nf    ?? 0;
        const target      = ap?.augInstallTarget                 ?? 6;
        const progress    = instCount + affordCount + awaitCount;
        const bar         = progressBar(progress, target);
        const augLine     = `${c.bold}${bar}${c.reset} ${progress}/${target}` +
                            `  (inst:${instCount}  afford:${affordCount}  pend:${awaitCount})`;

        // ── Section 7: Faction manager aug lists ──────────────────
        const affordList = (fm?.affordable_augs        ?? []).filter(a => a !== NF);
        const awaitList  = (fm?.awaiting_install_augs  ?? []).filter(a => a !== NF);
        const augCost    = fm?.total_aug_cost ? `  Cost: ${c.yellow}${fmtMoney(fm.total_aug_cost)}${c.reset}` : '';

        const fmtAugList = (list, max = 3) =>
            list.length === 0
                ? `${c.grey}—${c.reset}`
                : list.slice(0, max).join(', ') +
                  (list.length > max ? ` ${c.grey}+${list.length - max} more${c.reset}` : '');

        const buyLine     = `${c.green}Buy:${c.reset}     ${fmtAugList(affordList)}${augCost}`;
        const installLine = `${c.blue}Install:${c.reset} ${fmtAugList(awaitList)}`;

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
                return running
                    ? `${c.green}${label}✓${c.reset}`
                    : `${c.grey}${label}✗${c.reset}`;
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
