/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(720, 380);
    ns.ui.moveTail(880, 0);

    const React = globalThis.React;
    const e = (type, props, ...children) => React.createElement(type, props, ...children);

    const BASE = {
        fontFamily: 'Courier New, monospace',
        fontSize:   '13px',
        lineHeight: '1.35',
        border:     '1px solid',
        width:      '100%',
        boxSizing:  'border-box',
        whiteSpace: 'pre',
    };
    const ROW  = { display: 'flex', padding: '0 4px', alignItems: 'baseline' };
    const FILL = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
    const PIN  = { flexShrink: 0 };
    const BOLD = { fontWeight: 'bold' };

    const t   = (text, style = null) => style ? e('span', { style }, String(text)) : String(text);
    const row = (...children)        => e('div', { style: ROW }, ...children);

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
    const fmtList = (list, max = 5) => {
        if (!list || list.length === 0) return '—';
        const suffix = list.length > max ? ` +${list.length - max}` : '';
        return list.slice(0, max).join(', ') + suffix;
    };

    // Fixed-width mult formatters for monospace column alignment
    // fmtM → 5 chars:  ×2.62  or      —
    // fmtP → 7 chars:  →×3.91   or 7 spaces
    const fmtM = (n) => (n != null && !isNaN(n)) ? `×${n.toFixed(2)}` : '    —';
    const fmtP = (cur, boost) => {
        if (!boost || boost < 1.001) return '       ';
        return `→×${(cur * boost).toFixed(2)} `;
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

        // ── Theme colors ──────────────────────────────────────────
        const th = ns.ui.getTheme();
        const SEP_STYLE = { borderTop: `1px solid ${th.primary}` };
        const sep = () => e('div', { style: SEP_STYLE });
        const c   = (color, bold = false) => bold ? { color, fontWeight: 'bold' } : { color };
        const GREY    = c(th.secondary);
        const PRIMARY = c(th.primary);
        const HACK    = c(th.hack);
        const COMBAT  = c(th.combat);
        const CHA     = c(th.cha);
        const MONEY   = c(th.money);
        const SUCCESS = c(th.success);
        const INFO    = c(th.info);
        const WARN    = c(th.warning);
        const BINFO   = c(th.info, true);

        // Stat row layout:  label(5)  value(6)  ··mult(5)  ··proj(7)  ·exp(3)  mult(5)
        // Monospace padding ensures column alignment across all stat rows
        const statRow = (label, val, mk, ek, pk, col) => row(
            t(label.padEnd(5),                                          GREY),
            t((val != null ? String(val) : '').padStart(6),             col),
            t('  ' + fmtM(m?.[mk]),                                     col),
            t('  ' + fmtP(m?.[mk], pk ? pb[pk] : 0),                   INFO),
            t(ek ? ' exp' : '    ',                                      GREY),
            t(ek ? fmtM(m?.[ek]) : '     ',                             col),
        );

        // ── Derived ───────────────────────────────────────────────
        const bnStr    = `BN${ap?.bn ?? '?'}`;
        const cash     = player.money;
        const stocks   = ap?.stocksValue ?? 0;
        const total    = cash + stocks;
        const karmaStr = Math.round(karma).toLocaleString('en');
        const killsStr = player.numPeopleKilled.toLocaleString('en');
        const m        = player.mults;

        const statusStr   = ap?.status ?? '(no autopilot data)';
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
        const countdownTs = fm?.install_status?.installCountdown ?? 0;
        const countdownMs = countdownTs > Date.now() ? countdownTs - Date.now() : 0;

        const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
        const homeUsed = ap?.homeRamUsed ?? 0;
        const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';

        // Work description + elapsed time
        let workStr = '—';
        let workElapsed = '';
        if (work) {
            if (work.cyclesWorked != null) workElapsed = `  (${fmtDur(work.cyclesWorked * 200)})`;
            if (work.type === 'FACTION') {
                const wt = work.factionWorkType ? ` [${work.factionWorkType.toLowerCase()}]` : '';
                workStr = `${work.factionName}${wt}`;
            } else if (work.type === 'COMPANY') {
                workStr = work.companyName;
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
        ns.printRaw(e('div', { style: { ...BASE, borderColor: th.primary } },

            // BN + timers
            row(
                t(bnStr, ap ? BINFO : GREY),
                t(`  │  In BN: ${fmtDur(ap?.timeInBn)}  │  Since reset: ${fmtDur(ap?.timeInAug)}`, PRIMARY),
            ),
            // Money
            row(
                t('Cash: ', GREY), t(fmtMoney(cash), MONEY),
                t('  Stocks: ', GREY), t(fmtMoney(stocks), MONEY),
                t('  Total: ', GREY), t(fmtMoney(total), c(th.money, true)),
            ),

            sep(),

            // ── Hacking ──────────────────────────────────────────
            e('div', { style: ROW },
                t('hack '.padEnd(5),                                    GREY),
                t(String(player.skills.hacking).padStart(6),            HACK),
                t('  ' + fmtM(m?.hacking),                              HACK),
                t('  ' + fmtP(m?.hacking, pb.hacking),                  INFO),
                t(' exp',                                                GREY),
                t(fmtM(m?.hacking_exp),                                  HACK),
                e('span', { style: FILL }),
                t(`karma ${karmaStr}  kills ${killsStr}`,                GREY),
            ),
            row(
                t(' '.repeat(13)),
                t('money '), t(fmtM(m?.hacking_money), HACK), t(' ' + fmtP(m?.hacking_money, pb.hacking_money), INFO),
                t('  speed '),  t(fmtM(m?.hacking_speed),  HACK), t(' ' + fmtP(m?.hacking_speed,  pb.hacking_speed),  INFO),
                t('  chance '), t(fmtM(m?.hacking_chance), HACK), t(' ' + fmtP(m?.hacking_chance, pb.hacking_chance), INFO),
            ),

            sep(),

            // ── Combat ───────────────────────────────────────────
            statRow('str', player.skills.strength,  'strength',  'strength_exp',  null, COMBAT),
            statRow('def', player.skills.defense,   'defense',   'defense_exp',   null, COMBAT),
            statRow('dex', player.skills.dexterity, 'dexterity', 'dexterity_exp', null, COMBAT),
            statRow('agi', player.skills.agility,   'agility',   'agility_exp',   null, COMBAT),

            sep(),

            // ── Charisma + Rep ───────────────────────────────────
            statRow('cha', player.skills.charisma, 'charisma', 'charisma_exp', null, CHA),
            row(
                t('rep  '.padEnd(5),  GREY),
                t('      '),
                t('  ' + fmtM(m?.faction_rep),                 c(th.rep)),
                t('  ' + fmtP(m?.faction_rep, pb.faction_rep), INFO),
            ),

            sep(),

            // Status
            e('div', { style: ROW },
                t('STATUS: ', GREY),
                e('span', { style: { ...FILL, color: ap ? th.primary : th.secondary } }, statusStr),
            ),

            sep(),

            // ── Augmentations ────────────────────────────────────
            e('div', { style: ROW },
                t(`Augs  inst:${instCount}  afford:${affordCount}  pend:${awaitCount}`, PRIMARY),
                t(`  ${instCount + affordCount + awaitCount}/${augTarget}`, { ...BOLD, color: th.primary }),
                t('  │  ', GREY),
                t(`NF ×${nfInstalled}`, nfInstalled > 0 ? SUCCESS : GREY),
                nfPending > 0 ? t(` +${nfPending}`, INFO) : '',
                e('span', { style: FILL }),
                totalCost > 0 ? t(fmtMoney(totalCost), { ...WARN, ...PIN }) : '',
                countdownMs > 0 ? t(`  in ${fmtDur(countdownMs)}`, { ...INFO, ...PIN }) : '',
            ),
            e('div', { style: ROW },
                t('buy:  ', GREY),
                e('span', { style: { ...FILL, color: affordList.length ? th.success : th.secondary } },
                    fmtList(affordList)),
                repCost > 0 ? t(`  +don ${fmtMoney(repCost)}`, { ...GREY, ...PIN }) : '',
            ),

            sep(),

            // ── Work + Home RAM ──────────────────────────────────
            e('div', { style: ROW },
                t('Work:  ', GREY),
                e('span', { style: { ...FILL, color: work ? th.warning : th.secondary } }, workStr),
                workElapsed ? t(workElapsed, { ...GREY, ...PIN }) : '',
                t(`  Home: ${fmtRam(homeMax)} ${homePct}%`, { color: th.primary, ...PIN }),
            ),

            sep(),

            // Script health
            row(...scriptChecks.map(({ label, match }, i) => {
                const running = procs.some(p => p.includes(match));
                const sp      = i < scriptChecks.length - 1 ? '  ' : '';
                return t(label + (running ? '✓' : '✗') + sp, running ? SUCCESS : GREY);
            })),

        ));

        await ns.sleep(2000);
    }
}
