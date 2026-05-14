// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/graft-manager.js
import {
    formatDuration, formatMoney, getActiveSourceFiles, getConfiguration, getNsDataThroughFile,
    getStocksValue, instanceCount, log, tryGetBitNodeMultipliers
} from './helpers.js'

const statusFile = "/Temp/graft-manager-status.txt";
const strCongruity = "Congruity Implant";
const strNF = "NeuroFlux Governor";
const defaultDesiredStats = ["hacking", "hacking_exp", "hacking_money", "hacking_speed", "hacking_grow", "hacking_chance", "faction_rep", "company_rep", "charisma", "charisma_exp"];
const bn8DesiredStats = ["hacking", "hacking_speed", "hacking_grow", "hacking_chance"];
const priorityAugs = {
    "The Red Pill": 100000,
    "Congruity Implant": 10000,
    "Neuroreceptor Management Implant": 200,
    "CashRoot Starter Kit": 100,
};

const argsSchema = [
    ["interval", 60000],
    ["reserve", 0],
    ["min-net-worth", 0],
    ["max-spend-frac", 0.20],
    ["max-time", 90 * 60 * 1000],
    ["max-entropy", 1],
    ["bn8-stock-mode", false],
    ["allow-interrupt", false],
    ["no-focus", false],
    ["dry-run", false],
    ["help", false],
];

export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options || await instanceCount(ns) > 1) return;

    if (options.help) {
        ns.tprint([
            "Conservative automation for augmentation grafting.",
            `Usage: run ${ns.getScriptName()} [--bn8-stock-mode] [--min-net-worth 250b] [--max-spend-frac 0.15]`,
            "Only grafts strategic augmentations and respects reserve.txt. BN8 mode prioritizes stock/cash acceleration.",
        ].join("\n"));
        return;
    }

    let lastStatus = "";
    const setStatus = (message, terminal = false) => {
        if (message == lastStatus) return;
        lastStatus = message;
        ns.write(statusFile, message, "w");
        log(ns, message, terminal);
    };

    while (true) {
        try {
            const result = await maybeStartGrafting(ns, options);
            if (result?.started) return;
            if (result?.status) setStatus(result.status);
        } catch (error) {
            setStatus(`WARN: graft-manager failed: ${formatError(error)}`, false);
        }
        await ns.sleep(Math.max(5000, Number(options.interval) || 60000));
    }
}

async function maybeStartGrafting(ns, options) {
    const resetInfo = await getNsDataThroughFile(ns, `ns.getResetInfo()`);
    const ownedSourceFiles = await getActiveSourceFiles(ns, false);
    const canAccessGrafting = resetInfo.currentNode == 10 || (ownedSourceFiles[10] || 0) > 0;
    if (!canAccessGrafting) return { status: "INFO: Grafting unavailable. Waiting for BN10 or SF10." };

    const player = await getNsDataThroughFile(ns, `ns.getPlayer()`);
    const currentWork = await getNsDataThroughFile(ns, `ns.singularity.getCurrentWork()`);
    if (currentWork?.type == "GRAFTING")
        return { status: `INFO: Already grafting ${currentWork.augmentation}. Waiting for completion.` };
    if (currentWork && !options["allow-interrupt"])
        return { status: `INFO: Not grafting because current work is ${currentWork.type}.` };

    const stocksValue = await safeGetStocksValue(ns);
    const netWorth = player.money + stocksValue;
    const minNetWorth = Number(options["min-net-worth"]) || (options["bn8-stock-mode"] ? 250e9 : 1e12);
    if (netWorth < minNetWorth)
        return { status: `INFO: Waiting to graft until net worth reaches ${formatMoney(minNetWorth)} (now ${formatMoney(netWorth)}).` };

    const reserve = Math.max(Number(options.reserve) || 0, Number(ns.read("reserve.txt") || 0));
    const candidates = await getGraftingCandidates(ns, options, player, resetInfo, reserve, netWorth);
    if (candidates.length == 0)
        return { status: `INFO: No safe grafting target right now. Cash ${formatMoney(player.money)}, reserve ${formatMoney(reserve)}, net ${formatMoney(netWorth)}.` };

    const target = candidates[0];
    if (options["dry-run"])
        return { status: `INFO: Would graft ${target.name}: ${target.reason}, cost ${formatMoney(target.price)}, time ${formatDuration(target.time)}, score ${target.score.toFixed(3)}.` };

    if (player.city != "New Tokyo") {
        const travelled = await getNsDataThroughFile(ns, `ns.singularity.travelToCity(ns.args[0])`, null, ["New Tokyo"]);
        if (!travelled) return { status: `WARN: Cannot travel to New Tokyo to graft ${target.name}.` };
    }

    const started = await getNsDataThroughFile(ns, `ns.grafting.graftAugmentation(ns.args[0], ns.args[1])`,
        "/Temp/graft-augmentation.txt", [target.name, !options["no-focus"]]);
    if (!started)
        return { status: `WARN: Failed to start grafting ${target.name}; prerequisites or cash may have changed.` };

    log(ns, `SUCCESS: Started grafting ${target.name}: ${target.reason}. Cost ${formatMoney(target.price)}, time ${formatDuration(target.time)}.`, true, "success");
    return { started: true };
}

