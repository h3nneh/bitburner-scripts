/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(720, 390);
    ns.ui.moveTail(880, 0);

    const React = globalThis.React;
    const e = (type, props, ...children) => React.createElement(type, props, ...children);

    // ── CSS style constants ──────────────────────────────────────
    const GREEN  = { color: '#0f0' };
    const YELLOW = { color: '#ff0' };
    const CYAN   = { color: '#0ff' };
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
    const ROW  = { display: 'flex', padding: '0 4px', alignItems: 'baseline' };
    const SEP  = { borderTop: '1px solid #0f0' };
    const FILL = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
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
    const fmtProj = (cur, boost) => {
        if (!boost || boost < 1.001) return '';
        return ` (→×${(cur * boost).toFixed(2)})`;
    };
    const fmtList = (list, max = 5) => {
        if (!list || list.length === 0) return '—';
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

        // ── Live data ─────────────────────────────────────────────
        const player = ns.getPlayer();
        const procs  = ns.ps('home').map(p => p.filename);
        const karma  = ns.heart.break();
        const work   = (() => { try { return ns.singularity.getCurrentWork(); } catch { return null; } })();

        // ── Derived values ────────────────────────────────────────
        const bnStr    = `BN${ap?.bn ?? '?'}`;
        const cash     = player.money;
        const stocks   = ap?.stocksValue ?? 0;
        const total    = cash + stocks;
        const karmaStr = Math.round(karma).toLocaleString('en');
        const killsStr = player.numPeopleKilled.toLocaleString('en');
        const m        = player.mults;

        const statusStr   = ap?.status ?? '(no autopilot data — is autopilot.js running?)';
        const instCount   = fm?.installed_count_ex_nf       ?? 0;
        const affordCount = fm?.affordable_count_ex_nf       ?? 0;
        const awaitCount  = fm?.awaiting_install_count_ex_nf ?? 0;
        const augTarget   = ap?.augInstallTarget              ?? 6;
        const augCost     = ap?.augCost  ?? fm?.total_aug_cost ?? 0;
        const repCost     = ap?.repCost  ?? 0;
        const totalCost   = augCost + repCost;
        const nfInstalled = ap?.nfInstalled ?? 0;
        const nfPending   = ap?.nfPending   ?? 0;
        const affordList  = (fm?.affordable_augs ?? []).filter(a => a !== NF);
        const pb          = fm?.projBoost ?? ap?.projBoost ?? {};

        const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
        const homeUsed = ap?.homeRamUsed ?? 0;
        const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';

        // Current work description
        let workStr = '—';
        if (work) {
            if (work.type === 'FACTION') {
                const wt = work.factionWorkType ? `  [${work.factionWorkType.toLowerCase()}]` : '';
                workStr = `${work.factionName}${wt}`;
            } else if (work.type === 'COMPANY') {
                workStr = `${work.companyName}`;
            } else if (work.type === 'CLASS') {
                workStr = `Studying`;
            } else if (work.type === 'CRIME') {
                workStr = `Crime`;
            } else {
                workStr = work.type ?? '?';
            }
        }

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

            sep(),

            // ── Hacking stats ────────────────────────────────────
            e('div', { style: ROW },
                t('hack '), t(String(player.skills.hacking).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.hacking), YELLOW), t(fmtProj(m?.hacking, pb.hacking), CYAN),
                t('  exp'), t(fmtMult(m?.hacking_exp), YELLOW),
                e('span', { style: FILL }),
                t(`karma ${karmaStr}  kills ${killsStr}`, GREY),
            ),
            row(
                t('     '),
                t('money '), t(fmtMult(m?.hacking_money), YELLOW), t(fmtProj(m?.hacking_money, pb.hacking_money), CYAN),
                t('  speed '), t(fmtMult(m?.hacking_speed), YELLOW), t(fmtProj(m?.hacking_speed, pb.hacking_speed), CYAN),
                t('  chance '), t(fmtMult(m?.hacking_chance), YELLOW), t(fmtProj(m?.hacking_chance, pb.hacking_chance), CYAN),
            ),

            sep(),

            // ── Combat / Cha / Rep stats ─────────────────────────
            row(
                t('str  '), t(String(player.skills.strength).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.strength), YELLOW), t('  exp'), t(fmtMult(m?.strength_exp), YELLOW),
                t('  │  def  '), t(String(player.skills.defense).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.defense), YELLOW), t('  exp'), t(fmtMult(m?.defense_exp), YELLOW),
            ),
            row(
                t('dex  '), t(String(player.skills.dexterity).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.dexterity), YELLOW), t('  exp'), t(fmtMult(m?.dexterity_exp), YELLOW),
                t('  │  agi  '), t(String(player.skills.agility).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.agility), YELLOW), t('  exp'), t(fmtMult(m?.agility_exp), YELLOW),
            ),
            row(
                t('cha  '), t(String(player.skills.charisma).padStart(5), GREEN),
                t('  '), t(fmtMult(m?.charisma), YELLOW), t('  exp'), t(fmtMult(m?.charisma_exp), YELLOW),
                t('  │  rep  '), t(fmtMult(m?.faction_rep), YELLOW), t(fmtProj(m?.faction_rep, pb.faction_rep), CYAN),
            ),

            sep(),

            // Status — ellipsis on long text
            e('div', { style: ROW },
                t('STATUS: ', PIN),
                e('span', { style: { ...FILL, color: ap ? '#fff' : '#666' } }, statusStr),
            ),

            sep(),

            // ── Augmentations ────────────────────────────────────
            // counts + NF + total cost pinned right
            e('div', { style: ROW },
                t(`Augs  inst:${instCount}  afford:${affordCount}  pend:${awaitCount}`),
                t(`  ${instCount + affordCount + awaitCount}/${augTarget}`, BOLD),
                t('  │  '),
                t(`NF ×${nfInstalled}`, nfInstalled > 0 ? GREEN : GREY),
                nfPending > 0 ? t(` +${nfPending}`, CYAN) : '',
                e('span', { style: FILL }),
                totalCost > 0 ? t(fmtMoney(totalCost), { ...YELLOW, ...PIN }) : '',
            ),
            // affordable aug names (with CSS ellipsis) + donation cost if any
            e('div', { style: ROW },
                t('buy:  ', PIN),
                e('span', { style: { ...FILL, color: affordList.length ? '#0f0' : '#666' } },
                    fmtList(affordList)),
                repCost > 0 ? t(`  +don ${fmtMoney(repCost)}`, { ...GREY, ...PIN }) : '',
            ),

            sep(),

            // ── Work + Home RAM ──────────────────────────────────
            e('div', { style: ROW },
                t('Work:  ', PIN),
                e('span', { style: { ...FILL, color: work ? '#ff0' : '#666' } }, workStr),
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
