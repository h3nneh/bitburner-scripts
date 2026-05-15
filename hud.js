/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(720, 460);
    ns.ui.moveTail(880, 0);

    const React = globalThis.React;
    const e = (type, props, ...children) => React.createElement(type, props, ...children);

    const W = 84; // inner width between box walls

    // ── Style constants ──────────────────────────────────────────
    const GREEN  = { color: '#0f0' };
    const YELLOW = { color: '#ff0' };
    const CYAN   = { color: '#0ff' };
    const BLUE   = { color: '#88f' };
    const GREY   = { color: '#666' };
    const BGREEN = { color: '#0f0', fontWeight: 'bold' };
    const BCYAN  = { color: '#0ff', fontWeight: 'bold' };
    const BOLD   = { fontWeight: 'bold' };

    // ── Part: text fragment with optional style and known visible length ──
    const P = (text, style = null) => ({ text: String(text), style, len: String(text).length });

    // ── Box chrome ───────────────────────────────────────────────
    const TOP = '┌' + '─'.repeat(W + 2) + '┐';
    const MID = '├' + '─'.repeat(W + 2) + '┤';
    const BOT = '└' + '─'.repeat(W + 2) + '┘';

    /** Render one padded box row from an array of P() parts. */
    const row = (...parts) => {
        const totalLen = parts.reduce((sum, p) => sum + p.len, 0);
        const pad = Math.max(0, W - totalLen);
        return e('div', null,
            '│ ',
            ...parts.map(p => p.style ? e('span', { style: p.style }, p.text) : p.text),
            ' '.repeat(pad) + ' │',
        );
    };

    // ── Formatters ───────────────────────────────────────────────
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

    const fmtRam  = (gb) => gb >= 1024 ? `${(gb / 1024).toFixed(0)}TB` : `${gb}GB`;
    const fmtMult = (n)  => (n != null && !isNaN(n)) ? `×${n.toFixed(2)}` : '—';

    const progressBar = (current, target, width = 20) => {
        const pct    = Math.min(1, current / Math.max(1, target));
        const filled = Math.round(pct * width);
        return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
    };

    const fmtList = (list, max = 3) =>
        list.length === 0 ? '—' :
        list.slice(0, max).join(', ') + (list.length > max ? ` +${list.length - max} more` : '');

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

        // ── Live NS data ──────────────────────────────────────────
        const player = ns.getPlayer();
        const procs  = ns.ps('home').map(p => p.filename);
        const karma  = ns.heart.break();

        // ── Section 1: BN + timers ────────────────────────────────
        const bnStr  = `BN${ap?.bn ?? '?'}`;
        const timers = `  │  In BN: ${fmtDur(ap?.timeInBn)}  │  Since reset: ${fmtDur(ap?.timeInAug)}`;

        // ── Section 2: Money ──────────────────────────────────────
        const cash   = player.money;
        const stocks = ap?.stocksValue ?? 0;
        const total  = cash + stocks;

        // ── Section 3: Stats ──────────────────────────────────────
        const hackStr  = player.skills.hacking.toLocaleString('en');
        const karmaStr = Math.round(karma).toLocaleString('en');
        const killsStr = player.numPeopleKilled.toLocaleString('en');
        const statsStr = `Hack: ${hackStr}  │  Karma: ${karmaStr}  │  Kills: ${killsStr}`;

        // ── Section 4: Multipliers ────────────────────────────────
        const m       = player.mults;
        const hackM   = fmtMult(m?.hacking);
        const moneyM  = fmtMult(m?.hacking_money);
        const speedM  = fmtMult(m?.hacking_speed);
        const chanceM = fmtMult(m?.hacking_chance);
        const repM    = fmtMult(m?.faction_rep);

        // ── Section 5: Status ─────────────────────────────────────
        const statusStr = (ap?.status ?? '(no autopilot data — is autopilot.js running?)').substring(0, W);

        // ── Section 6: Aug progress ───────────────────────────────
        const instCount   = fm?.installed_count_ex_nf         ?? 0;
        const affordCount = fm?.affordable_count_ex_nf         ?? 0;
        const awaitCount  = fm?.awaiting_install_count_ex_nf   ?? 0;
        const target      = ap?.augInstallTarget                ?? 6;
        const progress    = instCount + affordCount + awaitCount;
        const barStr      = progressBar(progress, target);
        const barLabel    = ` ${progress}/${target}  (inst:${instCount}  afford:${affordCount}  pend:${awaitCount})`;

        // ── Section 7: Aug lists ──────────────────────────────────
        const affordList = (fm?.affordable_augs       ?? []).filter(a => a !== NF);
        const awaitList  = (fm?.awaiting_install_augs ?? []).filter(a => a !== NF);
        const costStr    = fm?.total_aug_cost ? `  Cost: ${fmtMoney(fm.total_aug_cost)}` : '';
        const affordStr  = fmtList(affordList);
        const awaitStr   = fmtList(awaitList);

        // ── Section 8: Target + RAM ───────────────────────────────
        const bestHost = ah?.[0]?.hostname ?? '';
        const bestRate = ah?.[0]?.gainRate ?? 0;
        const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
        const homeUsed = ap?.homeRamUsed ?? 0;
        const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';
        const ramStr   = `  │  Home: ${fmtRam(homeMax)} ${homePct}%`;

        // ── Section 9: Script health ──────────────────────────────
        const scriptParts = scriptChecks.map(({ label, match }, i) => {
            const running = procs.some(p => p.includes(match));
            const sep     = i < scriptChecks.length - 1 ? '  ' : '';
            return P(label + (running ? '✓' : '✗') + sep, running ? GREEN : GREY);
        });

        // ── Render ────────────────────────────────────────────────
        ns.clearLog();
        ns.printRaw(e('div', {
            style: {
                fontFamily: 'Courier New, monospace',
                fontSize:   '11px',
                lineHeight: '1.3',
                whiteSpace: 'pre',
            },
        },
            e('div', null, TOP),
            row(P(bnStr, ap ? BCYAN : GREY), P(timers)),
            row(P('Cash: '), P(fmtMoney(cash), GREEN), P('  Stocks: '), P(fmtMoney(stocks), GREEN), P('  Total: '), P(fmtMoney(total), BGREEN)),
            row(P(statsStr)),
            e('div', null, MID),
            row(
                P('MULTS  hack '), P(hackM, YELLOW),
                P('  money '), P(moneyM, YELLOW),
                P('  speed '), P(speedM, YELLOW),
                P('  chance '), P(chanceM, YELLOW),
                P('  rep '), P(repM, YELLOW),
            ),
            e('div', null, MID),
            row(P('STATUS: '), P(statusStr)),
            e('div', null, MID),
            row(P(barStr, BOLD), P(barLabel)),
            row(P('Buy:     '), P(affordStr, affordList.length ? GREEN : GREY), P(costStr, YELLOW)),
            row(P('Install: '), P(awaitStr, awaitList.length ? BLUE : GREY)),
            e('div', null, MID),
            row(
                P('Target: '),
                bestHost ? P(bestHost, YELLOW) : P('(no data)', GREY),
                bestHost ? P(`  (${fmtMoney(bestRate)}/s)`) : P(''),
                P(ramStr),
            ),
            e('div', null, MID),
            row(...scriptParts),
            e('div', null, BOT),
        ));

        await ns.sleep(2000);
    }
}
