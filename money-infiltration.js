// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/money-infiltration.js
import { devConsole, formatMoney, getFilePath } from './helpers.js'

const argsSchema = [
    ['max-infiltration-difficulty', 3.2],
    ['low-money-max-infiltration-difficulty', 2.5],
    ['travel-buffer', 200000],
    ['result-file', '/Temp/money-infiltration-result.txt'],
];

const cityTravelCost = 200000;
let lastMoneyInfiltrationConsoleStatus = "";

/** @param {NS} ns **/
export async function main(ns) {
    const options = ns.flags(argsSchema);
    ns.disableLog('sleep');
    ns.disableLog('getPlayer');
    ns.disableLog('isRunning');
    ns.write(options['result-file'], JSON.stringify({ success: false, reason: 'started' }), 'w');

    if (ns.ps('home').some(process => process.filename == getFilePath('infiltration-runner.js') || process.filename == 'infiltration-runner.js'))
        return finish(ns, options, { success: false, reason: 'runner-already-active' });

    const player = ns.getPlayer();
    const target = pickBestCashInfiltration(ns, player, options);
    if (!target)
        return finish(ns, options, { success: false, reason: 'no-feasible-target' });

    moneyInfiltrationConsoleStatus(`target ${target.location.name}@${target.location.city} ${formatMoney(target.reward.sellCash)}`);
    ns.print(`INFO: Money infiltration target ${target.location.name}@${target.location.city}, payout ~${formatMoney(target.reward.sellCash)}.`);
    if (!prepareCity(ns, target)) {
        moneyInfiltrationConsoleStatus(`travel-failed ${target.location.name}@${target.location.city}`, 'error');
        return finish(ns, options, { success: false, reason: 'travel-failed', target: summarizeTarget(target) });
    }

    const resultFile = `/Temp/money-infiltration-runner-${ns.pid}.txt`;
    if (ns.read(resultFile))
        ns.rm(resultFile);
    const runner = getFilePath('infiltration-runner.js');
    const pid = ns.run(runner, 1,
        '--city', target.location.city,
        '--company', target.location.name,
        '--cash',
        '--result-file', resultFile);
    if (!pid) {
        moneyInfiltrationConsoleStatus(`launch-failed ${target.location.name}@${target.location.city}`, 'error');
        return finish(ns, options, { success: false, reason: 'runner-launch-failed', target: summarizeTarget(target) });
    }

    while (ns.isRunning(pid))
        await ns.sleep(1000);

    const result = parseJson(ns.read(resultFile)) || { success: false, reason: 'missing-result' };
    await healIfNeeded(ns, target);
    return finish(ns, options, { ...result, target: summarizeTarget(target) });
}

function pickBestCashInfiltration(ns, player, options) {
    const locations = ns.infiltration.getPossibleLocations();
    const details = locations
        .map(location => {
            try { return ns.infiltration.getInfiltration(location.name); }
            catch { return null; }
        })
        .filter(infiltration => infiltration?.location && (infiltration.reward?.sellCash || 0) > 0)
        .filter(infiltration => canReach(infiltration, player, options))
        .filter(infiltration => canHandleDifficulty(infiltration, player, getDifficultyCap(infiltration, player, options)));
    return details.sort((a, b) =>
        (b.reward.sellCash || 0) - (a.reward.sellCash || 0) ||
        (a.difficulty || 0) - (b.difficulty || 0))[0] || null;
}

function prepareCity(ns, target) {
    const city = target.location?.city;
    if (!city) return false;
    const player = ns.getPlayer();
    if (player.city == city) return true;
    const cash = Number(player.money || 0);
    if (cash < cityTravelCost)
        return false;
    const travelled = ns.singularity.travelToCity(city);
    if (travelled)
        ns.print(`INFO: Travelled to ${city} for money infiltration at ${target.location.name}.`);
    return travelled;
}

function canReach(infiltration, player, options) {
    const city = infiltration.location?.city;
    if (!city || city == player.city) return true;
    return (player.money || 0) >= cityTravelCost + Number(options['travel-buffer'] || 0);
}

function getDifficultyCap(infiltration, player, options) {
    const city = infiltration.location?.city;
    if (!city || city == player.city)
        return Number(options['max-infiltration-difficulty']);
    return (player.money || 0) < cityTravelCost * 2 ?
        Math.min(Number(options['max-infiltration-difficulty']), Number(options['low-money-max-infiltration-difficulty'])) :
        Number(options['max-infiltration-difficulty']);
}

function canHandleDifficulty(infiltration, player, targetDifficultyCap) {
    if ((infiltration?.difficulty ?? Number.POSITIVE_INFINITY) < targetDifficultyCap) return true;
    const requiredCombatStat = getRequiredCombatStatForInfiltration(infiltration, player, targetDifficultyCap);
    return ['strength', 'defense', 'dexterity', 'agility']
        .every(stat => (player.skills?.[stat] || 0) >= requiredCombatStat);
}

function getRequiredCombatStatForInfiltration(infiltration, player, targetDifficultyCap) {
    const startingSecurityLevel = infiltration?.startingSecurityLevel;
    if (!Number.isFinite(startingSecurityLevel)) return 0;
    const currentCharisma = player.skills?.charisma || 0;
    const intelligenceAdj = (player.skills?.intelligence || 0) / 1600;
    const requiredTotalStats = Math.max(0, Math.ceil(Math.pow(Math.max(0, (startingSecurityLevel - targetDifficultyCap - intelligenceAdj) * 250), 1 / 0.9)));
    return Math.max(0, Math.ceil((requiredTotalStats - currentCharisma) / 4));
}

async function healIfNeeded(ns, target) {
    try {
        const player = ns.getPlayer();
        const currentHp = Number(player.hp?.current || 0);
        const maxHp = Number(player.hp?.max || 0);
        const missingHp = Math.max(0, maxHp - currentHp);
        const money = Number(player.money || 0);
        const cost = money < 0 ? 0 : Math.min(money * 0.1, missingHp * 100000);
        if (missingHp <= 0 || money < 0 || cost > money) return;
        ns.singularity.hospitalize();
        ns.print(`INFO: Healed after money infiltration at ${target.location.name}; estimated cost ${formatMoney(cost)}.`);
    } catch (error) {
        ns.print(`WARNING: Failed to heal after money infiltration: ${String(error)}`);
    }
}

function summarizeTarget(target) {
    return {
        company: target.location?.name,
        city: target.location?.city,
        sellCash: target.reward?.sellCash || 0,
        difficulty: target.difficulty,
    };
}

function finish(ns, options, result) {
    ns.write(options['result-file'], JSON.stringify(result), 'w');
    if (result.success) {
        moneyInfiltrationConsoleStatus(`done ${result.target?.company || 'unknown'}@${result.target?.city || '?'}`);
        ns.print(`SUCCESS: Money infiltration completed at ${result.target?.company || 'unknown'} for cash.`);
    } else if (!['runner-already-active'].includes(result.reason)) {
        const target = result.target;
        moneyInfiltrationConsoleStatus(`failed ${target?.company || 'unknown'}@${target?.city || '?'}: ${result.reason}`, 'error');
        ns.print(`INFO: Money infiltration skipped/failed: ${result.reason}.`);
    }
    return !!result.success;
}

function moneyInfiltrationConsoleStatus(message, method = 'log') {
    if (message == lastMoneyInfiltrationConsoleStatus) return;
    lastMoneyInfiltrationConsoleStatus = message;
    devConsole(method, `[money-infiltration] ${message}`);
}

function parseJson(raw) {
    try { return JSON.parse(raw); }
    catch { return null; }
}
