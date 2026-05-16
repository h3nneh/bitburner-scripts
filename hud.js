/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(660, 530);
    ns.ui.moveTail(1600, 460);

    const React = globalThis.React;
    const e = (type, props, ...children) => React.createElement(type, props, ...children);

    const BASE = {
        fontFamily: 'Courier New, monospace',
        fontSize:   '15px',
        lineHeight: '1.4',
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

    // ×5.60 — always 5 chars
    const fmtM = (n) => (n != null && !isNaN(n)) ? `×${n.toFixed(2)}` : '    —';

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
        const wf = (() => { try { return JSON.parse(ns.read('/Temp/work-for-factions-hud.txt') || 'null'); } catch { return null; } })();

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

        // ── Derived ───────────────────────────────────────────────
        const bnStr    = `BN${ap?.bn ?? '?'}`;
        const cash     = player.money;
        const stocks   = ap?.stocksValue ?? 0;
        const total    = cash + stocks;
        const karmaStr = Math.round(karma).toLocaleString('en');
        const killsStr = player.numPeopleKilled.toLocaleString('en');
        const m        = player.mults;
        const pb       = fm?.projBoost ?? ap?.projBoost ?? {};

        const statusStr   = ap?.status ?? '(no autopilot data)';
        const instCount   = fm?.installed_count_ex_nf        ?? 0;
        const affordCount = fm?.affordable_count_ex_nf        ?? 0;
        const awaitCount  = fm?.awaiting_install_count_ex_nf  ?? 0;
        const augTarget   = ap?.augInstallTarget               ?? 6;
        const augCost     = ap?.augCost  ?? fm?.total_aug_cost ?? 0;
        const repCost     = ap?.repCost  ?? 0;
        const totalCost   = augCost + repCost;
        const nfInstalled = ap?.nfInstalled ?? 0;
        const nfPending   = ap?.nfPending   ?? 0;
        const affordList  = (fm?.affordable_augs ?? []).filter(a => a !== NF);
        const countdownTs = fm?.install_status?.install_countdown ?? 0;
        const countdownMs = countdownTs > Date.now() ? countdownTs - Date.now() : 0;

        const homeMax  = ap?.homeRam     ?? ns.getServerMaxRam('home');
        const homeUsed = ap?.homeRamUsed ?? 0;
        const homePct  = homeMax > 0 ? (100 * homeUsed / homeMax).toFixed(1) : '?';

        // Work description + ETA (from work-for-factions state) or elapsed fallback
        const wfFresh = wf?.ts && Date.now() - wf.ts < 30000; // stale after 30s
        let workStr = '—';
        let workEta = '';
        if (work) {
            if (work.type === 'FACTION') {
                const wt = work.factionWorkType ? ` [${work.factionWorkType.toLowerCase()}]` : '';
                workStr = `${work.factionName}${wt}`;
                if (wfFresh && wf.faction === work.factionName && wf.etaMs > 0)
                    workEta = `  ETA ${fmtDur(wf.etaMs)}`;
                else if (work.cyclesWorked != null)
                    workEta = `  for ${fmtDur(work.cyclesWorked * 200)}`;
            } else if (work.type === 'COMPANY') {
                workStr = work.companyName;
                if (work.cyclesWorked != null) workEta = `  for ${fmtDur(work.cyclesWorked * 200)}`;
            } else if (work.type === 'CLASS') {
                workStr = 'Studying';
                if (work.cyclesWorked != null) workEta = `  for ${fmtDur(work.cyclesWorked * 200)}`;
            } else if (work.type === 'CRIME') {
                workStr = 'Crime';
            } else {
                workStr = work.type ?? '?';
            }
        } else if (wfFresh && wf.workType === 'infiltration' && wf.etaMs > 0) {
            workStr = `${wf.faction} [infiltrating]`;
            workEta = `  ETA ${fmtDur(wf.etaMs)}`;
        }

        // Inline projected mult — only rendered when pending augs boost this stat
        const proj = (mk, pk) => {
            const boost = pk ? pb[pk] : null;
            if (!boost || boost < 1.001) return null;
            return t(` →×${((m?.[mk] ?? 1) * boost).toFixed(2)}`, INFO);
        };

        // label(4) value(6)  (×mult  [→×proj]  [exp ×mult])
        const statRow = (label, val, mk, ek, pk, col) => row(
            t(label.padEnd(4),                                    GREY),
            t((val != null ? String(val) : '').padStart(6),       col),
            t('  ('),
            t(fmtM(m?.[mk]),                                      col),
            proj(mk, pk),
            ek ? t('  exp ',                                      GREY) : null,
            ek ? t(fmtM(m?.[ek]),                                 col)  : null,
            t(')',                                                 GREY),
        );

        // Augmentation derived values
        const nfAffordCount   = fm?.affordable_count_nf        ?? 0;
        const nfAwaitCount    = fm?.awaiting_install_count_nf  ?? 0;
        const totalPendingNf  = nfAffordCount + nfAwaitCount;
        const hasProj         = Object.values(pb).some(v => v > 1.001);
        const projTotal       = (mk) => t(`×${((m?.[mk] ?? 1) * (pb[mk] ?? 1)).toFixed(2)}`, INFO);

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
                t('hack',                                          GREY),
                t(String(player.skills.hacking).padStart(6),      HACK),
                t('  ('),
                t(fmtM(m?.hacking),                               HACK),
                proj('hacking', 'hacking'),
                t('  exp ',                                        GREY),
                t(fmtM(m?.hacking_exp),                           HACK),
                t(')',                                             GREY),
                e('span', { style: FILL }),
                t(`karma ${karmaStr}  kills ${killsStr}`,          GREY),
            ),
            row(
                t('    '),
                t('money ',   GREY), t(fmtM(m?.hacking_money),  HACK), proj('hacking_money',  'hacking_money'),
                t('  speed ',  GREY), t(fmtM(m?.hacking_speed),  HACK), proj('hacking_speed',  'hacking_speed'),
                t('  chance ', GREY), t(fmtM(m?.hacking_chance), HACK), proj('hacking_chance', 'hacking_chance'),
            ),

            sep(),

            // ── Combat ───────────────────────────────────────────
            statRow('str', player.skills.strength,  'strength',  'strength_exp',  null, COMBAT),
            statRow('def', player.skills.defense,   'defense',   'defense_exp',   null, COMBAT),
            statRow('dex', player.skills.dexterity, 'dexterity', 'dexterity_exp', null, COMBAT),
            statRow('agi', player.skills.agility,   'agility',   'agility_exp',   null, COMBAT),

            sep(),

            // ── Charisma + Rep ───────────────────────────────────
            statRow('cha', player.skills.charisma, 'charisma',   'charisma_exp', null,          CHA),
            statRow('rep', null,                   'faction_rep', null,           'faction_rep', c(th.rep)),

            sep(),

            // Status
            e('div', { style: ROW },
                t('STATUS: ', GREY),
                e('span', { style: { ...FILL, color: ap ? th.primary : th.secondary } }, statusStr),
            ),

            sep(),

            // ── Augmentations ────────────────────────────────────
            e('div', { style: ROW },
                t('Augs  ', GREY),
                t(`inst:${instCount}  afford:${affordCount}  pend:${awaitCount}`, PRIMARY),
                t(`  ${instCount + affordCount + awaitCount}/${augTarget}`, { ...BOLD, color: th.primary }),
                t('  │  ', GREY),
                t(`NF ×${nfInstalled}`, nfInstalled > 0 ? SUCCESS : GREY),
                nfPending > 0 ? t(` +${nfPending}`, INFO) : null,
                e('span', { style: FILL }),
                countdownMs > 0 ? t(`in ${fmtDur(countdownMs)}`, { ...INFO, ...PIN }) : null,
            ),
            // Cost breakdown — shown when there's something to buy
            totalCost > 0 ? e('div', { style: ROW },
                t('cost  ', GREY),
                t(fmtMoney(totalCost), WARN),
                t('  =  augs ', GREY),
                t(fmtMoney(augCost), WARN),
                repCost > 0 ? t('  + rep ', GREY) : null,
                repCost > 0 ? t(fmtMoney(repCost), WARN) : null,
                t(`   [${affordCount} aug + ${totalPendingNf} NF]`, GREY),
            ) : null,
            // Projected post-install mults — shown when pending augs improve tracked stats
            hasProj ? e('div', { style: ROW },
                t('post  ', GREY),
                t('hack ',    GREY), projTotal('hacking'),
                t('  money ', GREY), projTotal('hacking_money'),
                t('  speed ', GREY), projTotal('hacking_speed'),
                t('  chance ',GREY), projTotal('hacking_chance'),
                t('  rep ',   GREY), projTotal('faction_rep'),
            ) : null,
            e('div', { style: ROW },
                t('buy:  ', GREY),
                e('span', { style: { ...FILL, color: affordList.length ? th.success : th.secondary } },
                    fmtList(affordList)),
                repCost > 0 ? t(`  +don ${fmtMoney(repCost)}`, { ...GREY, ...PIN }) : null,
            ),

            sep(),

            // ── Work + Home RAM ──────────────────────────────────
            e('div', { style: ROW },
                t('Work:  ', GREY),
                e('span', { style: { ...FILL, color: (work || wfFresh) ? th.warning : th.secondary } }, workStr),
                workEta ? t(workEta, { ...GREY, ...PIN }) : null,
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