async function getGraftingCandidates(ns, options, player, resetInfo, reserve, netWorth) {
    const graftable = await getNsDataThroughFile(ns, `ns.grafting.getGraftableAugmentations()`, "/Temp/graftable-augs.txt");
    const owned = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(true)`, "/Temp/graft-owned-augs.txt");
    const installed = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations()`, "/Temp/graft-installed-augs.txt");
    const bitNodeMults = await tryGetBitNodeMultipliers(ns);
    const daedalusNeed = bitNodeMults?.DaedalusAugsRequirement || Number.POSITIVE_INFINITY;
    const needDaedalusCount = installed.filter(aug => aug != strNF).length < daedalusNeed;
    const desiredStats = options["bn8-stock-mode"] || resetInfo.currentNode == 8 ? bn8DesiredStats : defaultDesiredStats;
    const availableCash = player.money - reserve;
    const maxSpend = Math.max(0, netWorth * (Number(options["max-spend-frac"]) || 0.20));
    const maxTime = Number(options["max-time"]) || 90 * 60 * 1000;
    const maxEntropy = Number(options["max-entropy"]) || 1;

    const rows = [];
    for (const name of graftable) {
        if (name == strNF) continue;
        const [price, time, stats, prereqs] = await getNsDataThroughFile(ns,
            `[ns.grafting.getAugmentationGraftPrice(ns.args[0]), ns.grafting.getAugmentationGraftTime(ns.args[0]), ns.singularity.getAugmentationStats(ns.args[0]), ns.singularity.getAugmentationPrereq(ns.args[0])]`,
            `/Temp/graft-info-${sanitizeFileName(name)}.txt`, [name]);
        if (!prereqs.every(prereq => owned.includes(prereq))) continue;
        if (price > availableCash || price > maxSpend || time > maxTime) continue;
        const reasonParts = [];
        let score = priorityAugs[name] || 0;
        if (name == strCongruity && player.entropy > 0) {
            score += 50000;
            reasonParts.push(`clears ${player.entropy} entropy`);
        }
        if (name != strCongruity && player.entropy >= maxEntropy) continue;
        const statScore = scoreStats(stats, desiredStats, resetInfo.currentNode == 8 || options["bn8-stock-mode"]);
        score += statScore;
        if (statScore > 0) reasonParts.push(`desired stats +${statScore.toFixed(2)}`);
        if (needDaedalusCount && statScore > 0) {
            score += 25;
            reasonParts.push("Daedalus installed-aug count");
        }
        if (score <= 0) continue;
        rows.push({
            name,
            price,
            time,
            score: score / Math.max(0.25, time / 3600000) / Math.max(1, price / 1e12),
            reason: reasonParts.join(", ") || "priority augmentation",
        });
    }
    return rows.sort((a, b) => b.score - a.score);
}

function scoreStats(stats, desiredStats, bn8StockMode = false) {
    let score = 0;
    for (const [stat, value] of Object.entries(stats || {})) {
        if (!desiredStats.some(desired => stat.includes(desired))) continue;
        if (typeof value != "number" || value <= 1) continue;
        const weight = bn8StockMode ? bn8StockWeight(stat) :
            stat.includes("hacking") ? 80 :
            stat.includes("faction_rep") || stat.includes("company_rep") ? 45 :
                stat.includes("charisma") ? 20 : 10;
        score += (value - 1) * weight;
    }
    return score;
}

function bn8StockWeight(stat) {
    if (stat.includes("hacking_speed")) return 140; // More manipulation cycles per wall-clock time.
    if (stat.includes("hacking_grow")) return 120; // Grow manipulation pushes long positions faster.
    if (stat.includes("hacking_chance")) return 80; // Keeps manipulation reliable as targets get harder.
    if (stat == "hacking" || stat.includes("hacking")) return 45; // Unlocks better stock-linked targets, but is not direct cash.
    return 0;
}

async function safeGetStocksValue(ns) {
    try { return await getStocksValue(ns); }
    catch { return 0; }
}

function sanitizeFileName(name) {
    return name.replace(/[^a-z0-9._-]/gi, "_");
}

function formatError(error) {
    if (typeof error == "string") return error;
    return error?.message ?? JSON.stringify(error);
}
