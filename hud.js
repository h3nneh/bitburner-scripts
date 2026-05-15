/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(720, 460);
    ns.ui.moveTail(880, 0);

    const React = globalThis.React;
    const e = (type, props, ...children) => React.createElement(type, props, ...children);

    // ── CSS style constants ──────────────────────────────────────
    const GREEN  = { color: '#0f0' };
    const YELLOW = { color: '#ff0' };
    const CYAN   = { color: '#0ff' };
    const BLUE   = { color: '#88f' };
    const GREY   = { color: '#666' };
    const BGREEN = { color: '#0f0', fontWeight: 'bold' };
    const BCYAN  = { color: '#0ff', fontWeight: 'bold' };
    const BOLD   = { fontWeight: 'bold' };

    const BASE = {
        fontFamily: 'Courier New, monospace',
        fontSize:   '11px',
        lineHeight: '1.3',
        border:     '1px solid #0f0',
        width:      '100%',
        boxSizing:  'border-box',
        whiteSpace: 'pre',
    };
    const ROW = { display: 'flex', padding: '0 4px', alignItems: 'baseline' };
    const SEP = { borderTop: '1px solid #0f0' };
    // Span that fills remaining space and truncates with ellipsis
    const FILL = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
    // Span that never shrinks (pinned content like labels / cost)
    const PIN  = { flexShrink: 0 };

    // ── Helpers ──────────────────────────────────────────────────
    const t   = (text, style = null) => style ? e('span', { style }, String(text)) : String(text);
    const row = (...children)        => e('div', { style: ROW }, ...children);
    const sep = ()                   => e('div', { style: SEP });

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

    // Aug list — CSS ellipsis handles truncation, so show up to 5 items
    const fmtList = (list, max = 5) => {
        if (list.length === 0) return '—';
        const suffix = list.length > max ? ` +${list.length - max}` : '';
        return list.slice(0, max).join(', ') + suffix;
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
        // ── State files ───────────────────────────────────────────
        const ap = (() => { try { return JSON.parse(ns.read('/Temp/autopilot-hud.txt') || 'null'); } catch { return null; } })();
        const fm = (() => { try { return JSON.parse(ns.read('/Temp/affordable-augs.txt') || 'null'); } catch { return null; } })();
        const ah = (() => { try { return JSON.parse(ns.read('/Temp/analyze-hack.txt')   || 'null'); } catch { return null; } })();

        // ── Live data ─────────────────────────────────────────────
        const player = ns.getPlayer();
        const procs  = ns.ps('home').map(p => p.filename);
        const karma  = ns.heart.break();

        // ── Derived values ────────────────────────────────────────
        const bnStr    = `BN${ap?.bn ?? '?'}`;
        const cash     = player.money;
        const stocks   = ap?.stocksValue ?? 0;
        const total    = cash + stocks;
        const hackStr  = player.skills.hacking.toLocaleString('en');
        const karmaStr = Math.round(karma).toLocaleString('en');
        const killsStr = player.numPeopleKilled.toLocaleString('en');
        const m        = player.mults;

        const statusStr   = ap?.status ?? '(no autopilot data — is autopilot.js running?)';
        const instCount   = fm?.installed_count_ex_nf       ?? 0;
        const affordCount = fm?.affordable_count_ex_nf       ?? 0;
        const awaitCount  = fm?.awaiting_install_count_ex_nf ?? 0;
        const augTarget   = ap?.augInstallTarget              ?? 6;
        const progress    = instCount + affordCount + awaitCount;
        const barStr      = progressBar(progress, augTarget);
        const barLabel    = ` ${progress}/${augTarget}  (inst:${instCount}  afford:${affordCount}  pend:${awaitCount})`;

        const affordList = (fm?.affordable_augs       ?? []).filter(a => a !== NF);
        const awaitList  = (fm?.awaiting_install_augs ?? []).filter(a => a !== NF);
        const costStr    = fm?.total_aug_cost ? `  Cost: ${fmtMoney(fm.total_aug_cost)}` : '';

        const bestHost = ah?.[0]?.hostname ?? '';
        const bestRate = ah?.[0]?.gainRate ?? 0;
        const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
        const homeUsed = ap?.homeRamUsed ?? 0;
        const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';

        // ── Render ────────────────────────────────────────────────
        ns.clearLog();
        ns.printRaw(e('div', { style: BASE },

            // BN + timers
            row(
                t(bnStr, ap ? BCYAN : GREY),
                t(`  │  In BN: ${fmtDur(ap?.timeInBn)}  │  Since reset: ${fmtDur(ap?.timeInAug)}`),
            ),

            // Money
            row(
                t('Cash: '), t(fmtMoney(cash), GREEN),
                t('  Stocks: '), t(fmtMoney(stocks), GREEN),
                t('  Total: '), t(fmtMoney(total), BGREEN),
            ),

            // Stats
            row(
                t('Hack: '), t(hackStr),
                t('  │  Karma: '), t(karmaStr),
                t('  │  Kills: '), t(killsStr),
            ),

            sep(),

            // Multipliers
            row(
                t('MULTS  hack '), t(fmtMult(m?.hacking), YELLOW),
                t('  money '),     t(fmtMult(m?.hacking_money), YELLOW),
                t('  speed '),     t(fmtMult(m?.hacking_speed), YELLOW),
                t('  chance '),    t(fmtMult(m?.hacking_chance), YELLOW),
                t('  rep '),       t(fmtMult(m?.faction_rep), YELLOW),
            ),

            sep(),

            // Status — ellipsis on long text
            e('div', { style: ROW },
                t('STATUS: ', PIN),
                e('span', { style: { ...FILL, color: ap ? '#fff' : '#666' } }, statusStr),
            ),

            sep(),

            // Aug progress bar
            row(t(barStr, BOLD), t(barLabel)),

            // Buy list — aug names fill + cost pinned right
            e('div', { style: ROW },
                t('Buy:     ', PIN),
                e('span', { style: { ...FILL, color: affordList.length ? '#0f0' : '#666' } },
                    fmtList(affordList)),
                t(costStr, { ...YELLOW, ...PIN }),
            ),

            // Install list
            e('div', { style: ROW },
                t('Install: ', PIN),
                e('span', { style: { ...FILL, color: awaitList.length ? '#88f' : '#666' } },
                    fmtList(awaitList)),
            ),

            sep(),

            // Target + RAM (RAM pinned right)
            e('div', { style: ROW },
                t('Target: ', PIN),
                t(bestHost || '—', { ...YELLOW, ...PIN }),
                t(bestHost ? `  (${fmtMoney(bestRate)}/s)` : ''),
                e('span', { style: FILL }),  // spacer
                t(`Home: ${fmtRam(homeMax)} ${homePct}%`, PIN),
            ),

            sep(),

            // Script health
            row(...scriptChecks.map(({ label, match }, i) => {
                const running = procs.some(p => p.includes(match));
                const sep2    = i < scriptChecks.length - 1 ? '  ' : '';
                return t(label + (running ? '✓' : '✗') + sep2, running ? GREEN : GREY);
            })),

        ));

        await ns.sleep(2000);
    }
}
