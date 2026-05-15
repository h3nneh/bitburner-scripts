// Based on: https://github.com/66Ton99/bitburner-scripts/blob/main/work-for-factions.js
import {
    instanceCount, getConfiguration, getNsDataThroughFile, getFilePath, getActiveSourceFiles, tryGetBitNodeMultipliers,
    formatDuration, formatMoney, formatNumberShort, disableLogs, log, getErrorInfo, tail, devConsole, getStocksValue, waitForProcessToComplete
} from './helpers.js'

let options;
const workForFactionsVersion = "2026-05-13-bn3-grafting-background.1";
const argsSchema = [
    ['first', []], // Grind rep with these factions first. Also forces a join of this faction if we normally wouldn't (e.g. no desired augs or all augs owned)
    ['skip', []], // Don't work for these factions
    ['o', false], // Immediately grind company factions for rep after getting their invite, rather than first getting all company invites we can
    ['desired-stats', []], // Factions will be removed from our 'early-faction-order' once all augs with these stats have been bought out
    ['desired-augs', []], // The augmentations will keep a faction in our 'early-faction-order' regardless of whether they have any --desired-stats
    ['no-tail-windows', false], // Set to true to prevent the default behaviour of opening a tail window any time we initiate focused player work.
    ['tail-x', -1], // Optional tail window x position in screen pixels. Set both tail-x and tail-y to pin the window.
    ['tail-y', -1], // Optional tail window y position in screen pixels. Set both tail-x and tail-y to pin the window.
    ['tail-width', -1], // Optional tail window width in pixels.
    ['tail-height', -1], // Optional tail window height in pixels.
    ['no-focus', false], // Disable doing work that requires focusing (crime), and forces study/faction/company work to be non-focused (even if it means incurring a penalty)
    ['no-studying', false], // Disable studying.
    ['pay-for-studies-threshold', 200000], // Only be willing to pay for our studies if we have this much money
    ['training-stat-per-multi-threshold', 100], // Heuristic: Estimate that we can train this many levels for every mult / exp_mult we have in a reasonable amount of time.
    ['no-coding-contracts', false], // Disable purchasing coding contracts for reputation
    ['no-crime', false], // Disable doing crimes at all. (Also disabled with --no-focus)
    ['no-company-work', false], // Disable working for companies / megacorps to earn company faction invites
    ['crime-focus', false], // Useful in crime-focused BNs when you want to focus on crime related factions
    ['fast-crimes-only', false], // Assasination and Heist are so slow, I can see people wanting to disable them just so they can interrupt at will.
    ['min-homicide-chance-for-kills', 0.25], // Below this Homicide success chance, use safer crimes to build stats/karma instead of wasting cycles on low-probability kills.
    ['invites-only', false], // Just work to get invites, don't work for augmentations / faction rep
    ['prioritize-invites', false], // Prioritize working for as many invites as is practical before starting to grind for faction reputation
    ['get-invited-to-every-faction', false], // You want to be in every faction? You got it!
    ['karma-threshold-for-gang-invites', -40000], // Prioritize working for gang invites once we have this much negative Karma
    ['disable-treating-gang-as-sole-provider-of-its-augs', false], // Set to true if you still want to grind for rep with factions that only have augs your gang provides
    ['infiltrate-for-money-under', 0], // If set, use company infiltration for money until this cash threshold is reached
    ['max-infiltration-difficulty', 3.2], // Keep a safety margin under the game's 3.5 hard lock and favor stability over greed.
    ['infiltration-debug', false], // Enable dev-console infiltration diagnostics. Disabled by default to keep normal automation quiet.
    ['cross-city-background-training', true], // Start gym training in a gym city before travelling to a different city for infiltration.
    ['disable-cross-city-background-training', false], // Disable cross-city background gym training.
    ['no-bladeburner-check', false], // By default, will avoid working if bladeburner is active and "The Blade's Simulacrum" isn't installed
    ['singularity-confirmed', false], // Internal: parent orchestration already verified Singularity access.
];

// By default, consider these augs worth working towards regardless of whether they match one of the '--desired-stats'
const default_desired_augs = ["The Red Pill", "CashRoot Starter Kit", "The Blade's Simulacrum", "Neuroreceptor Management Implant"];
const strNF = "NeuroFlux Governor";

// Note: The way the game source encodes job requirements is: [1, 26, 49, 149] (for example), and all then all faction-related
//       companies get a stat modifier of "+224", except a few which have "+249". Rather than replicate those gross numbers,
//       I would just store those job stat requirements as [225, 250, 275, 375] below. I then keep track of the few companies
//       which require +25 on all stat requirements. Don't worry, I make up for it by being convoluted in other ways...
const companySpecificConfigs = [
    { name: "NWO", statModifier: 25 },
    { name: "MegaCorp", statModifier: 25 },
    { name: "Blade Industries", statModifier: 25 },
    { name: "Fulcrum Secret Technologies", companyName: "Fulcrum Technologies" }, // Special snowflake
    { name: "Silhouette", companyName: "TBD", repRequiredForFaction: 1.0e7 } // Hack: 3.2e6 should be enough rep to get the CTO position, but once
    // we hit this rep we might break out of the work loop before getting the final promotion, so we keep working until we get the faction invite.
]
const jobs = [ // Job stat requirements for a company with a base stat modifier of +224 (modifier of all megacorps except the ones above which are 25 higher)
    {
        name: "IT",
        reqRep: [0e0, 7e3, 35e3, 175e3],
        reqHck: [225, 250, 275, 375], // [1, 26, 51, 151] + 224
        reqStr: [0, 0, 0, 0], reqDef: [0, 0, 0, 0], reqDex: [0, 0, 0, 0], reqAgi: [0, 0, 0, 0],
        reqCha: [0e0, 0e0, 275, 300], // [0,  0, 51,  76] + 224
        repMult: [0.9, 1.1, 1.3, 1.4]
    },
    {
        name: "Software",
        reqRep: [0e0, 8e3, 4e4, 2e5, 4e5, 8e5, 16e5, 32e5],
        reqHck: [225, 275, 475, 625, 725, 725, 825, 975],   // [1, 51, 251, 401, 501, 501, 601, 751] + 224
        reqStr: [0, 0, 0, 0, 0, 0, 0, 0], reqDef: [0, 0, 0, 0, 0, 0, 0, 0], reqDex: [0, 0, 0, 0, 0, 0, 0, 0], reqAgi: [0, 0, 0, 0, 0, 0, 0, 0],
        reqCha: [0e0, 0e0, 275, 375, 475, 475, 625, 725],   // [0,  0,  51, 151, 251, 251, 401, 501] + 224
        repMult: [0.9, 1.1, 1.3, 1.5, 1.6, 1.6, 1.75, 2.0]
    },
    {
        name: "Security",
        reqRep: [0e0, 8e3, 36e3, 144e3],
        reqHck: [224, 250, 250, 275],
        reqStr: [275, 375, 475, 725], reqDef: [275, 375, 475, 725], reqDex: [275, 375, 475, 725], reqAgi: [275, 375, 475, 725],
        reqCha: [225, 275, 325, 375],
        repMult: [1, 1.1, 1.25, 1.4],
    },
]
const securityCompanies = ["ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries", "NWO", "Clarke Incorporated", "OmniTek Incorporated", "Four Sigma", "KuaiGong International"];
const factions = ["Illuminati", "Daedalus", "The Covenant", "ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries", "NWO", "Clarke Incorporated", "OmniTek Incorporated",
    "Four Sigma", "KuaiGong International", "Fulcrum Secret Technologies", "BitRunners", "The Black Hand", "NiteSec", "Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12",
    "Volhaven", "Speakers for the Dead", "The Dark Army", "The Syndicate", "Silhouette", "Tetrads", "Slum Snakes", "Netburners", "Tian Di Hui", "CyberSec", "Shadows of Anarchy"];
const passiveInfiltrationFactions = ["Shadows of Anarchy"]; // Gains reputation passively from any infiltration, not via direct faction work/reward targeting.
const shadowsOfAnarchy = "Shadows of Anarchy";
const soaWksHarmonizer = "SoA - phyzical WKS harmonizer";
const cannotWorkForFactions = ["Church of the Machine God", "Bladeburners"]
// These factions should ideally be completed in this order
const preferredEarlyFactionOrder = [
    "Sector-12", // CashRoot Starter Kit is a cheap unique early aug and worth forcing before other city factions
    "Shadows of Anarchy", // Join early, then let normal infiltration for other factions/money passively raise its reputation
    "Netburners", // Improve hash income, which is useful or critical for almost all BNs
    "Tian Di Hui", "Aevum", // These give all the company_rep and faction_rep bonuses early game
    "Daedalus", // Once we have all faction_rep boosting augs, there's no reason not to work towards Daedalus as soon as it's available/feasible so we can buy Red Pill
    "CyberSec", /* Quick, and NightSec aug depends on an aug from here */ "NiteSec", "Tetrads", // Cha augs to speed up earning company promotions
    "Bachman & Associates", // Boost company/faction rep for future augs
    "BitRunners", // Fast source of some unique hack augs
    "Fulcrum Secret Technologies", // Will be removed if hack level is too low to backdoor their server
    "ECorp", // More cmp_rep augs, and some strong hack ones as well
    "The Black Hand", // Fastest sources of hacking augs after the above companies
    "The Dark Army", // Unique cmp_rep aug TODO: Can it sensibly be gotten before megacorps? Requires 300 all combat stats.
    "Clarke Incorporated", "OmniTek Incorporated", "NWO", // More hack augs from companies
    "Chongqing", // Unique Source of big 1.4x hack exp boost (Can only join if not in e.g. Aevum as well)
];
// This is an approximate order of most useful augmentations left to offer, assuming all early-game factions have been cleaned out
const preferredCompanyFactionOrder = [
    "Bachman & Associates", // Augs boost company_rep by 1.65, faction_rep by 1.50. Lower rep-requirements than ECorp augs, so should be a priority to speed up future resets
    "ECorp", // Offers 2.26 multi worth of company_rep and major hacking stat boosts (1.51 hack / 1.54 exp / 1.43 success / 3.0 grow / 2.8 money / 1.25 speed), but high rep reqs
    "Clarke Incorporated", // Biggest boost to hacking after above factions (1.38)
    "OmniTek Incorporated", // Next big boost to hacking after above factions (1.20) (NWO is bigger, but this has lower Cha reqs.)
    "NWO", // Biggest boost to hacking after above factions (1.26)
    "Blade Industries", // Mostly redundant after Ecorp - provides remaining hack-related augs (1.10 money, 1.03 speed)
    "MegaCorp", // Offers 1 unique aug boosting all physical traits by 1.35
    "KuaiGong International", // 1.40 to agility, defense, strength
    "Fulcrum Secret Technologies", // Big boosts to company_rep and hacking, but requires high hack level to backdoor their server, so might have to be left until later
    "Four Sigma", // No unique augs, but note that if accessible early on, Fulcrum + Four Sigma is a one-two punch to get all company rep boosting augs in just 2 factions
]
// Order in which to focus on crime factions. Start with the hardest-to-earn invites, assume we will skip to next best if not achievable.
const preferredCrimeFactionOrder = ["Slum Snakes", "Tetrads", "Speakers for the Dead", "The Syndicate", "The Dark Army", "The Covenant", "Daedalus", "Netburners", "NiteSec", "The Black Hand"];
const bn3DefaultSkippedCrimeRepFactions = ["Tetrads", "Speakers for the Dead", "The Syndicate", "The Dark Army", "The Covenant"];
// Gang factions in order of ease-of-invite. If gangs are available, as we near 54K Karma to unlock gangs (as per --karma-threshold-for-gang-invites), we will attempt to get into any/all of these.
const desiredGangFactions = ["Slum Snakes", "The Syndicate", "The Dark Army", "Speakers for the Dead"];
// Previously this was needed because you couldn't work for any gang factions once in a gang, but that was changed.
const allGangFactions = ["Speakers for the Dead", "The Dark Army", "The Syndicate", "Tetrads", "Slum Snakes", "The Black Hand", "NiteSec"];

const loopSleepInterval = 5000; // 5 seconds
const infiltrationHospitalizedRetryDelay = 250;
const statusUpdateInterval = 60 * 1000; // 1 minute (outside of this, minor updates in e.g. stats aren't logged)
const checkForNewPrioritiesInterval = 10 * 60 * 1000; // 10 minutes. Interrupt whatever we're doing and check whether we could be doing something more useful.
const waitForFactionInviteTime = 30 * 1000; // The game will only issue one new invite every 25 seconds, so if you earned two by travelling to one city, might have to wait a while
const infiltrationTravelFailedLocationCooldown = 60 * 1000; // Avoid spam-retrying a location we currently cannot travel to.
const infiltrationActiveLockFile = "/Temp/work-for-factions-infiltration-active.txt";
const minAdaptiveInfiltrationDifficulty = 1.0;
const lowMoneyInfiltrationDifficulty = 2.5;
const repInfiltrationDifficultyCap = 3.35;
const cityTravelCost = 200000;
const bn8CashReserve = 25e6;
const bn8StockBackedTrainingReserve = 100e6;
const stockBackedTrainingReserve = 10e6;
const silhouetteStatDeferralMargin = 100;
const maxOptionalCombatTrainingEtaMs = 8 * 60 * 60 * 1000;

let shouldFocus; // Whether we should focus on work or let it be backgrounded (based on whether "Neuroreceptor Management Implant" is owned, or "--no-focus" is specified)
// And a bunch of globals because managing state and encapsulation is hard.
let hasFocusPenalty, hasSimulacrum, hasRedPillPurchased, fulcrumHackReq, playerInBladeburner, wasGrafting, currentBitnode, notifiedAboutDaedalus;
let dictSourceFiles, dictFactionFavors, playerGang, mainLoopStart, scope, numJoinedFactions, lastTravel, crimeCount;
let firstFactions, skipFactions, completedFactions, softCompletedFactions, mostExpensiveAugByFaction, mostExpensiveDesiredAugByFaction, mostExpensiveDesiredAugCostByFaction;
let scriptPid = "?";
let recentHospitalizedLocations = {};
let recentFactionInviteDeferrals = {};
let moneyGateStatus = null;
let lastMoneyGateStatus = "";
let lastMoneyGateStatusUpdate = 0;
let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)(); // Trick to get strong typing in mono
let netburnersEligibility = { nodes: 0, levels: 0, ram: 0, cores: 0, ready: false };
let lastMoneyFallbackStatus = "";
let lastNoFactionInfiltrationTargetStatus = "";
let lastNoFactionInfiltrationTargetStatusUpdate = 0;
let lastInfiltrationConsoleStatus = "";
let lastMoneyInfiltrationConsoleStatus = "";
let observedInfiltrationRunTimeByLocation = {};
let lastNothingToDoStatus = "";
let lastNothingToDoStatusUpdate = 0;
let loopHadDeferredInvite = false;
let lastLoopHadDeferredInvite = false;

function shouldDeferSilhouette(player) {
    if (player.factions.includes("Silhouette"))
        return false;
    if (options['no-company-work'])
        return true;
    const maxCompanyStatModifier = Math.max(...companySpecificConfigs.map(c => c.statModifier || 0));
    const requiredHack = Math.max(...jobs.flatMap(job => job.reqHck).filter(req => req > 0)) + maxCompanyStatModifier;
    const requiredCha = Math.max(...jobs.flatMap(job => job.reqCha).filter(req => req > 0)) + maxCompanyStatModifier;
    return player.skills.hacking < requiredHack - silhouetteStatDeferralMargin ||
        player.skills.charisma < requiredCha - silhouetteStatDeferralMargin;
}

function shouldDeferNetburners(player) {
    if (player.factions.includes("Netburners"))
        return false;
    return player.skills.hacking < (requiredHackByFaction["Netburners"] || 0);
}

function deferFactionInvite(ns, factionName, message, cooldownMs = 5 * 60 * 1000) {
    loopHadDeferredInvite = true;
    const now = Date.now();
    const lastLog = recentFactionInviteDeferrals[factionName] ?? 0;
    if (now - lastLog >= cooldownMs) {
        recentFactionInviteDeferrals[factionName] = now;
        ns.print(message);
    }
    return "deferred";
}

function printNothingToDoStatus(ns, status, cooldownMs = statusUpdateInterval) {
    const now = Date.now();
    if (status == lastNothingToDoStatus && now - lastNothingToDoStatusUpdate < cooldownMs)
        return;
    lastNothingToDoStatus = status;
    lastNothingToDoStatusUpdate = now;
    ns.print(status);
}

function exitAfterDeferredInviteOnlyPass(ns) {
    if (!loopHadDeferredInvite || breakToMainLoop()) return false;
    lastLoopHadDeferredInvite = true;
    printNothingToDoStatus(ns, `INFO: Faction work is blocked by deferred invite requirements. ` +
        `Exiting so hacking/money automation can progress; daemon will retry faction work later.`);
    return true;
}

function recordMoneyGateStatus(factionName, requirement, cash, stockValue) {
    const netWorth = cash + stockValue;
    const missing = Math.max(0, requirement - netWorth);
    if (isBn8() && moneyGateStatus?.factionName == "Daedalus" && factionName != "Daedalus")
        return;
    if (isBn8() && factionName == "Daedalus")
        return moneyGateStatus = { factionName, requirement, cash, stockValue, netWorth, missing };
    if (!moneyGateStatus || missing < moneyGateStatus.missing)
        moneyGateStatus = { factionName, requirement, cash, stockValue, netWorth, missing };
}

function printMoneyGateStatus(ns) {
    const statusPrefix = isBn8() && moneyGateStatus.factionName == "Daedalus" ?
        `INFO: BN8 Daedalus/TRP cash push is waiting for net-worth growth.` :
        `INFO: Waiting for cash/stock growth for money-gated faction invites.`;
    const targetLabel = isBn8() && moneyGateStatus.factionName == "Daedalus" ? "Target" : "Closest";
    const status = `${statusPrefix} ${targetLabel}: "${moneyGateStatus.factionName}" needs ${formatMoney(moneyGateStatus.requirement)}; ` +
        `cash ${formatMoney(moneyGateStatus.cash)}, stock ${formatMoney(moneyGateStatus.stockValue)}, ` +
        `missing net worth ${formatMoney(moneyGateStatus.missing)}.`;
    if (status == lastMoneyGateStatus && Date.now() - lastMoneyGateStatusUpdate < 5 * statusUpdateInterval)
        return;
    lastMoneyGateStatus = status;
    lastMoneyGateStatusUpdate = Date.now();
    ns.print(`${status} Sleeping for 30 seconds.`);
}

function isCompanyInviteFaction(factionName) {
    return preferredCompanyFactionOrder.includes(factionName) || factionName === "Silhouette";
}

function getCompanyInviteHackRequirement(factionName) {
    const itJob = jobs.find(j => j.name == "IT");
    const companyConfig = companySpecificConfigs.find(c => c.name == factionName);
    return (itJob?.reqHck?.[0] || 0) + (companyConfig?.statModifier || 0);
}

function shouldDeferCompanyFaction(player, factionName) {
    if (!isCompanyInviteFaction(factionName) || player.factions.includes(factionName))
        return false;
    if (options['no-company-work'])
        return true;
    return player.skills.hacking < getCompanyInviteHackRequirement(factionName);
}

function canPursueFaction(player, factionName) {
    if (isBn8() && factionName != "Daedalus" && (player.factions.includes("Daedalus") || hasRedPillPurchased))
        return false;
    if (isCompanyInviteFaction(factionName) && factionName !== "Silhouette")
        return !shouldDeferCompanyFaction(player, factionName);
    if (factionName === "Silhouette")
        return !shouldDeferSilhouette(player);
    if (factionName === "Netburners")
        return !shouldDeferNetburners(player);
    return true;
}

function shouldBypassPrioritizeInvitesForFaction(factionName) {
    return currentBitnode == 3 && options['crime-focus'] && factionName == "Slum Snakes";
}

function shouldTreatGraftingAsBackground(factionName = null) {
    return currentBitnode == 3 && (!factionName || factionName == "Daedalus" || factionName == "Slum Snakes");
}

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--first" || lastFlag == "--skip")
        return factions.map(f => f.replaceAll(' ', '_')).sort();
    return [];
}

// Bit of an ugly afterthought, but this is all over the place to break out of whatever we're doing and return to the main loop.
const breakToMainLoop = () => Date.now() > mainLoopStart + checkForNewPrioritiesInterval;

/** @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    scriptPid = ns.pid;
    disableLogs(ns, ['sleep']);
    log(ns, `INFO: work-for-factions.js version ${workForFactionsVersion}`, true, 'info');
    if (!options['no-tail-windows']) {
        tail(ns);
        applyTailLayout(ns);
        ns.atExit(() => ns.ui.closeTail(ns.pid));
    }

    // Reset globals whose value can persist between script restarts in weird situations
    lastTravel = crimeCount = currentBitnode = 0;
    playerInBladeburner = wasGrafting = notifiedAboutDaedalus = false;
    recentHospitalizedLocations = {};
    lastMoneyFallbackStatus = lastNoFactionInfiltrationTargetStatus = "";
    lastNoFactionInfiltrationTargetStatusUpdate = 0;
    lastInfiltrationConsoleStatus = lastMoneyInfiltrationConsoleStatus = "";
    observedInfiltrationRunTimeByLocation = {};
    // Process configuration options
    firstFactions = (options['first'] || []).map(f => f.replaceAll('_', ' ')); // Factions that end up in this list will be prioritized and joined regardless of their augmentations available.
    options.skip = (options.skip || []).map(f => f.replaceAll('_', ' '));
    // Fetch bitnode early so BN-specific defaults can be applied below
    currentBitnode = (await getResetInfoRd(ns)).currentNode;
    // Default desired-stats if none were specified
    if (options['desired-stats'].length == 0)
        options['desired-stats'] = options['crime-focus'] ? ['str', 'def', 'dex', 'agi', 'faction_rep', 'hacknet', 'crime'] :
            currentBitnode == 8 ? ['hacking', 'hacking_exp'] : // BN8: only hack level/exp matter (Daedalus req), money comes from stocks
            ['hacking', 'faction_rep', 'company_rep', 'charisma', 'hacknet', 'crime_money']
    // Default desired-augs if none were specified
    if (options['desired-augs'].length == 0)
        options['desired-augs'] = default_desired_augs;

    // Log some of the options in effect
    ns.print(`--desired-stats matching: ${options['desired-stats'].join(", ")}`);
    ns.print(`--desired-augs: ${options['desired-augs'].join(", ")}`);
    ns.print(`--max-infiltration-difficulty: ${options['max-infiltration-difficulty']} (reduced only when travel is unaffordable)`);
    if (firstFactions.length > 0) ns.print(`--first factions: ${firstFactions.join(", ")}`);
    if (options.skip.length > 0) ns.print(`--skip factions: ${options.skip.join(", ")}`);
    if (options['fast-crimes-only']) ns.print(`--fast-crimes-only`);

    // Find out whether the user can use this script
    dictSourceFiles = await getActiveSourceFiles(ns); // Find out what source files the user has unlocked
    let singularityAvailable = options['singularity-confirmed'] || 4 in dictSourceFiles;
    if (!singularityAvailable)
        return log(ns, "INFO: Skipping faction work automation because Singularity access (SF4) is not unlocked.");
    if (!(4 in dictSourceFiles))
        dictSourceFiles[4] = 3;
    else if (dictSourceFiles[4] < 3)
        log(ns, `WARNING: Singularity functions are much more expensive with lower levels of SF4 (you have SF4.${dictSourceFiles[4]}). ` +
            `You may encounter RAM issues with and have to wait until you have more RAM available to run this script successfully.`, false, 'warning');

    let loadingComplete = false; // In the event of suboptimal RAM conditions, keep trying to start until we succeed
    while (!loadingComplete) {
        try {
            await loadStartupData(ns);
            loadingComplete = true;
        } catch (err) {
            log(ns, 'WARNING: work-for-factions.js caught an unhandled error while starting up. Trying again in 5 seconds...\n' + getErrorInfo(err), false, 'warning');
            await ns.sleep(loopSleepInterval);
        }
    }

    mainLoopStart = Date.now();
    scope = 0;
    while (true) { // After each loop, we will repeat all prevous work "strategies" to see if anything new has been unlocked, and add one more "strategy" to the queue
        try {
            if (await mainLoop(ns) == "deferred-idle")
                return;
        } catch (err) {
            log(ns, 'WARNING: work-for-factions.js caught an unhandled error in its main loop. Trying again in 5 seconds...\n' + getErrorInfo(err), false, 'warning');
            await ns.sleep(loopSleepInterval);
            scope--; // Cancel out work scope increasing on the next iteration.
        }
        await ns.sleep(1); // Infinite loop protection in case somehow we loop without doing any meaningful work
    }
}

/** @param {NS} ns */
async function loadStartupData(ns) {
    const playerInfo = await getPlayerInfo(ns);
    currentBitnode = (await getResetInfoRd(ns)).currentNode;
    const allKnownFactions = factions.concat(playerInfo.factions.filter(f => !factions.includes(f)));
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    // Get some faction and augmentation information to decide what remains to be purchased
    dictFactionFavors = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getFactionFavor(o)'), '/Temp/getFactionFavors.txt', allKnownFactions);
    const dictFactionAugs = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getAugmentationsFromFaction(o)'), '/Temp/getAugmentationsFromFactions.txt', allKnownFactions);
    if (dictFactionAugs[shadowsOfAnarchy])
        dictFactionAugs[shadowsOfAnarchy] = dictFactionAugs[shadowsOfAnarchy].filter(a => a == soaWksHarmonizer);
    const augmentationNames = [...new Set(Object.values(dictFactionAugs).flat())];
    const dictAugRepReqs = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getAugmentationRepReq(o)'), '/Temp/getAugmentationRepReqs.txt', augmentationNames);
    const dictAugPrices = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getAugmentationPrice(o)'), '/Temp/getAugmentationPrices.txt', augmentationNames);
    const dictAugStats = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getAugmentationStats(o)'), '/Temp/getAugmentationStats.txt', augmentationNames);
    const installedAugmentations = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations()`, '/Temp/player-augs-installed.txt');
    const purchasedAugmentations = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(true)`, '/Temp/player-augs-purchased.txt');
    await refreshNetburnersEligibility(ns);
    // Based on what augmentations we own, we can change our own behaviour (e.g. whether to allow work to steal focus)
    hasFocusPenalty = !installedAugmentations.includes("Neuroreceptor Management Implant"); // Check if we have an augmentation that lets us not have to focus at work (always nicer if we can background it)
    shouldFocus = !options['no-focus'] && hasFocusPenalty; // Focus at work for the best rate of rep gain, unless focus activities are disabled via command line
    hasSimulacrum = installedAugmentations.includes("The Blade's Simulacrum");
    hasRedPillPurchased = purchasedAugmentations.includes("The Red Pill");

    // Find out if we're in a gang
    const gangInfo = await getGangInfo(ns);
    playerGang = gangInfo ? gangInfo.faction : null;
    if (playerGang && !options['disable-treating-gang-as-sole-provider-of-its-augs']) {
        // Whatever augmentations the gang provides are so easy to get from them, might as well ignore any other factions that have them.
        const gangAugs = dictFactionAugs[playerGang];
        const protectedGangAugs = new Set(options['desired-augs'].filter(aug => !installedAugmentations.includes(aug)));
        ns.print(`Your gang ${playerGang} provides easy access to ${gangAugs.length} augs. Ignoring these augs from the original factions that provide them` +
            (protectedGangAugs.size > 0 ? `, except uninstalled desired augs: ${[...protectedGangAugs].join(", ")}.` : `.`));
        for (const faction of allKnownFactions.filter(f => f != playerGang))
            dictFactionAugs[faction] = dictFactionAugs[faction].filter(a => !gangAugs.includes(a) || protectedGangAugs.has(a));
    }

    // Treat "awaiting install" augmentations as still relevant for faction progression in the current reset.
    const isRelevantAug = aug => aug !== strNF && !installedAugmentations.includes(aug);
    const isDesiredAug = aug => isRelevantAug(aug) && (
        options['desired-augs'].includes(aug) ||
        Object.keys(dictAugStats[aug]).length == 0 || options['desired-stats'].length == 0 ||
        Object.keys(dictAugStats[aug]).some(key => options['desired-stats'].some(stat => key.includes(stat)) && dictAugStats[aug][key] > 1)
    );

    mostExpensiveAugByFaction = Object.fromEntries(allKnownFactions.map(f => [f,
        dictFactionAugs[f].filter(isRelevantAug)
            .reduce((max, aug) => Math.max(max, dictAugRepReqs[aug]), -1)]));
    //ns.print("Most expensive unowned aug by faction: " + JSON.stringify(mostExpensiveAugByFaction));
    // TODO: Detect when the most expensive aug from two factions is the same - only need it from the first one. (Update lists and remove 'afforded' augs?)
    mostExpensiveDesiredAugByFaction = Object.fromEntries(allKnownFactions.map(f => [f,
        dictFactionAugs[f].filter(isDesiredAug)
            .reduce((max, aug) => Math.max(max, dictAugRepReqs[aug]), -1)]));
    mostExpensiveDesiredAugCostByFaction = Object.fromEntries(allKnownFactions.map(f => [f,
        dictFactionAugs[f].filter(isDesiredAug)
            .reduce((max, aug) => Math.max(max, dictAugPrices[aug]), -1)]));
    //ns.print("Most expensive desired aug by faction: " + JSON.stringify(mostExpensiveDesiredAugByFaction));

    // Filter out factions who have no augs (or tentatively filter those with no desirable augs) unless otherwise configured. The exception is
    // we will always filter the most-precluding city factions, (but not ["Chongqing", "New Tokyo", "Ishima"], which can all be joined simultaneously)
    // TODO: Think this over more. need to filter e.g. chonquing if volhaven is incomplete...
    const filterableFactions = (options['get-invited-to-every-faction'] ? ["Aevum", "Sector-12", "Volhaven"] : allKnownFactions);
    // Unless otherwise configured, we will skip factions with no remaining augmentations
    completedFactions = filterableFactions.filter(fac => mostExpensiveAugByFaction[fac] == -1);
    softCompletedFactions = filterableFactions.filter(fac => mostExpensiveDesiredAugByFaction[fac] == -1 && !completedFactions.includes(fac));
    const bn3CrimeRepSkips = currentBitnode == 3 && options['crime-focus'] && !options['get-invited-to-every-faction'] ?
        bn3DefaultSkippedCrimeRepFactions : [];
    skipFactions = options.skip.concat(bn3CrimeRepSkips).concat(cannotWorkForFactions).concat(completedFactions).filter(fac => !firstFactions.includes(fac));
    if (bn3CrimeRepSkips.length > 0)
        ns.print(`BN3 crime-focus: skipping long combat/crime faction rep grinds by default: ${bn3CrimeRepSkips.filter(f => !firstFactions.includes(f)).join(", ")}`);
    if (completedFactions.length > 0)
        ns.print(`${completedFactions.length} factions will be skipped (for having no remaining relevant augs): ${completedFactions.join(", ")}`);
    if (softCompletedFactions.length > 0)
        ns.print(`${softCompletedFactions.length} factions will initially be skipped (all desired augs purchased): ${softCompletedFactions.join(", ")}`);

    // TODO: If --prioritize-invites is set, we should have a preferred faction order that puts easiest-invites-to-earn at the front (e.g. all city factions)
    numJoinedFactions = playerInfo.factions.length;
    fulcrumHackReq = await getServerRequiredHackLevel(ns, "fulcrumassets");
}

let lastMainLoopMessage = "";

/** @param {NS} ns */
async function mainLoop(ns) {
    if (!breakToMainLoop() && !lastLoopHadDeferredInvite) scope++; // Increase scope only after a clean no-work pass.
    lastLoopHadDeferredInvite = false;
    loopHadDeferredInvite = false;
    scope = Math.min(scope, 10);
    mainLoopStart = Date.now();
    // If changing our loop scope, log a message
    const loopMessage = `INFO: Currently work scope is anything <= priority level: ${scope}`;
    if (loopMessage != lastMainLoopMessage)
        ns.print((lastMainLoopMessage = loopMessage));

    // Update information that may have changed since our last loop
    const player = await getPlayerInfo(ns);
    const resetInfo = await getResetInfoRd(ns);
    currentBitnode = resetInfo.currentNode;
    await stopBn8PaidWorkIfCashIsLow(ns, player);
    if (player.factions.length > numJoinedFactions) { // If we've recently joined a new faction, reset our work scope
        scope = 1; // Back to basics until we've satisfied all highest-priority work
        numJoinedFactions = player.factions.length;
    }
    // Immediately accept any outstanding faction invitations for factions we want to earn rep with soon
    // TODO: If check if we would qualify for an invite to any factions just by travelling, and do so to start earning passive rep
    const invites = await checkFactionInvites(ns);
    const invitesToAccept = options['get-invited-to-every-faction'] || options['prioritize-invites'] ?
        invites.filter(f => !skipFactions.includes(f)) :
        invites.filter(f => !skipFactions.includes(f) && !softCompletedFactions.includes(f));
    for (const invite of invitesToAccept)
        await tryJoinFaction(ns, invite);
    await closeTransientGameWindows(ns);
    // Get some information about gangs (if unlocked)
    if (2 in dictSourceFiles) {
        if (!playerGang) { // Check if we've joined a gang since our last iteration
            const gangInfo = await getGangInfo(ns);
            playerGang = gangInfo ? gangInfo.faction : null;
            // If we've only just now joined a gang, we have to reload startup data, because the augs offered by our gang faction has now changed.
            if (playerGang) await loadStartupData(ns);
        }
        if (ns.heart.break() <= options['karma-threshold-for-gang-invites']) { // Start trying to earn gang faction invites if we're close to unlocking gangs
            if (!playerGang) {
                log(ns, `INFO: We are nearing the Karma required to unlock gangs (${formatNumberShort(ns.heart.break())} / -54K). Prioritize earning gang faction invites.`);
                for (const factionName of desiredGangFactions)
                    await earnFactionInvite(ns, factionName);
            }
        }
    }
    // If something outside of this script is stealing player focus, decide whether to allow it
    if (await isValidInterruption(ns))
        return (await ns.sleep(loopSleepInterval));
    // If we recently grafted an augmentation, it might be one that changes our behaviour, so re-load startup data
    if (wasGrafting) {
        await loadStartupData(ns);
        wasGrafting = false;
    }
    if (options['infiltrate-for-money-under'] > 0 && player.money < options['infiltrate-for-money-under']) {
        await workForInfiltrationMoney(ns, options['infiltrate-for-money-under']);
        return;
    }
    await refreshNetburnersEligibility(ns);
    moneyGateStatus = null;

    // Remove Fulcrum from our "EarlyFactionOrder" if hack level is insufficient to backdoor their server
    let priorityFactions = options['crime-focus'] ? preferredCrimeFactionOrder.slice() : preferredEarlyFactionOrder.slice();
    if (player.skills.hacking < fulcrumHackReq - 10) { // Assume that if we're within 10, we'll get there by the time we've earned the invite
        const fulcrumIdx = priorityFactions.findIndex(c => c == "Fulcrum Secret Technologies")
        if (fulcrumIdx !== -1) {
            priorityFactions.splice(fulcrumIdx, 1);
            ns.print(`Fulcrum faction server requires ${fulcrumHackReq} hack, so removing from our initial priority list for now.`);
        }
    } // TODO: Otherwise, if we get Fulcrum, we have no need for a couple other company factions
    // If we're in BN 10, we can purchase special Sleeve-related things from the Covenant, so we should always try join it
    if (currentBitnode == 10 && !priorityFactions.includes("The Covenant") &&
        !completedFactions.includes("The Covenant") && !softCompletedFactions.includes("The Covenant")) {
        priorityFactions.push("The Covenant");
        ns.print(`We're in BN10, which means we should add The Covenant to our priority faction list, so you can purchase sleeves and sleeve memory.`);
    }
    if (shouldDeferSilhouette(player))
        priorityFactions = priorityFactions.filter(f => f != "Silhouette");

    // Strategy 1: Tackle a consolidated list of desired faction order, interleaving simple factions and megacorporations
    const pinnedFirstFactions = options['crime-focus'] || skipFactions.includes("Sector-12") ? firstFactions : ["Sector-12"].concat(firstFactions.filter(f => f != "Sector-12"));
    const factionWorkOrder = pinnedFirstFactions.concat(priorityFactions.filter(f => // Remove factions from our initial "work order" if we've bought all desired augmentations.
        !pinnedFirstFactions.includes(f) && !skipFactions.includes(f) && !softCompletedFactions.includes(f) && canPursueFaction(player, f)));
    for (const faction of factionWorkOrder) {
        if (breakToMainLoop()) break; // Only continue on to the next faction if it isn't time for a high-level update.
        let earnedNewFactionInvite = false;
        if (!options['no-company-work'] && preferredCompanyFactionOrder.includes(faction)) // If this is a company faction, we need to work for the company first
            earnedNewFactionInvite = await workForMegacorpFactionInvite(ns, faction, true);
        // If new work was done for a company or their faction, restart the main work loop to see if we've since unlocked a higher-priority faction in the list
        if (earnedNewFactionInvite || await workForSingleFaction(ns, faction)) {
            scope--; // De-increment scope so that effecitve scope doesn't increase on the next loop (i.e. it will be incremented back to what it is now)
            return;
        }
    }
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 1 || breakToMainLoop()) return;

    // Strategy 2: Grind XP with all priority factions that are joined or can be joined, until every single one has desired REP
    if (await workForFirstActionableFaction(ns, factionWorkOrder, faction => workForSingleFaction(ns, faction)))
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 2 || breakToMainLoop()) return;

    // Strategy 3: Work for any megacorporations not yet completed to earn their faction invites. Once joined, we don't lose these factions on reset.
    let megacorpFactions = preferredCompanyFactionOrder.filter(f => !skipFactions.includes(f) && canPursueFaction(player, f));
    if (!options['no-company-work'])
        await workForAllMegacorps(ns, megacorpFactions, false);
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 3 || breakToMainLoop()) return;

    // Strategy 4: Work for megacorps again, but this time also work for the company factions once the invite is earned
    if (!options['no-company-work'])
        await workForAllMegacorps(ns, megacorpFactions, true);
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 4 || breakToMainLoop()) return;

    // Strategies 5+ now work towards getting an invite to *all factions in the game*
    let joinedFactions = player.factions; // In case our hard-coded list of factions is missing anything, merge it with the list of all factions
    let knownFactions = factions.concat(joinedFactions.filter(f => !factions.includes(f)));
    let allIncompleteFactions = knownFactions.filter(f => !skipFactions.includes(f) && !completedFactions.includes(f) && canPursueFaction(player, f))
        .sort((a, b) => mostExpensiveAugByFaction[a] - mostExpensiveAugByFaction[b]); // sort by least-expensive final aug (correlated to easiest faction-invite requirement)
    // Preserve the faction work order we've decided on previously, and only use the above sort order for every other faction added on to the end
    let allFactionsWorkOrder = factionWorkOrder.filter(f => allIncompleteFactions.includes(f))
        .concat(allIncompleteFactions.filter(f => !factionWorkOrder.includes(f)));
    // Strategy 5: For *all factions in the game*, try to earn an invite and work for rep until we can afford the most-expensive *desired* aug.
    if (await workForFirstActionableFaction(ns, allFactionsWorkOrder.filter(f => !softCompletedFactions.includes(f)), faction => workForSingleFaction(ns, faction)))
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 5 || breakToMainLoop()) return;

    // Strategy 6: Grind rep for all factions until donations are unlocked - so next reset we don't need to grind rep, just donate.
    // Reversed order: factions with highest aug rep reqs take the most time, do them last (most likely to be cut short).
    let allFactionsWorkOrderReversed = factionWorkOrder.filter(f => allIncompleteFactions.includes(f))
        .concat(allIncompleteFactions.reverse().filter(f => !factionWorkOrder.includes(f)));
    if (await workForFirstActionableFaction(ns, allFactionsWorkOrderReversed, faction => workForSingleFaction(ns, faction, false, false, false, true))) // forceUnlockDonations = true
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 6 || breakToMainLoop()) return;

    // Strategy 7: Revisit all factions until each has enough rep for its most expensive useful aug.
    if (await workForFirstActionableFaction(ns, allFactionsWorkOrderReversed, faction => workForSingleFaction(ns, faction, false, true))) // ForceBestAug = true
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 7 || breakToMainLoop()) return;

    // Strategy 8: Next, revisit all factions and grind XP until we can afford the most expensive aug on this install.
    if (await workForFirstActionableFaction(ns, allFactionsWorkOrder, faction => workForSingleFaction(ns, faction, true, true))) // ForceBestAug = true
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 8 || breakToMainLoop()) return;

    // Strategy 9: Final rep pass with forceRep enabled so already-joined factions are not skipped by any earlier heuristic.
    if (await workForFirstActionableFaction(ns, allFactionsWorkOrder, faction => workForSingleFaction(ns, faction, false, true, true))) // ForceRep = true
        return;
    if (exitAfterDeferredInviteOnlyPass(ns)) return "deferred-idle";
    if (scope <= 9 || breakToMainLoop()) return;

    // Strategy 10: Busy ourselves for a while longer, then loop to see if there anything more we can do for the above factions
    let factionsWeCanWorkFor = joinedFactions.filter(f => !options.skip.includes(f) && !cannotWorkForFactions.includes(f) &&
        !passiveInfiltrationFactions.includes(f) && f != playerGang);
    let foundWork = false;
    const factionsNeedingMoreRep = factionsWeCanWorkFor
        .filter(f => (mostExpensiveAugByFaction[f] || -1) > 0)
        .sort((a, b) => (dictFactionFavors[b] || 0) - (dictFactionFavors[a] || 0));
    // If there is still a relevant non-NeuroFlux aug to unlock somewhere, do a little extra work there.
    if (factionsNeedingMoreRep.length > 0 && !options['crime-focus']) { // Unless we've been asked to prioritize crime (e.g. for Karma)
        let mostFavorFaction = factionsNeedingMoreRep[0];
        let currentRep = await getFactionReputation(ns, mostFavorFaction);
        let targetRep = Math.min(mostExpensiveAugByFaction[mostFavorFaction], 1000 + currentRep * 1.05); // Grow rep by ~5%, but never past the last relevant aug.
        if (targetRep > currentRep) {
            ns.print(`INFO: All useful work nearly complete. Grinding up to ${formatNumberShort(targetRep)} rep ` +
                `with highest-favor useful faction: ${mostFavorFaction} (${(dictFactionFavors[mostFavorFaction] || 0).toFixed(2)} favor)`);
            foundWork = await workForSingleFaction(ns, mostFavorFaction, false, false, targetRep);
        }
    }
    if (!foundWork) { // If our hands are tied, wait and re-check later rather than farming money with no explicit target.
        if (allIncompleteFactions.length == 0 && factionsNeedingMoreRep.length == 0)
            ns.print(`INFO: Nothing to do. All relevant factions are already complete or intentionally skipped. Sleeping for 30 seconds.`);
        else if (moneyGateStatus)
            printMoneyGateStatus(ns);
        else
            printNothingToDoStatus(ns, `INFO: Nothing actionable for faction work right now. Waiting 30 seconds for ` +
                `background hacking/money/invite progress before rechecking.`);
        await ns.sleep(30000);
    }
    if (scope <= 10) scope--; // Cap the 'scope' value from increasing perpetually when we're on our last strategy
}

async function workForFirstActionableFaction(ns, factionOrder, workFn) {
    for (const faction of factionOrder) {
        if (breakToMainLoop()) return false;
        if (await workFn(faction)) {
            scope--; // Keep the next loop at the same strategy level and restart from the top of the ordered list.
            return true;
        }
    }
    return false;
}

// Ram-dodging helper, runs a command for all items in a list and returns a dictionary.
const dictCommand = (command) => `Object.fromEntries(ns.args.map(o => [o, ${command}]))`;

function isBn8() {
    return currentBitnode == 8;
}

function hasBn8CashBuffer(player, additionalSpend = 0) {
    return !isBn8() || player.money - additionalSpend >= bn8CashReserve;
}

/** @param {NS} ns */
async function stopBn8PaidWorkIfCashIsLow(ns, player = null) {
    if (!isBn8()) return false;
    player = player || await getPlayerInfo(ns);
    if (player.money >= bn8CashReserve) return false;
    const currentWork = await getCurrentWorkInfo(ns);
    if (currentWork?.type != "CLASS") return false;
    await stop(ns);
    log(ns, `WARNING: Stopped paid training/studying in BN8 because cash fell below ${formatMoney(bn8CashReserve)} ` +
        `(current ${formatMoney(player.money)}).`, false, 'warning');
    return true;
}

const requiredMoneyByFaction = {
    "Tian Di Hui": 1E6, "Sector-12": 15E6, "Chongqing": 20E6, "New Tokyo": 20E6, "Ishima": 30E6, "Aevum": 40E6, "Volhaven": 50E6,
    "Slum Snakes": 1E6, "Silhouette": 15E6, "The Syndicate": 10E6, "The Covenant": 75E9, "Daedalus": 100E9, "Illuminati": 150E9
};
const requiredBackdoorByFaction = { "CyberSec": "CSEC", "NiteSec": "avmnite-02h", "The Black Hand": "I.I.I.I", "BitRunners": "run4theh111z", "Fulcrum Secret Technologies": "fulcrumassets" };
const requiredHackByFaction = { "Tian Di Hui": 50, "Netburners": 80, "Speakers for the Dead": 100, "The Syndicate": 200, "The Dark Army": 300, "The Covenant": 850, "Daedalus": 2500, "Illuminati": 1500 };
const requiredCombatByFaction = { "Slum Snakes": 30, "Tetrads": 75, "Speakers for the Dead": 300, "The Syndicate": 200, "The Dark Army": 300, "The Covenant": 850, "Daedalus": 1500, "Illuminati": 1200 };
const requiredKarmaByFaction = { "Slum Snakes": 9, "Tetrads": 18, "Silhouette": 22, "Speakers for the Dead": 45, "The Dark Army": 45, "The Syndicate": 90 };
const requiredKillsByFaction = { "Speakers for the Dead": 30, "The Dark Army": 5 };
const reqHackingOrCombat = ["Daedalus"]; // Special case factions that require only hacking or combat stats, not both

// Establish some helper functions used to determine how fast we can train a stat
const title = s => s && s[0].toUpperCase() + s.slice(1); // Annoyingly bitnode multis capitalize the first letter physical stat name
/** Return the product of all multipliers affecting training the specified stat.
 * @param {Player} player @param {string} stat @param {number} trainingBitnodeMult */
function heuristic(player, stat, trainingBitnodeMult) {
    return Math.sqrt(player.mults[stat] * bitNodeMults[`${title(stat)}LevelMultiplier`] *
        /* */ player.mults[`${stat}_exp`] * trainingBitnodeMult);
}
/** A heuristic for how long it'll take to train the specified stat via Crime. @param {Player} player @param {string} stat @param */
const crimeHeuristic = (player, stat) => heuristic(player, stat, bitNodeMults.CrimeExpGain); // When training with crime
/** A heuristic for how long it'll take to train the specified stat via Class or Gym. @param {Player} player @param {string} stat @param */
const classHeuristic = (player, stat) => heuristic(player, stat, bitNodeMults.ClassGymExpGain); // When training in university

/** @param {NS} ns */
async function refreshNetburnersEligibility(ns) {
    const [nodeCount, totalLevels, totalRam, totalCores] = await getNsDataThroughFile(ns,
        '(() => {' +
        'const nodes = [...Array(ns.hacknet.numNodes()).keys()].map(i => ns.hacknet.getNodeStats(i));' +
        'return [nodes.length, ...nodes.reduce(([l, r, c], s) => [l + s.level, r + s.ram, c + s.cores], [0, 0, 0])];' +
        '})()',
        '/Temp/hacknet-Netburners-stats.txt');
    netburnersEligibility = {
        nodes: nodeCount,
        levels: totalLevels,
        ram: totalRam,
        cores: totalCores,
        ready: nodeCount > 0 && totalLevels >= 100 && totalRam >= 8 && totalCores >= 4,
    };
}

/** @param {NS} ns */
async function earnFactionInvite(ns, factionName) {
    let player = await getPlayerInfo(ns);
    const joinedFactions = player.factions;
    if (joinedFactions.includes(factionName)) return "existing";
    if (!canPursueFaction(player, factionName)) {
        if (factionName == "Silhouette" && options['no-company-work'])
            return ns.print(`Deferring faction "Silhouette" because --no-company-work prevents earning its invite.`);
        if (isCompanyInviteFaction(factionName) && factionName !== "Silhouette") {
            const requiredHack = getCompanyInviteHackRequirement(factionName);
            if (options['no-company-work'])
                return ns.print(`Deferring faction "${factionName}" because --no-company-work prevents earning its invite.`);
            return ns.print(`Deferring faction "${factionName}" until hack level is at least ${requiredHack} ` +
                `so company work can start immediately (current Hack ${player.skills.hacking}).`);
        }
        if (factionName == "Silhouette") {
            const maxCompanyStatModifier = Math.max(...companySpecificConfigs.map(c => c.statModifier || 0));
            const requiredHack = Math.max(...jobs.flatMap(job => job.reqHck).filter(req => req > 0)) + maxCompanyStatModifier;
            const requiredCha = Math.max(...jobs.flatMap(job => job.reqCha).filter(req => req > 0)) + maxCompanyStatModifier;
            return ns.print(`Deferring faction "Silhouette" until we're closer to executive company requirements. ` +
                `Need roughly Hack ${requiredHack - silhouetteStatDeferralMargin}+ and Cha ${requiredCha - silhouetteStatDeferralMargin}+ ` +
                `(current Hack ${player.skills.hacking}, Cha ${player.skills.charisma}).`);
        }
        if (factionName == "Netburners") {
            const requiredHack = requiredHackByFaction["Netburners"] || 0;
            if (player.skills.hacking < requiredHack)
                return deferFactionInvite(ns, factionName, `Deferring faction "Netburners" until hack level is at least ${requiredHack} ` +
                    `(current Hack ${player.skills.hacking}).`);
        }
    }
    var invitations = await checkFactionInvites(ns);
    if (invitations.includes(factionName))
        return await tryJoinFaction(ns, factionName);

    // Can't join certain factions for various reasons
    let reasonPrefix = `Cannot join faction "${factionName}" because`;
    let precludingFaction;
    if (["Aevum", "Sector-12"].includes(factionName) && (precludingFaction = ["Chongqing", "New Tokyo", "Ishima", "Volhaven"].find(f => joinedFactions.includes(f))) ||
        ["Chongqing", "New Tokyo", "Ishima"].includes(factionName) && (precludingFaction = ["Aevum", "Sector-12", "Volhaven"].find(f => joinedFactions.includes(f))) ||
        ["Volhaven"].includes(factionName) && (precludingFaction = ["Aevum", "Sector-12", "Chongqing", "New Tokyo", "Ishima"].find(f => joinedFactions.includes(f))))
        return ns.print(`${reasonPrefix} precluding faction "${precludingFaction}"" has been joined.`);
    let requirement;
    // See if we can take action to earn an invite for the next faction under consideration
    let workedForInvite = false;
    // If committing crimes can help us join a faction - we know how to do that
    let doCrime = false;
    let currentNegativeKarma = -ns.heart.break();
    if ((requirement = requiredKarmaByFaction[factionName]) && currentNegativeKarma <= requirement) {
        ns.print(`${reasonPrefix} you have insufficient Karma. Need: -${requirement}, Have: -${currentNegativeKarma}`);
        doCrime = true;
    }
    if ((requirement = requiredKillsByFaction[factionName]) && player.numPeopleKilled <= requirement) {
        ns.print(`${reasonPrefix} you have insufficient kills. Need: ${requirement}, Have: ${player.numPeopleKilled}`);
        doCrime = true;
    }
    // Check on physical stat requirements
    const physicalStats = ["strength", "defense", "dexterity", "agility"];
    // Check which stats need to be trained up
    requirement = requiredCombatByFaction[factionName];
    let deficientStats = !requirement ? [] : physicalStats.map(stat => ({ stat, value: player.skills[stat] })).filter(stat => stat.value < requirement);
    const hackHeuristic = classHeuristic(player, 'hacking');
    const crimeHeuristics = Object.fromEntries(physicalStats.map(s => [s, crimeHeuristic(player, s)]));
    // Hash for special-case factions (just 'Daedalus' for now) requiring *either* hacking *or* combat
    const isHackingOrCombatFaction = reqHackingOrCombat.includes(factionName);
    let optionalCombatTraining = null;
    if (isHackingOrCombatFaction && deficientStats.length > 0)
        optionalCombatTraining = getCombatTrainingAssessment(player, requirement);
    const optionalCombatTrainingTooLong = optionalCombatTraining &&
        shouldDeferOptionalCombatTraining(factionName, optionalCombatTraining.plan);
    if (isHackingOrCombatFaction && deficientStats.length > 0 && (
        optionalCombatTrainingTooLong ||
        // Compare roughly how long it will take to train up our hacking stat
        (requiredHackByFaction[factionName] - player.skills.hacking) / hackHeuristic <
        // To the slowest time it will take to train up our deficient physical stats
        Math.min(...deficientStats.map(s => (requiredCombatByFaction[factionName] - s.value) / crimeHeuristics[s.stat])))) {
        if (optionalCombatTrainingTooLong)
            deferFactionInvite(ns, factionName, `Deferring optional combat route for "${factionName}": gym training ETA ` +
                `${formatDuration(optionalCombatTraining.plan.sequentialEtaMs)} exceeds practical threshold ` +
                `${formatDuration(maxOptionalCombatTrainingEtaMs)}. Continuing toward hacking invite path instead.`);
        else
            ns.print(`Ignoring combat requirement for ${factionName} as we are more likely to unlock them via hacking stats.`);
    }
    else if (deficientStats.length > 0) {
        ns.print(`${reasonPrefix} you have insufficient combat stats. Need: ${requirement} of each, Have ` +
            physicalStats.map(s => `${s.slice(0, 3)}: ${player.skills[s]}`).join(", "));
        const needsKills = (requiredKillsByFaction[factionName] || 0) > player.numPeopleKilled;
        const needsKarma = (requiredKarmaByFaction[factionName] || 0) > currentNegativeKarma;
        const maxCombatGap = Math.max(...deficientStats.map(s => requirement - s.value));
        const deferCombatGap = Math.max(25, Math.floor(requirement * 0.15));
        if (options['prioritize-invites'] && !needsKills && !needsKarma && maxCombatGap > deferCombatGap)
            return ns.print(`Deferring faction "${factionName}" invite because only combat training remains and the gap is still large ` +
                `(${maxCombatGap} levels, threshold ${deferCombatGap}) while --prioritize-invites is enabled.`);
        if (!needsKills && !needsKarma) {
            workedForInvite = await trainCombatStatsUpTo(ns, requirement, factionName);
        } else {
            ns.print(`Using crimes only for kills/karma for "${factionName}"; combat stat gaps will be trained at the gym.`);
            doCrime = true;
        }
    }
    if (doCrime && options['no-crime'])
        return ns.print(`${reasonPrefix} Doing crime to meet faction requirements is disabled. (--no-crime or --no-focus)`);
    if (doCrime) {
        const combatRequirement = requiredCombatByFaction[factionName] || 0;
        const currentCombatGap = combatRequirement ? Math.max(...["strength", "defense", "dexterity", "agility"]
            .map(stat => combatRequirement - player.skills[stat])) : 0;
        const deferCombatGap = Math.max(25, Math.floor(combatRequirement * 0.15));
        const crimeCombatTarget = 0;
        if (combatRequirement && currentCombatGap > 0 && options['prioritize-invites'] && currentCombatGap > deferCombatGap)
            ns.print(`Using crimes only for kills/karma for "${factionName}" and deferring long combat gym training ` +
                `(${currentCombatGap} levels, threshold ${deferCombatGap}) while --prioritize-invites is enabled.`);
        workedForInvite = await crimeForKillsKarmaStats(ns, requiredKillsByFaction[factionName] || 0, requiredKarmaByFaction[factionName] || 0, crimeCombatTarget);
        if (workedForInvite && combatRequirement > 0) {
            const updatedPlayer = await getPlayerInfo(ns);
            const stillNeedsCombat = ["strength", "defense", "dexterity", "agility"].some(stat => updatedPlayer.skills[stat] < combatRequirement);
            if (stillNeedsCombat && !(options['prioritize-invites'] && currentCombatGap > deferCombatGap))
                workedForInvite = await trainCombatStatsUpTo(ns, combatRequirement, factionName);
        }
    }

    // Study for hack levels if that's what's keeping us
    // Note: Check if we have insuffient hack to backdoor this faction server. If we have sufficient hack, we will "waitForInvite" below assuming an external script is backdooring ASAP
    let serverReqHackingLevel = 0;
    if (requirement = requiredBackdoorByFaction[factionName]) {
        serverReqHackingLevel = await getServerRequiredHackLevel(ns, requirement);
        if (player.skills.hacking < serverReqHackingLevel) {
            ns.print(`${reasonPrefix} you must first backdoor ${requirement}, which needs hack: ${serverReqHackingLevel}, Have: ${player.skills.hacking}`);
        }
    }
    requirement = Math.max(serverReqHackingLevel, requiredHackByFaction[factionName] || 0)
    if (requirement && player.skills.hacking < requirement &&
        // Special case (Daedalus): Don't grind for hack requirement if we previously did a grind for the physical requirements
        !(reqHackingOrCombat.includes(factionName) && workedForInvite)) {
        const em = requirement / options['training-stat-per-multi-threshold'];
        if (options['no-studying'])
            return deferFactionInvite(ns, factionName, `${reasonPrefix} you have insufficient hack level. Need: ${requirement}, ` +
                `Have: ${player.skills.hacking}. --no-studying is set, nothing we can do to improve hack level.`);
        if (hackHeuristic < em)
            return deferFactionInvite(ns, factionName, `Deferring faction "${factionName}" invite because hacking training is currently impractical. ` +
                `Need hack ${requirement}, have ${player.skills.hacking}. Hacking mult ${formatNumberShort(player.mults.hacking)}, exp_mult ` +
                `(${formatNumberShort(player.mults.hacking_exp)}), and bitnode hacking / study exp mults ` +
                `(${formatNumberShort(bitNodeMults.HackingLevelMultiplier)}) / (${formatNumberShort(bitNodeMults.ClassGymExpGain)}) ` +
                `give heuristic ${hackHeuristic}, below threshold ${formatNumberShort(em, 2)}. ` +
                `Background hacking/augmentations should improve this; configure with --training-stat-per-multi-threshold if desired.`);
        ns.print(`${reasonPrefix} you have insufficient hack level. Need: ${requirement}, Have: ${player.skills.hacking}`);
        let studying = false;
        const focusStudy = shouldFocus === undefined ? true : shouldFocus;
        if (player.money > options['pay-for-studies-threshold']) { // If we have sufficient money, pay for the best studies
            if (player.city != "Volhaven") await goToCity(ns, "Volhaven");
            studying = await study(ns, focusStudy, "Algorithms");
        } else if (uniByCity[player.city]) // Otherwise only go to free university if our city has a university
            studying = await study(ns, focusStudy, "Computer Science");
        else
            return ns.print(`You have insufficient money (${formatMoney(player.money)} < --pay-for-studies-threshold ` +
                `${formatMoney(options['pay-for-studies-threshold'])}) to travel or pay for studies, and your current ` +
                `city ${player.city} does not have a university from which to take free computer science.`);
        if (studying && focusStudy && !options['no-tail-windows'])
            tail(ns);
        if (studying)
            workedForInvite = await monitorStudies(ns, 'hacking', requirement);
        // If we studied for hacking, and were awaiting a backdoor, spawn the backdoor script now
        if (workedForInvite && serverReqHackingLevel) {
            player = await getPlayerInfo(ns);
            if (player.skills.hacking > requirement) {
                ns.print(`Current hacking level ${player.skills.hacking} seems to now meet the backdoor requirement ${requirement}. Spawning backdoor-all-servers.js...`);
                ns.run(getFilePath("/Tasks/backdoor-all-servers.js"));
            }
        }
    }
    if (breakToMainLoop()) return false;

    if ((requirement = requiredMoneyByFaction[factionName]) && player.money < requirement) {
        const stockValue = await getStocksValue(ns);
        const netWorth = player.money + stockValue;
        if (isBn8() && netWorth >= requirement * 1.001) {
            const pid = ns.run(getFilePath('stockmaster.js'), 1, '--liquidate');
            if (!pid)
                return ns.print(`${reasonPrefix} you have insufficient cash and failed to launch stock liquidation. ` +
                    `Need: ${formatMoney(requirement)}, Cash: ${formatMoney(player.money)}, Stock: ${formatMoney(stockValue)}.`);
            ns.print(`Liquidating ${formatMoney(stockValue)} in stocks to meet "${factionName}" money requirement. ` +
                `Need: ${formatMoney(requirement)}, Cash: ${formatMoney(player.money)}, Net worth: ${formatMoney(netWorth)}.`);
            await waitForProcessToComplete(ns, pid);
            player = await getPlayerInfo(ns);
        }
        if (player.money < requirement)
            recordMoneyGateStatus(factionName, requirement, player.money, stockValue);
        if (player.money < requirement && isBn8())
            return "deferred";
        if (player.money < requirement)
            return deferFactionInvite(ns, factionName, `${reasonPrefix} you have insufficient money. Need: ${formatMoney(requirement)}, ` +
                `Cash: ${formatMoney(player.money)}, Stock: ${formatMoney(stockValue)}, Missing net worth: ${formatMoney(Math.max(0, requirement - netWorth))}.`, 60 * 1000);
    }

    // If travelling can help us join a faction - we can do that too
    player = await getPlayerInfo(ns);
    let travelledForInvite = false;
    let travelToCityOrDidRecently = async city => // Helper to consider us as having travelled for an invite if we did just now, or recently
        player.city != city && await goToCity(ns, city) || player.city == city && (Date.now() - lastTravel < 60000)
    if (['Tian Di Hui', 'Tetrads', 'The Dark Army'].includes(factionName))
        travelledForInvite = await travelToCityOrDidRecently('Chongqing');
    else if (['The Syndicate'].includes(factionName))
        travelledForInvite = await travelToCityOrDidRecently('Sector-12');
    else if (["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"].includes(factionName))
        travelledForInvite = await travelToCityOrDidRecently(factionName);
    if (travelledForInvite) {
        workedForInvite = true;
        player = await getPlayerInfo(ns); // Update player.city
    }

    // Special case: earn a CEO position to gain an invite to Silhouette
    if ("Silhouette" == factionName) {
        ns.print(`You must be a CO (e.g. CEO/CTO) of a company to earn an invite to "Silhouette". This may take a while!`);
        let factionConfig = companySpecificConfigs.find(f => f.name == "Silhouette"); // We set up Silhouette with a "company-specific-config" so that we can work for an invite like any megacorporation faction.
        let companyNames = preferredCompanyFactionOrder.map(f => companySpecificConfigs.find(cf => cf.name == f)?.companyName || f);
        let favorByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyFavor(o)'), '/Temp/getCompanyFavors.txt', companyNames);
        let repByCompany = await getNsDataThroughFile(ns, dictCommand('ns.singularity.getCompanyRep(o)'), '/Temp/getCompanyReps.txt', companyNames);
        // Change the company to work for into whichever company we can get to CEO fastest with.
        // Minimize needed_rep/rep_gain_rate. CEO job is at 3.2e6 rep, so (3.2e6-current_rep)/(100+favor).
        // Also take into account that some companies will have lowered rep requirement if they are backdoored
        const backdoorByServer = await backdoorStatusByServer(ns);
        factionConfig.companyName = companyNames.sort((a, b) =>
            ((backdoorByServer[serverByCompany[a]] ? 0.75 : 1.0) * 3.2e6 - repByCompany[a]) / (100 + favorByCompany[a]) -
            ((backdoorByServer[serverByCompany[b]] ? 0.75 : 1.0) * 3.2e6 - repByCompany[b]) / (100 + favorByCompany[b]))[0];
        // If the company we chose has a required stat modifier, we need to add it to the one for Silhouette
        factionConfig.statModifier = companySpecificConfigs.find(c => (c.companyName ?? c.name) == factionConfig.companyName)?.statModifier || 0;
        // If the company we chose gets backdoored, this should appear to affect Silhouette too. A hack is to add a new "serverByCompany" dict entry
        serverByCompany["Silhouette"] = serverByCompany[factionConfig.companyName]

        // Hack: We will be working indefinitely, so we rely on an external script (daemon + faction-manager) to join this faction for us, or for checkForNewPrioritiesInterval to elapse.
        workedForInvite = await workForMegacorpFactionInvite(ns, factionName, false); // Work until CTO and the external script joins this faction, triggering an exit condition.
    }

    // Special case: check hacknet stats before we try to join Netburners
    if ("Netburners" == factionName) {
        if (!netburnersEligibility.ready)
            return deferFactionInvite(ns, factionName, `Deferring faction "Netburners" until hacknet totals meet requirements: ` +
                `${netburnersEligibility.levels}/100 levels, ${netburnersEligibility.ram}/8 ram, ${netburnersEligibility.cores}/4 cores.`);
    }

    if (breakToMainLoop()) return false;
    if (workedForInvite === true) // If we took some action to earn the faction invite, wait for it to come in
        return await waitForFactionInvite(ns, factionName);
    else
        return ns.print(`Nothing we can do at this time to earn an invitation to faction "${factionName}"...`);
}

/** @param {NS} ns */
async function goToCity(ns, cityName) {
    const player = await getPlayerInfo(ns);
    if (player.city == cityName) {
        ns.print(`Already in city ${cityName}`);
        return true;
    }
    const requiredMoney = isBn8() ? bn8CashReserve + cityTravelCost : cityTravelCost;
    if (!await ensureCashForAction(ns, player, requiredMoney, `travel from ${player.city} to ${cityName}`)) {
        log(ns, `WARNING: Skipping travel from ${player.city} to ${cityName} in BN8 to preserve ${formatMoney(bn8CashReserve)} cash buffer. ` +
            `Need ${formatMoney(requiredMoney)}, have ${formatMoney(player.money)} cash.`, false, 'warning');
        return false;
    }
    if (await getNsDataThroughFile(ns, `ns.singularity.travelToCity(ns.args[0])`, null, [cityName])) {
        const updatedPlayer = await getPlayerInfo(ns);
        if (updatedPlayer.city == cityName) {
            lastTravel = Date.now()
            log(ns, `Travelled from ${player.city} to ${cityName}`, false, 'info');
            return true;
        }
        log(ns, `ERROR: Travel to ${cityName} reported success, but player is still in ${updatedPlayer.city}.`, false, 'error');
        return false;
    }
    if (player.money < 200000)
        log(ns, `WARN: Insufficient funds to travel from ${player.city} to ${cityName}`, false, 'warning');
    else
        log(ns, `ERROR: Failed to travel from ${player.city} to ${cityName} for some reason...`, false, 'error');
    return false;
}

/** @param {NS} ns */
export async function crimeForKillsKarmaStats(ns, reqKills, reqKarma, reqStats, doFastCrimesOnly = false) {
    const bestCrimesByDifficulty = ["Heist", "Assassination", "Homicide", "Mug"]; // Will change crimes as our success rate improves
    const chanceThresholds = [0.75, 0.9, 0.5, 0]; // Will change crimes once we reach this probability of success for better all-round gains
    doFastCrimesOnly = doFastCrimesOnly || (options ? options['fast-crimes-only'] : false);
    let player = await getPlayerInfo(ns);
    let forever = reqKills >= Number.MAX_SAFE_INTEGER || reqKarma >= Number.MAX_SAFE_INTEGER || reqStats >= Number.MAX_SAFE_INTEGER;
    let anyStatsDeficient = (p) => p.skills.strength < reqStats || p.skills.defense < reqStats ||
        /*                      */ p.skills.dexterity < reqStats || p.skills.agility < reqStats;
    const getRemainingRequirements = (p) => {
        const requirements = [];
        const currentNegativeKarma = -ns.heart.break();
        if (reqKills && p.numPeopleKilled < reqKills) requirements.push(`${reqKills} kills (Have ${p.numPeopleKilled})`);
        if (reqKarma && currentNegativeKarma < reqKarma)
            requirements.push(`-${reqKarma} Karma (Have ${Math.round(ns.heart.break()).toLocaleString('en')})`);
        if (reqStats && anyStatsDeficient(p)) requirements.push(`${reqStats} of each combat stat (Have ` +
            `Str: ${p.skills.strength}, Def: ${p.skills.defense}, Dex: ${p.skills.dexterity}, Agi: ${p.skills.agility})`);
        return requirements;
    };
    const getCompletedRequirements = (p) => {
        const requirements = [];
        const currentNegativeKarma = -ns.heart.break();
        if (reqKills && p.numPeopleKilled >= reqKills) requirements.push(`${reqKills} kills (Have ${p.numPeopleKilled})`);
        if (reqKarma && currentNegativeKarma >= reqKarma)
            requirements.push(`-${reqKarma} Karma (Have ${Math.round(ns.heart.break()).toLocaleString('en')})`);
        if (reqStats && !anyStatsDeficient(p)) requirements.push(`${reqStats} of each combat stat (Have ` +
            `Str: ${p.skills.strength}, Def: ${p.skills.defense}, Dex: ${p.skills.dexterity}, Agi: ${p.skills.agility})`);
        return requirements;
    };
    let crime, lastCrime, crimeTime, lastStatusUpdateTime, needStats;
    while (forever || (needStats = anyStatsDeficient(player)) || player.numPeopleKilled < reqKills || -ns.heart.break() < reqKarma) {
        if (!forever && breakToMainLoop()) return ns.print('INFO: Interrupting crime to check on high-level priorities.');
        let crimeChances = await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(c => [c, ns.singularity.getCrimeChance(c)]))`, '/Temp/crime-chances.txt', bestCrimesByDifficulty);
        let karma = -ns.heart.break();
        const homicideReady = crimeChances["Homicide"] >= (options?.['min-homicide-chance-for-kills'] ?? 0.25);
        crime = crimeCount < 2 ? (crimeChances["Homicide"] > 0.75 ? "Homicide" : "Mug") : // Start with a few fast & easy crimes to boost stats if we're just starting
            (!needStats && (player.numPeopleKilled < reqKills || karma < reqKarma)) ? (homicideReady ? "Homicide" : "Mug") : // If all we need now is kills or Karma, wait for a practical homicide chance before farming kills.
                bestCrimesByDifficulty.find((c, index) => doFastCrimesOnly && index <= 1 ? 0 : crimeChances[c] >= chanceThresholds[index]); // Otherwise, crime based on success chance vs relative reward (precomputed)
        // Warn if current crime is disrupted
        let currentWork = await getCurrentWorkInfo(ns);
        let crimeType = currentWork.crimeType;
        if (!lastCrime || !(crimeType && crimeType.includes(lastCrime))) {
            if (await isValidInterruption(ns, currentWork)) return;
            if (lastCrime) {
                log(ns, `Committing Crime "${lastCrime}" Interrupted. (Now: ${crimeType ?? currentWork.type}) Restarting...`, false, 'warning');
                if (!options['no-tail-windows']) tail(ns); // Force a tail window open to help the user kill this script if they accidentally closed the tail window and don't want to keep doing crime
            }
            let focusArg = shouldFocus === undefined ? true : shouldFocus; // Only undefined if running as imported function
            crimeTime = await getNsDataThroughFile(ns, 'ns.singularity.commitCrime(ns.args[0], ns.args[1])', null, [crime, focusArg])
            if (shouldFocus && !options['no-tail-windows']) tail(ns); // Force a tail window open when auto-criming with focus so that the user can more easily kill this script
        }
        // Periodic status update with progress
        if (lastCrime != crime || (Date.now() - lastStatusUpdateTime) > statusUpdateInterval) {
            lastCrime = crime;
            lastStatusUpdateTime = Date.now();
            const remainingRequirements = getRemainingRequirements(player);
            ns.print(`Committing "${crime}" (${(100 * crimeChances[crime]).toPrecision(3)}% success) ` +
                (forever ? 'forever...' : `until we reach ${remainingRequirements.join(', ')}`));
        }
        // Sleep for some multiple of the crime time to avoid interrupting a crime in progress on the next status update
        let sleepTime = 1 + Math.ceil(loopSleepInterval / crimeTime) * crimeTime;
        await ns.sleep(sleepTime);

        crimeCount++;
        player = await getPlayerInfo(ns);
    }
    ns.print(`Done committing crimes. Reached ${getCompletedRequirements(player).join(', ')}`);
    return true;
}

/** @param {NS} ns */
async function studyForCharisma(ns, focus) {
    if (!await goToCity(ns, 'Volhaven')) return false;
    return await study(ns, focus, 'Leadership', 'ZB Institute of Technology');
}

const uniByCity = Object.fromEntries([["Aevum", "Summit University"], ["Sector-12", "Rothman University"], ["Volhaven", "ZB Institute of Technology"]]);
const bestGymByCity = Object.fromEntries([["Sector-12", "Powerhouse Gym"], ["Aevum", "Snap Fitness Gym"], ["Volhaven", "Millenium Fitness Gym"]]);
const gymExpMultByGym = Object.fromEntries([["Powerhouse Gym", 10], ["Snap Fitness Gym", 5], ["Millenium Fitness Gym", 4]]);
const combatStatOrder = ["strength", "defense", "dexterity", "agility"];
const gymStatBySkill = { strength: "str", defense: "def", dexterity: "dex", agility: "agi" };
const combatStatLabel = { strength: "Str", defense: "Def", dexterity: "Dex", agility: "Agi" };
const combatLevelMultBySkill = {
    strength: "StrengthLevelMultiplier",
    defense: "DefenseLevelMultiplier",
    dexterity: "DexterityLevelMultiplier",
    agility: "AgilityLevelMultiplier",
};

/** @param {NS} ns */
async function study(ns, focus, course, university = null) {
    if (options['no-studying']) {
        log(ns, `WARNING: Could not study '${course}' because --no-studying is set.`, false, 'warning');
        return;
    }
    const player = await getPlayerInfo(ns);
    if (!hasBn8CashBuffer(player)) {
        log(ns, `WARNING: Skipping paid study '${course}' in BN8 to preserve ${formatMoney(bn8CashReserve)} cash buffer. ` +
            `Have ${formatMoney(player.money)}.`, false, 'warning');
        return false;
    }
    const playerCity = player.city;
    if (!university) { // Auto-detect the university in our city
        university = uniByCity[playerCity];
        if (!university) {
            log(ns, `WARNING: Could not study '${course}' because we are in city '${playerCity}' without a university.`, false, 'warning');
            return;
        }
    }
    if (await getNsDataThroughFile(ns, `ns.singularity.universityCourse(ns.args[0], ns.args[1], ns.args[2])`, null, [university, course, focus])) {
        log(ns, `Started studying '${course}' at '${university}'`, false, 'success');
        return true;
    }
    log(ns, `ERROR: For some reason, failed to study '${course}' at university '${university}' (Not in correct city? Player is in '${playerCity}')`, false, 'error');
    return false;
}

/** @param {NS} ns */
async function workOutAtGym(ns, focus, stat, gymName = "Powerhouse Gym") {
    const gymCity = Object.entries(bestGymByCity).find(([, gym]) => gym == gymName)?.[0];
    if (!gymCity) {
        log(ns, `ERROR: No city mapping found for gym "${gymName}"`, false, 'error');
        return false;
    }
    const player = await getPlayerInfo(ns);
    const travelSpend = player.city == gymCity ? 0 : cityTravelCost;
    const requiredMoney = isBn8() ?
        Math.max(options['pay-for-studies-threshold'] + travelSpend, bn8CashReserve + travelSpend) :
        options['pay-for-studies-threshold'] + travelSpend;
    if (!await ensurePaidTrainingFunds(ns, player, requiredMoney, `train "${stat}" at "${gymName}"`)) {
        log(ns, `WARNING: Insufficient funds to train "${stat}" at "${gymName}". ` +
            `Need ${formatMoney(requiredMoney)}, have ${formatMoney(player.money)} cash.`, false, 'warning');
        return false;
    }
    if (!await goToCity(ns, gymCity)) return false;
    if (await getNsDataThroughFile(ns, `ns.singularity.gymWorkout(ns.args[0], ns.args[1], ns.args[2])`, null, [gymName, stat, focus])) {
        log(ns, `Started training "${stat}" at "${gymName}"`, false, 'success');
        return true;
    }
    log(ns, `ERROR: Failed to train "${stat}" at gym "${gymName}"`, false, 'error');
    return false;
}

/** @param {NS} ns */
async function ensurePaidTrainingFunds(ns, player, requiredMoney, reason) {
    return await ensureCashForAction(ns, player, requiredMoney, reason);
}

/** @param {NS} ns */
async function ensureCashForAction(ns, player, requiredMoney, reason) {
    if (player.money >= requiredMoney) return true;
    const stockValue = await getStocksValue(ns);
    const stockReserve = isBn8() ? bn8StockBackedTrainingReserve : stockBackedTrainingReserve;
    const netWorthRequired = requiredMoney + stockReserve;
    const netWorth = player.money + stockValue;
    if (stockValue <= 0 || netWorth < netWorthRequired) {
        log(ns, `WARNING: Insufficient net worth to ${reason}. Need ${formatMoney(requiredMoney)} cash, ` +
            `or ${formatMoney(netWorthRequired)} cash+stocks with stock-backed reserve. ` +
            `Have ${formatMoney(player.money)} cash + ${formatMoney(stockValue)} stocks.`, false, 'warning');
        return false;
    }
    const pid = ns.run(getFilePath('stockmaster.js'), 1, '--liquidate');
    if (!pid) {
        log(ns, `WARNING: Insufficient cash to ${reason}, and failed to launch stock liquidation. ` +
            `Need ${formatMoney(requiredMoney)}, cash ${formatMoney(player.money)}, stocks ${formatMoney(stockValue)}.`, false, 'warning');
        return false;
    }
    log(ns, `INFO: Liquidating stocks worth ${formatMoney(stockValue)} to ${reason}. ` +
        `Need ${formatMoney(requiredMoney)} cash; preserving stock-backed net-worth reserve ${formatMoney(stockReserve)}.`, false, 'info');
    await waitForProcessToComplete(ns, pid);
    const updatedPlayer = await getPlayerInfo(ns);
    return updatedPlayer.money >= requiredMoney;
}

function calculateExpForSkill(skill, mult = 1) {
    const value = Math.exp((skill / mult + 200) / 32) - 534.6;
    return Math.max(0, value);
}

function estimateGymStatTrainingMs(player, stat, requirement, gymName) {
    if ((player.skills[stat] || 0) >= requirement) return 0;
    const skillMult = (player.mults[stat] || 1) * (bitNodeMults[combatLevelMultBySkill[stat]] || 1);
    const currentExp = player.exp?.[stat] ?? calculateExpForSkill(player.skills[stat] || 1, skillMult);
    const requiredExp = calculateExpForSkill(requirement, skillMult);
    const expGap = Math.max(0, requiredExp - currentExp);
    const expRatePerSecond = (gymExpMultByGym[gymName] || 1) * (player.mults[`${stat}_exp`] || 1) * (bitNodeMults.ClassGymExpGain || 1);
    return expRatePerSecond > 0 ? expGap / expRatePerSecond * 1000 : Number.POSITIVE_INFINITY;
}

function getCombatTrainingPlan(player, requirement, gymName) {
    const stats = combatStatOrder
        .filter(stat => (player.skills[stat] || 0) < requirement)
        .map(stat => ({
            stat,
            gymStat: gymStatBySkill[stat],
            current: player.skills[stat] || 0,
            etaMs: estimateGymStatTrainingMs(player, stat, requirement, gymName),
        }))
        .sort((a, b) => b.etaMs - a.etaMs);
    return {
        stats,
        sequentialEtaMs: stats.reduce((sum, plan) => sum + plan.etaMs, 0),
        hypotheticalParallelEtaMs: Math.max(0, ...stats.map(plan => plan.etaMs)),
    };
}

function chooseCombatTrainingGym(player, requirement, preferredCity = null) {
    const preferredGym = preferredCity ? bestGymByCity[preferredCity] : null;
    const candidateGyms = [...new Set([bestGymByCity[player.city], preferredGym, ...Object.values(bestGymByCity)].filter(Boolean))];
    const affordableCandidates = candidateGyms.filter(gymName => {
        const gymCity = Object.entries(bestGymByCity).find(([, gym]) => gym == gymName)?.[0];
        const travelSpend = player.city == gymCity ? 0 : cityTravelCost;
        const requiredMoney = isBn8() ?
            Math.max(options['pay-for-studies-threshold'] + travelSpend, bn8CashReserve + travelSpend) :
            options['pay-for-studies-threshold'] + travelSpend;
        return player.money >= requiredMoney;
    });
    const candidates = affordableCandidates.length > 0 ? affordableCandidates : candidateGyms;
    return candidates
        .map(gymName => ({ gymName, etaMs: getCombatTrainingPlan(player, requirement, gymName).sequentialEtaMs }))
        .sort((a, b) => a.etaMs - b.etaMs)[0]?.gymName || bestGymByCity[player.city] || "Powerhouse Gym";
}

function getGymCity(gymName) {
    return Object.entries(bestGymByCity).find(([, gym]) => gym == gymName)?.[0];
}

function isCrossCityBackgroundTrainingEnabled() {
    return !!options?.['cross-city-background-training'] && !options?.['disable-cross-city-background-training'];
}

function getPaidTrainingRequiredMoney(player, gymName, finalCity = null) {
    const gymCity = getGymCity(gymName);
    if (!gymCity) return Number.POSITIVE_INFINITY;
    const travelSpend = (player.city == gymCity ? 0 : cityTravelCost) +
        (finalCity && finalCity != gymCity ? cityTravelCost : 0);
    return isBn8() ?
        Math.max(options['pay-for-studies-threshold'] + travelSpend, bn8CashReserve + travelSpend) :
        options['pay-for-studies-threshold'] + travelSpend;
}

function canAffordBackgroundTrainingRoute(player, gymName, finalCity = null) {
    return player.money >= getPaidTrainingRequiredMoney(player, gymName, finalCity);
}

function chooseBackgroundTrainingGym(player, requirement, preferredCity = null, finalCity = null) {
    const preferredGym = preferredCity ? bestGymByCity[preferredCity] : null;
    const candidateGyms = [...new Set([bestGymByCity[player.city], preferredGym, ...Object.values(bestGymByCity)].filter(Boolean))];
    const affordableCandidates = candidateGyms.filter(gymName => canAffordBackgroundTrainingRoute(player, gymName, finalCity));
    const candidates = affordableCandidates.length > 0 ? affordableCandidates : candidateGyms;
    return candidates
        .map(gymName => ({ gymName, etaMs: getCombatTrainingPlan(player, requirement, gymName).sequentialEtaMs }))
        .sort((a, b) => a.etaMs - b.etaMs)[0]?.gymName || null;
}

function getCombatTrainingAssessment(player, requirement, preferredCity = null) {
    const gymName = chooseCombatTrainingGym(player, requirement, preferredCity);
    return { gymName, plan: getCombatTrainingPlan(player, requirement, gymName) };
}

function shouldDeferOptionalCombatTraining(factionName, trainingPlan) {
    if (!reqHackingOrCombat.includes(factionName))
        return false;
    return !Number.isFinite(trainingPlan.sequentialEtaMs) ||
        trainingPlan.sequentialEtaMs > maxOptionalCombatTrainingEtaMs;
}

function formatCombatTrainingPlan(plan) {
    return plan.stats.map(s => `${combatStatLabel[s.stat]} ${s.current}->${formatDuration(s.etaMs)}`).join(", ");
}

/** @param {NS} ns */
async function trainCombatStatsUpTo(ns, requirement, factionName = "unknown faction", preferredCity = null) {
    const initialPlayer = await getPlayerInfo(ns);
    const gymName = chooseCombatTrainingGym(initialPlayer, requirement, preferredCity);
    const gymCity = Object.entries(bestGymByCity).find(([, gym]) => gym == gymName)?.[0] || "Sector-12";
    let lastStatusUpdateTime = 0;
    let statToTrain = null;
    while (!breakToMainLoop()) {
        let player = await getPlayerInfo(ns);
        const trainingPlan = getCombatTrainingPlan(player, requirement, gymName);
        if (trainingPlan.stats.length == 0) {
            log(ns, `SUCCESS: Achieved ${requirement} in all combat stats for "${factionName}" while training at the gym.`, false, 'info');
            return true;
        }
        if (!statToTrain || player.skills[statToTrain] >= requirement)
            statToTrain = trainingPlan.stats[0].stat;
        const currentWork = await getCurrentWorkInfo(ns);
        const expectedGymStat = gymStatBySkill[statToTrain];
        const currentClassType = String(currentWork.classType || "").toLowerCase();
        if (currentClassType !== expectedGymStat || currentWork.location !== gymName) {
            if (await isValidInterruption(ns, currentWork)) return;
            if (player.city != gymCity)
                devConsoleLog(`Departure from "${player.city}" to "${gymCity}" for combat training at "${gymName}" before "${factionName}".`);
            if (!await workOutAtGym(ns, shouldFocus, expectedGymStat, gymName)) return false;
            const playerAfterGymTravel = await getPlayerInfo(ns);
            if (player.city != playerAfterGymTravel.city)
                devConsoleLog(`Arrived from "${player.city}" to "${playerAfterGymTravel.city}" for combat training at "${gymName}" before "${factionName}".`);
        }
        if ((Date.now() - lastStatusUpdateTime) > statusUpdateInterval) {
            lastStatusUpdateTime = Date.now();
            const statPlan = trainingPlan.stats.find(plan => plan.stat == statToTrain);
            log(ns, `Training ${combatStatLabel[statToTrain]} at ${gymName} in ${gymCity} for "${factionName}" until all combat stats reach ${requirement}. ` +
                `Currently Str: ${player.skills.strength}, Def: ${player.skills.defense}, Dex: ${player.skills.dexterity}, Agi: ${player.skills.agility}. ` +
                `Gym can train only one combat stat at a time. Sequential ETA ${formatDuration(trainingPlan.sequentialEtaMs)}; ` +
                `hypothetical all-at-once ETA ${formatDuration(trainingPlan.hypotheticalParallelEtaMs)} is not available via gymWorkout. ` +
                `Current stat ETA ${formatDuration(statPlan?.etaMs || 0)}. By stat: ${formatCombatTrainingPlan(trainingPlan)}.`, false, 'info');
        }
        await ns.sleep(loopSleepInterval);
    }
}

/** @param {NS} ns */
async function startBackgroundCombatTraining(ns, requirement, factionName = "unknown faction", preferredCity = null) {
    const statOrder = ["strength", "defense", "dexterity", "agility"];
    const gymStatBySkill = { strength: "str", defense: "def", dexterity: "dex", agility: "agi" };
    const player = await getPlayerInfo(ns);
    const deficientStats = statOrder.filter(stat => player.skills[stat] < requirement);
    if (deficientStats.length == 0) return true;
    const gymName = isCrossCityBackgroundTrainingEnabled() ?
        chooseBackgroundTrainingGym(player, requirement, preferredCity, preferredCity) :
        bestGymByCity[player.city];
    const gymCity = getGymCity(gymName);
    const statToTrain = deficientStats.sort((a, b) => player.skills[a] - player.skills[b])[0];
    const expectedGymStat = gymStatBySkill[statToTrain];
    const currentWork = await getCurrentWorkInfo(ns);
    const currentClassType = String(currentWork.classType || "").toLowerCase();
    if (!gymName) {
        if (["str", "def", "dex", "agi"].includes(currentClassType) && currentClassType !== expectedGymStat) {
            await stop(ns);
            log(ns, `Stopped unrelated background ${currentClassType} training because "${factionName}" needs ${statToTrain}, ` +
                `but city ${player.city} has no gym. Infiltration will continue.`, false, 'info');
        } else {
            log(ns, `Cannot prepare background ${statToTrain} training for "${factionName}" because city ${player.city} has no gym. ` +
                `Infiltration will continue.`, false, 'info');
        }
        return false;
    }
    const routeRequiredMoney = getPaidTrainingRequiredMoney(player, gymName, preferredCity);
    if (isCrossCityBackgroundTrainingEnabled() &&
        !await ensureCashForAction(ns, player, routeRequiredMoney, `prepare background ${statToTrain} training at ${gymName} before "${factionName}"`)) {
        log(ns, `Cannot prepare background ${statToTrain} training at ${gymName} before "${factionName}" because cash is insufficient ` +
            `for gym + infiltration travel. Need ${formatMoney(routeRequiredMoney)}, ` +
            `have ${formatMoney(player.money)}. Infiltration will continue.`, false, 'info');
        return false;
    }
    if (currentClassType === expectedGymStat && currentWork.location === gymName) return true;
    if (currentWork.type == "GRAFTING") {
        log(ns, `Cannot prepare background ${statToTrain} training at ${gymName} before "${factionName}" because grafting is active. ` +
            `Infiltration will continue without background training.`, false, 'info');
        return false;
    }
    if (currentWork.type && !["CLASS", ""].includes(currentWork.type)) {
        await stop(ns);
        log(ns, `Stopped current ${currentWork.type} work to prepare background ${statToTrain} training at ${gymName} ` +
            `before "${factionName}". Infiltration still has priority.`, false, 'info');
    }
    const started = await workOutAtGym(ns, false, expectedGymStat, gymName);
    if (started)
        log(ns, `Prepared background ${statToTrain} training at ${gymName}${gymCity ? ` in ${gymCity}` : ""} for "${factionName}" before starting infiltration. ` +
            `Current combat min ${getMinCombatStat(player)}, target ${requirement}.`, false, 'info');
    else
        log(ns, `Failed to prepare background ${statToTrain} training at ${gymName} for "${factionName}". ` +
            `Infiltration will continue.`, false, 'warning');
    return started;
}

/** @param {NS} ns */
async function stopBackgroundCombatTraining(ns, reason = "infiltration") {
    const currentWork = await getCurrentWorkInfo(ns);
    const currentClassType = String(currentWork.classType || "").toLowerCase();
    if (!["str", "def", "dex", "agi"].includes(currentClassType)) return false;
    await stop(ns);
    log(ns, `Stopped background ${currentClassType} training before ${reason}. Infiltration has priority.`, false, 'info');
    return true;
}

/** @param {NS} ns */
async function ensureBackgroundWeakestCombatTraining(ns, reason = "infiltration", preferredCity = null) {
    const statOrder = ["strength", "defense", "dexterity", "agility"];
    const gymStatBySkill = { strength: "str", defense: "def", dexterity: "dex", agility: "agi" };
    const player = await getPlayerInfo(ns);
    const gymName = isCrossCityBackgroundTrainingEnabled() ?
        chooseBackgroundTrainingGym(player, 0, preferredCity, preferredCity) :
        bestGymByCity[player.city];
    if (!gymName) return false;
    const gymCity = getGymCity(gymName);
    const statToTrain = statOrder.sort((a, b) => (player.skills[a] || 0) - (player.skills[b] || 0))[0];
    const expectedGymStat = gymStatBySkill[statToTrain];
    const currentWork = await getCurrentWorkInfo(ns);
    const currentClassType = String(currentWork.classType || "").toLowerCase();
    const routeRequiredMoney = getPaidTrainingRequiredMoney(player, gymName, preferredCity);
    if (isCrossCityBackgroundTrainingEnabled() &&
        !await ensureCashForAction(ns, player, routeRequiredMoney, `prepare background ${statToTrain} training at ${gymName} before ${reason}`)) {
        log(ns, `Cannot prepare background ${statToTrain} training at ${gymName} before ${reason} because cash is insufficient ` +
            `for gym + infiltration travel. Need ${formatMoney(routeRequiredMoney)}, ` +
            `have ${formatMoney(player.money)}. Infiltration will continue.`, false, 'info');
        return false;
    }
    if (currentClassType === expectedGymStat && currentWork.location === gymName) return true;
    if (currentWork.type == "GRAFTING") {
        log(ns, `Cannot prepare background ${statToTrain} training before ${reason} because grafting is active. ` +
            `Infiltration will continue without background training.`, false, 'info');
        return false;
    }
    if (currentWork.type && !["CLASS", ""].includes(currentWork.type)) {
        await stop(ns);
        log(ns, `Stopped current ${currentWork.type} work to prepare background ${statToTrain} training before ${reason}.`, false, 'info');
    }
    const started = await workOutAtGym(ns, false, expectedGymStat, gymName);
    if (started)
        log(ns, `Prepared background ${statToTrain} training at ${gymName}${gymCity ? ` in ${gymCity}` : ""} before ${reason}. ` +
            `Combat min ${getMinCombatStat(player)}.`, false, 'info');
    return started;
}

/** @param {NS} ns
 * Helper to wait for studies to be complete */
async function monitorStudies(ns, stat, requirement) {
    let lastStatusUpdateTime = 0;
    const initialWork = await getCurrentWorkInfo(ns);
    while (!breakToMainLoop()) {
        const currentWork = await getCurrentWorkInfo(ns);
        if (!(currentWork.classType) || currentWork.classType != initialWork.classType) {
            log(ns, `WARNING: Something interrupted our studies.` +
                `\nWAS: ${JSON.stringify(initialWork)}\nNOW: ${JSON.stringify(currentWork)}`, false, 'warning');
            return;
        }
        const player = await getPlayerInfo(ns);
        if (player.skills[stat] >= requirement) {
            log(ns, `SUCCESS: Achieved ${stat} level ${player.skills[stat]} >= ${requirement} while studying`, false, 'info');
            return true;
        }
        if ((Date.now() - lastStatusUpdateTime) > statusUpdateInterval) {
            lastStatusUpdateTime = Date.now();
            log(ns, `Studying "${currentWork.classType}" at ${currentWork.location} until ${stat} reaches ${requirement}. ` +
                `Currently at ${player.skills[stat]}...`, false, 'info'); // TODO: Compute an ETA, and configure training threshold based on ETA
        }
        await ns.sleep(loopSleepInterval);
    }
}

/** @param {NS} ns */
export async function waitForFactionInvite(ns, factionName, maxWaitTime = waitForFactionInviteTime) {
    ns.print(`Waiting for invite from faction "${factionName}" (game may delay this up to ${formatDuration(maxWaitTime)})...`);
    let waitTime = maxWaitTime;
    let lastFactionCount = null;
    do {
        var invitations = await checkFactionInvites(ns);
        var joinedFactions = (await getPlayerInfo(ns)).factions;
        const factionCount = invitations.length + joinedFactions.length;
        if (invitations.includes(factionName) || joinedFactions.includes(factionName))
            break;
        // If we recieved an invite, just not for the faction we wanted, reset the timer
        if (lastFactionCount === null) lastFactionCount = factionCount;
        if (factionCount > lastFactionCount) {
            ns.print(`INFO: Recieved a new invite, but not from "${factionName}". ` +
                `Invites are sent on a delay, so resetting the ${formatDuration(maxWaitTime)} timer...`);
            waitTime = maxWaitTime;
            lastFactionCount = factionCount;
        }
        await ns.sleep(loopSleepInterval);
    } while (!invitations.includes(factionName) && !joinedFactions.includes(factionName) && (waitTime -= loopSleepInterval) > 0);
    if (joinedFactions.includes(factionName)) // Another script may have auto-joined this faction before we could
        ns.print(`An external script has joined faction "${factionName}" for us.`);
    else if (!invitations.includes(factionName)) {
        log(ns, `ERROR: Waited ${formatDuration(maxWaitTime)}, but still have not recieved an invite for faction: "${factionName}" (Requirements not met?)`, false, 'error');
        return;
    } else if (!(await tryJoinFaction(ns, factionName))) {
        log(ns, `ERROR: Something went wrong. Earned "${factionName}" faction invite, but failed to join it.`, false, 'error');
        return;
    }
    return true;
}

/** @param {NS} ns */
export async function tryJoinFaction(ns, factionName) {
    var joinedFactions = (await getPlayerInfo(ns)).factions;
    if (joinedFactions.includes(factionName))
        return true;
    if (!(await getNsDataThroughFile(ns, `ns.singularity.joinFaction(ns.args[0])`, null, [factionName])))
        return false;
    log(ns, `Joined faction "${factionName}"`, false, 'success');
    return true;
}

/** @param {NS} ns
 * @returns {Promise<Player>} the result of ns.getPlayer() */
async function getPlayerInfo(ns) {
    //return ns.getPlayer(); // Note: We may decide that we call this frequently enough it is not worth ram-dodging
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 * @returns {Promise<ResetInfo>} the result of ns.getResetInfo() */
async function getResetInfoRd(ns) {
    return await getNsDataThroughFile(ns, `ns.getResetInfo()`);
}

/** @param {NS} ns
 * @returns {Promise<Task>} The result of ns.singularity.getCurrentWork() */
async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {}; // Easier than null-coalescing everywhere
}

/** @param {NS} ns
 *  @returns {Promise<string[]>} List of new faction invites */
async function checkFactionInvites(ns) {
    return await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()');
}

/** @param {NS} ns */
async function closeTransientGameWindows(ns) {
    const closedCount = await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const textOf = el => (el?.innerText || el?.textContent || "").trim();
        const lowerTextOf = el => textOf(el).toLowerCase();
        const infiltrationMarkers = [
            "infiltration", "infiltrating", "maximum clearance level", "clearance level",
            "trade for reputation", "sell for money", "start infiltration"
        ];
        if (infiltrationMarkers.some(marker => lowerTextOf(doc.body).includes(marker)))
            return 0;

        const scriptMarkers = [
            "script editor", "recent scripts", "active scripts", "log", "tail",
            "kill script", "threads", "ram usage"
        ];
        const selectors = [
            ".MuiDialog-root",
            ".MuiPopover-root",
            ".MuiMenu-root",
            ".MuiModal-root",
            "[role='dialog']",
            "[role='menu']",
            "[role='presentation']"
        ];
        const candidates = Array.from(doc.querySelectorAll(selectors.join(",")))
            .filter(el => {
                const text = lowerTextOf(el);
                if (!text) return false;
                if (infiltrationMarkers.some(marker => text.includes(marker))) return false;
                if (scriptMarkers.some(marker => text.includes(marker))) return false;
                return text.includes("invitation") || text.includes("message") || text.includes("letter") ||
                    text.includes("faction") || text.includes("joined") || text.includes("congratulations") ||
                    text.includes("would like") || text.includes("invite");
            });

        let closed = 0;
        const closeTexts = ["close", "ok", "okay", "cancel", "no", "x", "×"];
        for (const el of candidates) {
            const buttons = Array.from(el.querySelectorAll("button,[role='button']"));
            const closeButton = buttons.find(button => {
                const label = (button.getAttribute("aria-label") || textOf(button)).trim().toLowerCase();
                return closeTexts.includes(label);
            }) || buttons[buttons.length - 1];
            if (closeButton) {
                closeButton.click();
                closed++;
            }
        }
        if (closed == 0 && candidates.length > 0) {
            doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
            closed = candidates.length;
        }
        return closed;
    })()`, '/Temp/close-transient-game-windows.txt');
    if (closedCount > 0)
        devConsoleLog(`Closed ${closedCount} transient game window${closedCount == 1 ? '' : 's'} after processing faction invitations/messages.`);
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} Gang information, if we're in a gang, or False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false', '/Temp/gang-stats.txt')
}

/** @param {NS} ns
 *  @returns {Promise<Number>} Current reputation with the specified faction */
async function getFactionReputation(ns, factionName) {
    return await getNsDataThroughFile(ns, `ns.singularity.getFactionRep(ns.args[0])`, null, [factionName]);
}

/** @param {NS} ns
 *  @returns {Promise<Number>} Current reputation with the specified company */
async function getCompanyReputation(ns, companyName) {
    return await getNsDataThroughFile(ns, `ns.singularity.getCompanyRep(ns.args[0])`, null, [companyName]);
}

/** @param {NS} ns
 *  @returns {Promise<Number>} Current favour with the specified faction */
async function getCurrentFactionFavour(ns, factionName) {
    return await getNsDataThroughFile(ns, `ns.singularity.getFactionFavor(ns.args[0])`, null, [factionName]);
}

/** @param {NS} ns
 *  @returns {Promise<Number>} The hacking level required for the specified server */
async function getServerRequiredHackLevel(ns, serverName) {
    return await getNsDataThroughFile(ns, `ns.getServerRequiredHackingLevel(ns.args[0])`, null, [serverName]);
}

let lastInterruptionNotice = "";
/** Checks whether the current work being perform qualifies as a valid interruption (true),
 *  or whether we should go back to what we were doing before we were interrupted (false).
 * @param {NS} ns
 * @param {Task?} currentWork (optional) The work the player is currently doing, if already retrieved.
 * @return {bool} true if we should stop what we're doing and let the interruption continue.
 */
async function isValidInterruption(ns, currentWork = null) {
    let interruptionNotice = "";
    currentWork ??= await getCurrentWorkInfo(ns); // Retrieve current work (unless it was passed in)
    // Never interrupt grafting except in BN3 where faction progression toward The Red Pill is higher priority.
    if (currentWork.type == "GRAFTING" && !shouldTreatGraftingAsBackground()) {
        interruptionNotice = "Grafting in progress. Pausing all activity to avoid interrupting...";
        wasGrafting = true;
    }
    // If bladeburner is currently active, but we do not yet have The Blade's Simulacrum, we may choose to we pause working.
    else if (7 in dictSourceFiles && !hasSimulacrum && !options['no-bladeburner-check']) {
        // Heuristic: If we're in a gang, its rep will give us access to most augs, we can take a break from working in favour of bladeburner progress
        //       Also, if we're done all "priority" work (scope >= 2), consider letting Bladeburner take over
        // TODO: Are there other situations we want to prioritize bladeburner over normal work? Perhaps if we're in a Bladeburner BN? (6 or 7)
        if (playerGang || scope >= 2) {
            // Check if the player has joined bladeburner (can stop checking once we see they are)
            playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
            if (playerInBladeburner) {
                if (playerGang)
                    interruptionNotice = `Gang will give us most augs, so pausing work to allow Bladeburner to operate.`;
                else
                    interruptionNotice = `Decided that doing Bladeburner is more important that working right now.`;
                if (currentWork.type)
                    await stop(ns); // Stop working so bladeburner can run (bladeburner won't interrupt work for us)
            }
        }
    }

    // If we decided to pause focus-work, display a message and return true
    if (interruptionNotice != "") {
        if (lastInterruptionNotice != interruptionNotice) { // If we haven't already notified that we're pausing activity, do this now
            log(ns, `INFO: ${interruptionNotice}`, false, 'info');
            lastInterruptionNotice = interruptionNotice;
        }
        mainLoopStart = 0; // Ensure that any check for "break to main loop"
        return true;
    }
    return false;
}

let lastFactionWorkStatus = "";
let lastPassiveFactionStatus = "";
let lastPassiveFactionStatusUpdate = 0;
/** * Checks how much reputation we need with this faction to buy useful augmentations, then works to that amount.
 * @param {NS} ns
 * @param {string} factionName The faction to work for
 * @param {boolean} forceThroughInvitePriority Continue even when --prioritize-invites would normally defer faction work.
 * @param {boolean} forceBestAug Set to true to a) ignore "desired" stats and just work towards the most expensive (rep) agumentation,
 *                                          and b) keep going until we can buy all augmentations.
 * @param {boolean|number} forceRep Set to true to force working for reputation despite earlier completion heuristics.
 *                               Hack: If set to a number, we will work until that reputation amount regardless of augmentation reputation requirements.
 * @param {boolean} forceUnlockDonations Grind rep until donations are unlocked for next reset (favor >= getFavorToDonate()).
 * */
export async function workForSingleFaction(ns, factionName, forceThroughInvitePriority = false, forceBestAug = false, forceRep = false, forceUnlockDonations = false) {
    if (passiveInfiltrationFactions.includes(factionName))
        return await handlePassiveInfiltrationFaction(ns, factionName);
    const repToFavor = (favor) => Math.ceil(25500 * 1.02 ** (favor - 1) - 25000);
    let highestRepAug = forceBestAug ? mostExpensiveAugByFaction[factionName] : mostExpensiveDesiredAugByFaction[factionName];
    let startingFavor = dictFactionFavors[factionName] || 0; // How much favour do we already have with this faction?
    const favorToDonate = Math.floor(150 * (bitNodeMults?.FavorToDonateToFaction ?? 1));
    const favorRepRequired = Math.max(0, repToFavor(favorToDonate) - repToFavor(Math.max(1, startingFavor)));
    let factionRepRequired = highestRepAug;
    if (forceUnlockDonations) // Grind until donations are unlocked for next reset
        factionRepRequired = Math.max(factionRepRequired, favorRepRequired);
    if (forceBestAug)// If forced, ensure we earn enough rep to buy the highest rep augmentation
        factionRepRequired = Math.max(factionRepRequired, highestRepAug);
    if (forceRep !== true && forceRep > 0) // If forceRep is a number (not just a flag 'true'), ensure we earn the specified rep amount
        factionRepRequired = Math.max(factionRepRequired, forceRep)
    // Check for any reasons to skip working for this faction
    if (!forceRep && highestRepAug == -1 && !firstFactions.includes(factionName) && !options['get-invited-to-every-faction'])
        return ns.print(`All "${factionName}" augmentations are owned. Skipping unlocking faction...`);
    // If donations are already unlocked, no need to grind rep for that purpose
    if (forceUnlockDonations && !forceBestAug && !forceRep && startingFavor >= favorToDonate)
        return ns.print(`Donations already unlocked for "${factionName}" (favor ${startingFavor?.toFixed(2)} >= ${favorToDonate}). Skipping donation unlock grind...`);
    // Hack: Don't bother unlocking donations for factions whose most expensive aug is <20% of the donation rep required (not worth the grind)
    if (forceUnlockDonations && !forceBestAug && !forceRep && highestRepAug > 0 && highestRepAug < 0.2 * favorRepRequired) {
        ns.print(`"${factionName}" last aug (${highestRepAug?.toLocaleString('en')} rep) is trivial vs donation threshold (${favorRepRequired?.toLocaleString('en')} rep). Skipping donation unlock.`);
        factionRepRequired = highestRepAug;
    }
    // Ensure we get an invite to location-based factions we might want / need
    const inviteStatus = await earnFactionInvite(ns, factionName);
    if (inviteStatus === "deferred")
        return false;
    if (!inviteStatus)
        return ns.print(`We are not yet part of faction "${factionName}". Skipping working for faction...`);
    let currentReputation = await getFactionReputation(ns, factionName);
    // If the best faction aug is within 10% of our current rep, grind all the way to it so we can get it immediately, regardless of our current rep target
    if (forceBestAug || highestRepAug <= 1.1 * Math.max(currentReputation, factionRepRequired))
        factionRepRequired = Math.max(highestRepAug, factionRepRequired);
    if (currentReputation >= factionRepRequired)
        return ns.print(`Faction "${factionName}" required rep of ${Math.round(factionRepRequired).toLocaleString('en')} has already been attained ` +
            `(Current rep: ${Math.round(currentReputation).toLocaleString('en')}). Skipping working for faction...`)
    if (factionName == "Daedalus") await daedalusSpecialCheck(ns, favorRepRequired, currentReputation);

    ns.print(`Faction "${factionName}" Highest Aug Req: ${highestRepAug?.toLocaleString('en')}, Current Favor ` +
        `${startingFavor?.toFixed(2)}, Target Rep: ${Math.round(factionRepRequired).toLocaleString('en')}`);
    if (options['invites-only'])
        return ns.print(`--invites-only Skipping working for faction...`);
    if (options['prioritize-invites'] && inviteStatus !== "existing" &&
        !shouldBypassPrioritizeInvitesForFaction(factionName) &&
        !forceThroughInvitePriority && !forceBestAug && !forceRep)
        return ns.print(`--prioritize-invites Skipping rep grind for newly-joined faction; collecting more invites first...`);
    // Option 3: If donations are already unlocked, faction-manager handles rep via money — no need to grind.
    if (!forceRep && !forceUnlockDonations && startingFavor >= favorToDonate)
        return ns.print(`Donations unlocked for "${factionName}" (favor ${startingFavor?.toFixed(2)}/${favorToDonate}). Faction-manager will donate for rep. Skipping grind...`);
    // Option 1: Compare direct faction work rep/sec vs best infiltration rep/sec, choose the faster method.
    let useDirectWork = false;
    let bestDirectWorkType = null;
    let bestDirectRepRate = 0;
    try {
        const currentMoney = (await getPlayerInfo(ns)).money;
        const remainingRepForComparison = Math.max(0, factionRepRequired - currentReputation);
        const bestInfiltrationForComparison = await pickBestInfiltrationLocation(ns, remainingRepForComparison, currentMoney, "");
        const infiltrationRepPerSec = bestInfiltrationForComparison
            ? (bestInfiltrationForComparison.reward?.tradeRep || 0) / (estimateInfiltrationRunTimeMs(bestInfiltrationForComparison) / 1000)
            : 0;
        // Measure direct work rep rate (tries each work type, ~200ms each)
        for (const work of Object.values(ns.enums.FactionWorkType)) {
            if (!(await startWorkForFaction(ns, factionName, work, shouldFocus))) continue;
            const rate = await measureFactionRepGainRate(ns, factionName);
            if (rate > bestDirectRepRate) { bestDirectRepRate = rate; bestDirectWorkType = work; }
        }
        if (bestDirectWorkType && bestDirectRepRate > infiltrationRepPerSec) {
            useDirectWork = true;
            ns.print(`INFO: Direct faction work (${bestDirectWorkType}: ${formatNumberShort(bestDirectRepRate)} rep/s) beats infiltration (${formatNumberShort(infiltrationRepPerSec)} rep/s) for "${factionName}". Using direct work.`);
            await startWorkForFaction(ns, factionName, bestDirectWorkType, shouldFocus);
        } else {
            ns.print(`INFO: Infiltration (${formatNumberShort(infiltrationRepPerSec)} rep/s) beats direct work (${formatNumberShort(bestDirectRepRate)} rep/s) for "${factionName}". Using infiltration.`);
            await stop(ns); // stop any work started during measurement
        }
    } catch (err) {
        ns.print(`WARN: Method comparison failed for "${factionName}": ${getErrorInfo(err)}. Defaulting to infiltration.`);
        await stop(ns);
    }
    let lastStatusUpdateTime = 0;
    let lastSelectedInfiltrationTarget = "";
    let stickyInfiltrationTarget = "";
    if (useDirectWork) {
        // Direct faction work loop
        while ((currentReputation = (await getFactionReputation(ns, factionName))) < factionRepRequired) {
            if (breakToMainLoop()) {
                return ns.print('INFO: Interrupting faction work to check on high-level priorities.');
            }
            const currentWork = await getCurrentWorkInfo(ns);
            if (!currentWork?.type || currentWork.type !== 'FACTION') {
                if (await isValidInterruption(ns, currentWork)) return;
                await startWorkForFaction(ns, factionName, bestDirectWorkType, shouldFocus);
            }
            const remainingRep = Math.max(0, factionRepRequired - currentReputation);
            if (Date.now() > lastStatusUpdateTime + 60000) {
                lastStatusUpdateTime = Date.now();
                ns.print(`INFO: Working for "${factionName}" (${bestDirectWorkType}) — ${formatNumberShort(currentReputation)}/${formatNumberShort(factionRepRequired)} rep (${formatNumberShort(remainingRep)} remaining, ${formatNumberShort(bestDirectRepRate)} rep/s)`);
            }
            await ns.sleep(loopSleepInterval);
        }
        await stop(ns);
        return true;
    }
    while ((currentReputation = (await getFactionReputation(ns, factionName))) < factionRepRequired) {
        if (breakToMainLoop()) {
            return ns.print('INFO: Interrupting infiltration to check on high-level priorities.');
        }
        const remainingRep = Math.max(0, factionRepRequired - currentReputation);
        const currentMoney = (await getPlayerInfo(ns)).money;
        const stockValue = await getStocksValue(ns);
        const currentWealth = currentMoney + stockValue;
        const desiredAugCost = Math.max(0, mostExpensiveDesiredAugCostByFaction[factionName] || 0);
        const moneyShortfall = Math.max(0, desiredAugCost - currentWealth);
        const bestLocation = await pickBestInfiltrationLocation(ns, remainingRep, currentMoney, stickyInfiltrationTarget);
        if (!bestLocation) {
            printNoFactionInfiltrationTargetStatus(ns, factionName);
            await ns.sleep(loopSleepInterval);
            continue;
        }
        const currentWorkBeforeInfiltration = await getCurrentWorkInfo(ns);
        if (currentWorkBeforeInfiltration?.type == "GRAFTING" && !shouldTreatGraftingAsBackground(factionName)) {
            stickyInfiltrationTarget = getInfiltrationLocationKey(bestLocation);
            const pauseStatus = `Grafting active; pausing infiltration for "${factionName}" at "${bestLocation.location.name}" ` +
                `until grafting completes.`;
            if (lastFactionWorkStatus != pauseStatus) {
                lastFactionWorkStatus = pauseStatus;
                ns.print(pauseStatus);
            }
            infiltrationConsoleStatus(`paused ${bestLocation.location.name}@${bestLocation.location.city} -> ${factionName}: grafting-active v=${workForFactionsVersion}`);
            await ns.sleep(loopSleepInterval);
            continue;
        }
        const trainingTarget = await pickInfiltrationTrainingTarget(ns, currentMoney, remainingRep, bestLocation);
        if (trainingTarget) {
            log(ns, `INFO: Will train combat stats for "${factionName}" in the background while infiltrating. ` +
                `Current best target "${bestLocation.location.name}" has ETA ${formatDuration(trainingTarget.currentBestEtaMs)}, ` +
                `and "${trainingTarget.location.location.name}" is estimated at ${formatDuration(trainingTarget.totalEtaMs)} ` +
                `once all combat stats reach ${trainingTarget.requiredCombatStat}.`, false, 'info');
        }
        if (isCrossCityBackgroundTrainingEnabled()) {
            if (trainingTarget)
                await startBackgroundCombatTraining(ns, trainingTarget.requiredCombatStat, `${factionName} infiltration`, bestLocation.location.city);
            else
                await ensureBackgroundWeakestCombatTraining(ns, `${factionName} infiltration`, bestLocation.location.city);
        }
        const playerBeforeTravel = await getPlayerInfo(ns);
        const travelNeeded = playerBeforeTravel.city != bestLocation.location.city;
        const repPerRun = Math.max(1, bestLocation?.reward?.tradeRep || 0);
        const remainingRuns = Math.max(1, Math.ceil(remainingRep / repPerRun));
        const targetSummary = `${factionName}|${bestLocation.location.city}|${bestLocation.location.name}|${playerBeforeTravel.city}|${travelNeeded}|${remainingRuns}`;
        if (targetSummary != lastSelectedInfiltrationTarget) {
            lastSelectedInfiltrationTarget = targetSummary;
            infiltrationConsoleStatus(formatFactionInfiltrationSelection(bestLocation, factionName, remainingRep,
                travelNeeded ? `${playerBeforeTravel.city}->${bestLocation.location.city}` : ""));
        }
        if (travelNeeded) {
            const travelWorked = await goToCity(ns, bestLocation.location.city);
            if (!travelWorked) {
                devConsoleLog(`Travel failed from "${playerBeforeTravel.city}" to "${bestLocation.location.city}" for infiltration at "${bestLocation.location.name}".`);
                noteTravelFailedInfiltration(bestLocation);
                await ns.sleep(loopSleepInterval);
                continue;
            }
        }
        if (!isCrossCityBackgroundTrainingEnabled()) {
            if (trainingTarget)
                await startBackgroundCombatTraining(ns, trainingTarget.requiredCombatStat, `${factionName} infiltration`, bestLocation.location.city);
            else
                await ensureBackgroundWeakestCombatTraining(ns, `${factionName} infiltration`);
        }
        const infiltrationResult = await runInfiltrationRunner(ns, bestLocation.location.city, bestLocation.location.name, factionName, false, false);
        recordObservedInfiltrationRunTime(bestLocation, infiltrationResult);
        await healAfterInfiltrationIfNeeded(ns, `${bestLocation.location.name} -> ${factionName}`);
        if (!infiltrationResult.success) {
            if (infiltrationResult.reason == 'hospitalized')
                noteHospitalizedInfiltration(bestLocation);
            if (['travel-failed', 'direct-travel-failed'].includes(infiltrationResult.reason))
                noteTravelFailedInfiltration(bestLocation);
            if (['timeout', 'reward-click-failed', 'button-not-found'].includes(infiltrationResult.reason))
                noteFailedInfiltration(bestLocation, infiltrationResult.reason);
            if (shouldRetrySameInfiltrationTarget(infiltrationResult.reason))
                stickyInfiltrationTarget = getInfiltrationLocationKey(bestLocation);
            else
                stickyInfiltrationTarget = "";
            devConsoleLog(`Infiltration runner failed for "${factionName}" at "${bestLocation.location.name}" with reason "${infiltrationResult.reason}".`);
            const retryAction = shouldRetrySameInfiltrationTarget(infiltrationResult.reason) ?
                `Retrying the same target.` :
                `Retrying...`;
            log(ns, `WARN: Infiltration runner failed for "${factionName}" at "${bestLocation.location.name}" (${infiltrationResult.reason}). ${retryAction}`, false, 'warning');
            await ns.sleep(loopSleepInterval);
            continue;
        }
        stickyInfiltrationTarget = "";

        const estimatedRep = formatInfiltrationRepEstimate(bestLocation);
        const status = `Using infiltration at "${bestLocation.location.name}" for "${factionName}" until ${Math.round(factionRepRequired).toLocaleString('en')} rep ` +
            `(need ${Math.round(remainingRep).toLocaleString('en')} more, target pays ${estimatedRep}, ` +
            `${moneyShortfall > 0 ? `still short ${formatMoney(moneyShortfall)} for desired aug cost` : `money target covered`}).`;
        if (lastFactionWorkStatus != status || (Date.now() - lastStatusUpdateTime) > statusUpdateInterval) {
            lastFactionWorkStatus = status;
            lastStatusUpdateTime = Date.now();
            ns.print(`${status} Currently at ${Math.round(currentReputation).toLocaleString('en')}, ` +
                `estimated ${estimatedRep} rep per run.`);
        }
        await tryBuyReputation(ns);
        await ns.sleep(loopSleepInterval);
        if (!forceBestAug && !forceRep) {
            let currentFavor = await getCurrentFactionFavour(ns, factionName);
            if (currentFavor === undefined)
                log(ns, `ERROR: WTF... getCurrentFactionFavour returned 'undefined' for factionName: ${factionName}`, true, 'error');
            else if (currentFavor > startingFavor)
                startingFavor = dictFactionFavors[factionName] = currentFavor;
        }
        if (factionName == "Daedalus") await daedalusSpecialCheck(ns, favorRepRequired, currentReputation);
    }
    if (currentReputation >= factionRepRequired)
        ns.print(`Attained ${Math.round(currentReputation).toLocaleString('en')} rep with "${factionName}" ` +
            `(needed ${factionRepRequired.toLocaleString('en')}).`);
    return currentReputation >= factionRepRequired;
}

/** Checks if we've ground enough Daedalus rep to unlock donations on next reset, and signals faction-manager to reset if so. */
async function daedalusSpecialCheck(ns, favorRepRequired, currentReputation) {
    if (favorRepRequired == 0 || currentReputation < favorRepRequired) return;
    // Close enough to TRP rep — no need to reset just for donations
    if (currentReputation >= 0.9 * 2.500e6 * (bitNodeMults?.AugmentationRepCost ?? 1)) return;
    log(ns, `INFO: You have enough reputation with Daedalus (have ${formatNumberShort(currentReputation)}) that you will ` +
        `unlock donations (needed ${formatNumberShort(favorRepRequired)}) with them on your next reset.`, !notifiedAboutDaedalus, "info");
    ns.write("/Temp/Daedalus-donation-rep-attained.txt", "True", "w");
    notifiedAboutDaedalus = true;
}

function formatInfiltrationRepEstimate(infiltration) {
    const rep = infiltration?.reward?.tradeRep;
    return Number.isFinite(rep) && rep > 0 ? `~${Math.round(rep).toLocaleString('en')}` : 'unknown';
}

/** Special-case factions whose reputation cannot be targeted directly.
 * Shadows of Anarchy gains reputation from successful infiltration itself, regardless of the selected reward target. */
async function handlePassiveInfiltrationFaction(ns, factionName) {
    const player = await getPlayerInfo(ns);
    const printPassiveStatus = status => {
        if (lastPassiveFactionStatus != status || (Date.now() - lastPassiveFactionStatusUpdate) > statusUpdateInterval) {
            lastPassiveFactionStatus = status;
            lastPassiveFactionStatusUpdate = Date.now();
            ns.print(status);
        }
    };
    if (player.factions.includes(factionName)) {
        const currentReputation = await getFactionReputation(ns, factionName);
        const highestRepAug = mostExpensiveAugByFaction[factionName] ?? -1;
        if (highestRepAug > 0 && currentReputation < highestRepAug)
            printPassiveStatus(`Faction "${factionName}" is passive. It gains reputation from any successful infiltration; continuing with the normal queue ` +
                `instead of targeting it directly (${Math.round(currentReputation).toLocaleString('en')}/${Math.round(highestRepAug).toLocaleString('en')} rep).`);
        return false;
    }
    const invitations = await checkFactionInvites(ns);
    if (invitations.includes(factionName))
        return await tryJoinFaction(ns, factionName);
    printPassiveStatus(`Faction "${factionName}" is second in priority, but it cannot be worked directly. Waiting for its invitation while normal infiltration progresses.`);
    return false;
}

/** Pick the best currently-feasible infiltration target by trade rep. */
async function pickBestInfiltrationLocation(ns, remainingRep = Number.POSITIVE_INFINITY, currentMoney = Number.POSITIVE_INFINITY, preferredLocationKey = "") {
    const locations = await getNsDataThroughFile(ns, `ns.infiltration.getPossibleLocations()`, '/Temp/infiltration-locations.txt');
    if (!locations?.length) return null;
    const player = await getPlayerInfo(ns);
    const infiltrationByLocation = await getInfiltrationDataByLocation(ns, locations.map(location => location.name));
    const allLocations = Object.values(infiltrationByLocation);
    const reachableLocations = allLocations
        .filter(infiltration => canReachInfiltrationLocation(infiltration, player.city, currentMoney) &&
            canHandleRepInfiltrationDifficulty(infiltration, player, getCurrentRepInfiltrationDifficultyCap(infiltration, player.city, currentMoney)));
    const candidateLocations = reachableLocations;
    if (candidateLocations.length == 0) return null;
    if (preferredLocationKey) {
        const preferredLocation = candidateLocations.find(infiltration => getInfiltrationLocationKey(infiltration) == preferredLocationKey);
        if (preferredLocation) return preferredLocation;
    }
    const selectedLocation = Number.isFinite(remainingRep) ?
        ([...candidateLocations].sort((a, b) => compareRepInfiltrationTargets(a, b, remainingRep, player.city))[0] ?? null) :
        (candidateLocations
            .sort((a, b) => b.reward.tradeRep - a.reward.tradeRep || a.difficulty - b.difficulty)[0] ?? null);
    return selectedLocation;
}

function getInfiltrationLocationKey(infiltration) {
    const location = infiltration?.location || {};
    return `${location.city || ""}|${location.name || ""}`;
}

function recordObservedInfiltrationRunTime(infiltration, result) {
    if (!result?.success || !Number.isFinite(result.durationMs) || result.durationMs <= 0) return;
    const key = getInfiltrationLocationKey(infiltration);
    const previousMs = observedInfiltrationRunTimeByLocation[key];
    observedInfiltrationRunTimeByLocation[key] = Number.isFinite(previousMs) && previousMs > 0 ?
        previousMs * 0.6 + result.durationMs * 0.4 :
        result.durationMs;
}

function shouldRetrySameInfiltrationTarget(reason) {
    return [
        'hospitalized',
        'hospitalized-retrying',
        'start-failed',
        'infiltrate.js-start-failed',
        'go-to-location-failed',
        'direct-go-to-location-failed',
        'grafting-active',
        'missing-result',
        'launch-failed',
    ].includes(reason);
}

function getCurrentRepInfiltrationDifficultyCap(infiltration, currentCity, currentMoney = Number.POSITIVE_INFINITY) {
    return Math.max(getCurrentInfiltrationDifficultyCap(infiltration, currentCity, currentMoney), repInfiltrationDifficultyCap);
}

function getRequiredCombatStatForInfiltration(infiltration, player, targetDifficultyCap = repInfiltrationDifficultyCap) {
    const startingSecurityLevel = infiltration?.startingSecurityLevel;
    if (!Number.isFinite(startingSecurityLevel)) return 0;
    const currentCharisma = player.skills.charisma || 0;
    const intelligenceAdj = (player.skills.intelligence || 0) / 1600;
    const requiredTotalStats = Math.max(0, Math.ceil(Math.pow(Math.max(0, (startingSecurityLevel - targetDifficultyCap - intelligenceAdj) * 250), 1 / 0.9)));
    return Math.max(0, Math.ceil((requiredTotalStats - currentCharisma) / 4));
}

function canHandleRepInfiltrationDifficulty(infiltration, player, targetDifficultyCap = repInfiltrationDifficultyCap) {
    if ((infiltration?.difficulty ?? Number.POSITIVE_INFINITY) < targetDifficultyCap) return true;
    const requiredCombatStat = getRequiredCombatStatForInfiltration(infiltration, player, targetDifficultyCap);
    return ["strength", "defense", "dexterity", "agility"].every(stat => (player.skills[stat] || 0) >= requiredCombatStat);
}

function getMinCombatStat(player) {
    return Math.min(player.skills.strength || 0, player.skills.defense || 0, player.skills.dexterity || 0, player.skills.agility || 0);
}

function estimateInfiltrationRunTimeMs(infiltration) {
    const observedMs = observedInfiltrationRunTimeByLocation[getInfiltrationLocationKey(infiltration)];
    if (Number.isFinite(observedMs) && observedMs > 0)
        return observedMs;
    const maxLevel = infiltration?.maxClearanceLevel || 1;
    const difficulty = infiltration?.difficulty || 0;
    return 2000 * maxLevel;
}

function estimateCombatTrainingTimeMs(player, requiredCombatStat) {
    const statOrder = ["strength", "defense", "dexterity", "agility"];
    return statOrder.reduce((total, stat) => {
        const deficit = Math.max(0, requiredCombatStat - (player.skills[stat] || 0));
        if (deficit <= 0) return total;
        const rate = Math.max(0.001, classHeuristic(player, stat));
        return total + (deficit / rate) * 60_000;
    }, 0);
}

function estimateRepInfiltrationEtaMs(infiltration, remainingRep, travelNeeded, trainingTimeMs = 0) {
    const repPerRun = Math.max(1, infiltration?.reward?.tradeRep || 0);
    const runsNeeded = Math.max(1, Math.ceil(remainingRep / repPerRun));
    const travelTimeMs = travelNeeded ? 30_000 : 0;
    return trainingTimeMs + travelTimeMs + runsNeeded * estimateInfiltrationRunTimeMs(infiltration);
}

function estimateBlendedTrainingInfiltrationEtaMs(currentBestLocation, trainingCandidate, remainingRep, playerCity) {
    const currentRunTimeMs = estimateInfiltrationRunTimeMs(currentBestLocation);
    const currentRepPerRun = Math.max(1, currentBestLocation?.reward?.tradeRep || 0);
    const runsDuringTraining = Math.max(0, Math.floor(trainingCandidate.trainingTimeMs / currentRunTimeMs));
    const repEarnedDuringTraining = runsDuringTraining * currentRepPerRun;
    const remainingAfterTraining = Math.max(0, remainingRep - repEarnedDuringTraining);
    if (remainingAfterTraining <= 0)
        return trainingCandidate.trainingTimeMs;
    return trainingCandidate.trainingTimeMs +
        estimateRepInfiltrationEtaMs(trainingCandidate.location, remainingAfterTraining, trainingCandidate.location.location?.city != playerCity);
}

async function pickInfiltrationTrainingTarget(ns, currentMoney, remainingRep, currentBestLocation) {
    if (!currentBestLocation?.reward?.tradeRep) return null;
    const locations = await getNsDataThroughFile(ns, `ns.infiltration.getPossibleLocations()`, '/Temp/infiltration-locations.txt');
    if (!locations?.length) return null;
    const infiltrationByLocation = await getInfiltrationDataByLocation(ns, locations.map(location => location.name));
    const player = await getPlayerInfo(ns);
    const currentCap = repInfiltrationDifficultyCap;
    const currentBestEtaMs = estimateRepInfiltrationEtaMs(currentBestLocation, remainingRep, currentBestLocation.location?.city != player.city);
    const allTrainingCandidates = Object.values(infiltrationByLocation)
        .filter(infiltration => canReachInfiltrationLocation(infiltration, player.city, currentMoney) &&
            (infiltration?.reward?.tradeRep || 0) > (currentBestLocation?.reward?.tradeRep || 0) &&
            infiltration?.difficulty > currentCap)
        .map(infiltration => ({
            location: infiltration,
            requiredCombatStat: getRequiredCombatStatForInfiltration(infiltration, player, currentCap)
        }))
        .filter(candidate => candidate.requiredCombatStat > 0 &&
            ["strength", "defense", "dexterity", "agility"].some(stat => player.skills[stat] < candidate.requiredCombatStat))
        .map(candidate => {
            const trainingTimeMs = estimateCombatTrainingTimeMs(player, candidate.requiredCombatStat);
            const totalEtaMs = estimateRepInfiltrationEtaMs(candidate.location, remainingRep, candidate.location.location?.city != player.city, trainingTimeMs);
            const blendedEtaMs = estimateBlendedTrainingInfiltrationEtaMs(currentBestLocation, { ...candidate, trainingTimeMs }, remainingRep, player.city);
            return { ...candidate, trainingTimeMs, totalEtaMs, blendedEtaMs, currentBestEtaMs };
        });
    const trainingCandidates = allTrainingCandidates
        .filter(candidate => candidate.blendedEtaMs < currentBestEtaMs)
        .sort((a, b) => b.location.reward.tradeRep - a.location.reward.tradeRep ||
            a.blendedEtaMs - b.blendedEtaMs ||
            a.requiredCombatStat - b.requiredCombatStat);
    const selectedTrainingTarget = trainingCandidates[0] ?? null;
    if (selectedTrainingTarget)
        devConsoleLog(`Selected infiltration training target "${selectedTrainingTarget.location.location.name}" ` +
            `requiring combat stats ${selectedTrainingTarget.requiredCombatStat}. ETA current="${formatDuration(selectedTrainingTarget.currentBestEtaMs)}", ` +
            `training="${formatDuration(selectedTrainingTarget.trainingTimeMs)}", blended="${formatDuration(selectedTrainingTarget.blendedEtaMs)}", ` +
            `target="${formatDuration(selectedTrainingTarget.totalEtaMs)}", rep/run ~${Math.round(selectedTrainingTarget.location.reward.tradeRep).toLocaleString('en')}.`);
    return selectedTrainingTarget;
}

async function getInfiltrationDataByLocation(ns, locationNames, batchSize = 5) {
    const infiltrationByLocation = {};
    for (let i = 0; i < locationNames.length; i += batchSize) {
        const batch = locationNames.slice(i, i + batchSize);
        const batchResults = await getNsDataThroughFile(ns,
            dictCommand('ns.infiltration.getInfiltration(o)'), '/Temp/infiltration-info.txt', batch);
        Object.assign(infiltrationByLocation, batchResults);
    }
    return infiltrationByLocation;
}

function printNoFactionInfiltrationTargetStatus(ns, factionName) {
    const status = `No feasible infiltration target right now. Waiting instead of starting faction work for "${factionName}".`;
    if (status == lastNoFactionInfiltrationTargetStatus &&
        Date.now() - lastNoFactionInfiltrationTargetStatusUpdate < 5 * statusUpdateInterval)
        return;
    lastNoFactionInfiltrationTargetStatus = status;
    lastNoFactionInfiltrationTargetStatusUpdate = Date.now();
    ns.print(status);
}

function compareRepInfiltrationTargets(a, b, remainingRep, currentCity) {
    const aStats = getRepInfiltrationTargetStats(a, remainingRep, currentCity);
    const bStats = getRepInfiltrationTargetStats(b, remainingRep, currentCity);
    if (aStats.runCount == 1 && bStats.runCount == 1) {
        return aStats.etaMs - bStats.etaMs ||
            aStats.difficulty - bStats.difficulty ||
            aStats.travelPenalty - bStats.travelPenalty ||
            aStats.overshoot - bStats.overshoot ||
            bStats.tradeRep - aStats.tradeRep;
    }
    return bStats.tradeRep - aStats.tradeRep ||
        aStats.difficulty - bStats.difficulty ||
        aStats.travelPenalty - bStats.travelPenalty ||
        aStats.runCount - bStats.runCount ||
        aStats.overshoot - bStats.overshoot;
}

function getRepInfiltrationTargetStats(infiltration, remainingRep, currentCity) {
    const tradeRep = infiltration?.reward?.tradeRep || 0;
    const difficulty = infiltration?.difficulty ?? Number.POSITIVE_INFINITY;
    const runCount = tradeRep > 0 ? Math.ceil(remainingRep / tradeRep) : Number.POSITIVE_INFINITY;
    const overshoot = tradeRep > 0 ? Math.max(0, tradeRep * runCount - remainingRep) : Number.POSITIVE_INFINITY;
    const travelPenalty = infiltration?.location?.city == currentCity ? 0 : 1;
    const etaMs = estimateRepInfiltrationEtaMs(infiltration, remainingRep, travelPenalty > 0);
    return { tradeRep, difficulty, runCount, overshoot, travelPenalty, etaMs };
}

async function pickBestMoneyInfiltrationLocation(ns, currentMoney = Number.POSITIVE_INFINITY, scanResult = null) {
    const locations = await getNsDataThroughFile(ns, `ns.infiltration.getPossibleLocations()`, '/Temp/infiltration-locations.txt');
    if (!locations?.length) return null;
    const player = await getPlayerInfo(ns);
    const localPossibleLocations = locations
        .filter(location => location?.city == player.city)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (scanResult) {
        scanResult.hasLocalMoneyTarget = localPossibleLocations.length > 0;
        scanResult.bestLocalMoneyTarget = localPossibleLocations[0] ?
            { location: localPossibleLocations[0], reward: { sellCash: 0 }, difficulty: Number.POSITIVE_INFINITY, maxClearanceLevel: 0, startingSecurityLevel: Number.POSITIVE_INFINITY } :
            null;
    }
    const infiltrationByLocation = await getInfiltrationDataByLocation(ns, locations.map(location => location.name));
    if (!infiltrationByLocation || typeof infiltrationByLocation != 'object' || Array.isArray(infiltrationByLocation)) {
        devConsoleLog(`Money infiltration scan could not read infiltration details: ${String(infiltrationByLocation).slice(0, 500)}`);
        return scanResult?.bestLocalMoneyTarget ?? null;
    }
    const allLocations = Object.values(infiltrationByLocation)
        .filter(infiltration => infiltration && typeof infiltration == 'object' && infiltration.location);
    const reachableLocations = allLocations
        .filter(infiltration => infiltration?.reward?.sellCash > 0 &&
            canReachInfiltrationLocation(infiltration, player.city, currentMoney) &&
            canHandleRepInfiltrationDifficulty(infiltration, player, getCurrentInfiltrationDifficultyCap(infiltration, player.city, currentMoney)) &&
            !isLocationCoolingDown(infiltration.location?.name));
    const localMoneyLocations = allLocations
        .filter(infiltration => infiltration?.reward?.sellCash > 0 &&
            infiltration.location?.city == player.city)
        .sort((a, b) => b.reward.sellCash - a.reward.sellCash || a.difficulty - b.difficulty);
    if (scanResult) {
        scanResult.hasLocalMoneyTarget = scanResult.hasLocalMoneyTarget || localMoneyLocations.length > 0;
        scanResult.bestLocalMoneyTarget = localMoneyLocations[0] ?? scanResult.bestLocalMoneyTarget ?? null;
    }
    if (reachableLocations.length == 0) {
        devConsoleLog(`Money infiltration scan found no feasible targets for currentCity="${player.city}", currentMoney=${Math.round(currentMoney).toLocaleString('en')}. ` +
            `locations=${locations.length}, detailedLocations=${allLocations.length}, localPossible=${localPossibleLocations.map(location => `"${location.name}"`).join(', ') || 'none'}.`);
        if (scanResult?.bestLocalMoneyTarget && !Number.isFinite(scanResult.bestLocalMoneyTarget.difficulty))
            return scanResult.bestLocalMoneyTarget;
        return null;
    }
    const selectedLocation = reachableLocations
        .sort((a, b) => b.reward.sellCash - a.reward.sellCash || a.difficulty - b.difficulty)[0] ?? null;
    if (selectedLocation)
        devConsoleLog(`Money infiltration target "${selectedLocation.location?.name}"@${selectedLocation.location?.city} ` +
            `(payout ~${formatMoney(selectedLocation.reward.sellCash || 0)}).`);
    return selectedLocation;
}

function canReachInfiltrationLocation(infiltration, currentCity, currentMoney) {
    const targetCity = infiltration?.location?.city;
    if (!targetCity || targetCity == currentCity) return true;
    return currentMoney >= cityTravelCost;
}

function getCurrentInfiltrationDifficultyCap(infiltration, currentCity, currentMoney = Number.POSITIVE_INFINITY) {
    const targetCity = infiltration?.location?.city;
    if (!targetCity || targetCity == currentCity)
        return options['max-infiltration-difficulty'];
    return currentMoney < cityTravelCost ?
        Math.min(options['max-infiltration-difficulty'], lowMoneyInfiltrationDifficulty) :
        options['max-infiltration-difficulty'];
}

function isLocationCoolingDown(locationName) {
    if (!locationName) return false;
    const until = recentHospitalizedLocations[locationName] || 0;
    if (until <= Date.now()) {
        delete recentHospitalizedLocations[locationName];
        return false;
    }
    return true;
}

function noteHospitalizedInfiltration(location) {
    const locationName = location?.location?.name;
    devConsoleLog(`Infiltration location "${locationName}" hospitalized us. Retrying the same target; not switching companies.`);
}

function noteTravelFailedInfiltration(location) {
    const locationName = location?.location?.name;
    if (locationName)
        recentHospitalizedLocations[locationName] = Date.now() + infiltrationTravelFailedLocationCooldown;
    devConsoleLog(`Infiltration location "${locationName}" put on cooldown after travel failure.`);
}

function noteFailedInfiltration(location, reason = "failure") {
    const locationName = location?.location?.name;
    if (locationName)
        recentHospitalizedLocations[locationName] = Date.now() + infiltrationTravelFailedLocationCooldown;
    devConsoleLog(`Infiltration location "${locationName}" put on cooldown after ${reason}.`);
}

/** @param {NS} ns */
async function healAfterInfiltrationIfNeeded(ns, reason = "infiltration") {
    const result = await getNsDataThroughFile(ns, `(() => {
        const player = ns.getPlayer();
        const currentHp = Number(player.hp?.current || 0);
        const maxHp = Number(player.hp?.max || 0);
        const missingHp = Math.max(0, maxHp - currentHp);
        const money = Number(player.money || 0);
        const cost = money < 0 ? 0 : Math.min(money * 0.1, missingHp * 100000);
        if (missingHp <= 0)
            return { healed: false, reason: "full-hp", currentHp, maxHp, money, cost };
        if (money < 0 || cost > money)
            return { healed: false, reason: "insufficient-money", currentHp, maxHp, money, cost };
        ns.singularity.hospitalize();
        const after = ns.getPlayer();
        return {
            healed: true,
            reason: "hospitalized",
            currentHp,
            maxHp,
            afterHp: after.hp,
            moneyBefore: money,
            moneyAfter: after.money,
            cost,
        };
    })()`, `/Temp/post-infiltration-heal-${ns.pid}.txt`);
    if (!result || result.reason == "full-hp") return false;
    if (result.healed) {
        const afterHp = result.afterHp || {};
        const cost = Math.max(0, (result.moneyBefore || 0) - (result.moneyAfter || 0), result.cost || 0);
        log(ns, `INFO: Healed after ${reason}: HP ${formatHp(result.currentHp)} / ${formatHp(result.maxHp)} -> ` +
            `${formatHp(afterHp.current || result.maxHp)} / ${formatHp(afterHp.max || result.maxHp)}, cost ${formatMoney(cost)}.`, false, 'info');
        return true;
    }
    log(ns, `WARNING: Wanted to heal after ${reason}, but skipped hospitalize because ${result.reason}. ` +
        `HP ${formatHp(result.currentHp)} / ${formatHp(result.maxHp)}, ` +
        `cash ${formatMoney(result.money)}, estimated cost ${formatMoney(result.cost)}.`, false, 'warning');
    return false;
}

function formatHp(value) {
    return Number(value || 0).toFixed(1);
}

async function workForInfiltrationMoney(ns, moneyTarget) {
    const currentMoney = (await getPlayerInfo(ns)).money;
    if ((bitNodeMults.InfiltrationMoney || 0) <= 0) {
        const status = `Infiltration currently pays $0 in this BitNode. Waiting instead of farming money via infiltration or crime.`;
        if (status != lastMoneyFallbackStatus) {
            lastMoneyFallbackStatus = status;
            ns.print(status);
        }
        await ns.sleep(loopSleepInterval);
        return false;
    }
    const moneyInfiltrationScan = {};
    const bestLocation = await pickBestMoneyInfiltrationLocation(ns, currentMoney, moneyInfiltrationScan);
    if (!bestLocation) {
        if (moneyInfiltrationScan.hasLocalMoneyTarget)
            return await waitForLocalMoneyInfiltration(ns, moneyInfiltrationScan.bestLocalMoneyTarget);
        return await workForFallbackCrimeMoney(ns, moneyTarget);
    }
    return await runMoneyInfiltration(ns, bestLocation, currentMoney, moneyTarget);
}

/** @param {NS} ns */
async function runMoneyInfiltration(ns, bestLocation, currentMoney, moneyTarget) {
    await ensureBackgroundWeakestCombatTraining(ns, "money infiltration", bestLocation.location.city);
    const targetSummary = moneyTarget > currentMoney ?
        `target ${formatMoney(moneyTarget)}, ` :
        '';
    const status = `Using infiltration at "${bestLocation.location.name}" for money ` +
        `(current ${formatMoney(currentMoney)}, ${targetSummary}payout ${bestLocation.reward.sellCash > 0 ? `~${formatMoney(bestLocation.reward.sellCash)}` : 'unknown'}).`;
    if (lastFactionWorkStatus != status) {
        lastFactionWorkStatus = status;
        ns.print(status);
    }
    const playerBeforeTravel = await getPlayerInfo(ns);
    const travelNeeded = playerBeforeTravel.city != bestLocation.location.city;
    moneyInfiltrationConsoleStatus(`target ${bestLocation.location.name}@${bestLocation.location.city} ${formatMoney(bestLocation.reward.sellCash)}`);
    if (travelNeeded) {
        const travelWorked = await goToCity(ns, bestLocation.location.city);
        if (!travelWorked) {
            moneyInfiltrationConsoleStatus(`travel-failed ${bestLocation.location.name}@${bestLocation.location.city}`, 'error');
            devConsoleLog(`Travel failed from "${playerBeforeTravel.city}" to "${bestLocation.location.city}" for money infiltration at "${bestLocation.location.name}".`);
            noteTravelFailedInfiltration(bestLocation);
            return false;
        }
    }
    const infiltrationResult = await runInfiltrationRunner(ns, bestLocation.location.city, bestLocation.location.name, null, true, false);
    recordObservedInfiltrationRunTime(bestLocation, infiltrationResult);
    await healAfterInfiltrationIfNeeded(ns, `${bestLocation.location.name} -> cash`);
    if (!infiltrationResult.success) {
        if (infiltrationResult.reason == 'hospitalized')
            noteHospitalizedInfiltration(bestLocation);
        if (infiltrationResult.reason == 'travel-failed')
            noteTravelFailedInfiltration(bestLocation);
        moneyInfiltrationConsoleStatus(`failed ${bestLocation.location.name}@${bestLocation.location.city}: ${infiltrationResult.reason}`, 'error');
        log(ns, `WARN: Money infiltration runner failed at "${bestLocation.location.name}" (${infiltrationResult.reason}).`, false, 'warning');
    } else
        moneyInfiltrationConsoleStatus(`done ${bestLocation.location.name}@${bestLocation.location.city}`);
    return infiltrationResult.success;
}

/** @param {NS} ns */
async function waitForLocalMoneyInfiltration(ns, localLocation) {
    const player = await getPlayerInfo(ns);
    const cap = getCurrentInfiltrationDifficultyCap(localLocation, player.city, player.money);
    const requiredCombatStat = getRequiredCombatStatForInfiltration(localLocation, player, cap);
    const status = `Local money infiltration target "${localLocation.location.name}" exists, but no currently feasible infiltration target was selected. ` +
        `Waiting instead of falling back to crime. Combat min ${getMinCombatStat(player)}, target ${requiredCombatStat}, ` +
        `difficulty ${Number.isFinite(localLocation.difficulty) ? localLocation.difficulty.toFixed(3) : 'unknown'}, ` +
        `cap ${Number.isFinite(cap) ? cap.toFixed(3) : 'unknown'}.`;
    if (status != lastMoneyFallbackStatus) {
        lastMoneyFallbackStatus = status;
        ns.print(status);
    }
    if (requiredCombatStat > 0)
        await startBackgroundCombatTraining(ns, requiredCombatStat, "money infiltration", localLocation.location.city);
    else
        await ensureBackgroundWeakestCombatTraining(ns, "money infiltration", localLocation.location.city);
    await ns.sleep(loopSleepInterval);
    return false;
}

/** @param {NS} ns */
async function workForFallbackCrimeMoney(ns, moneyTarget) {
    const player = await getPlayerInfo(ns);
    if (options['no-crime'] || options['no-focus']) {
        ns.print(`No feasible infiltration target right now, and crime fallback is disabled. Waiting instead of farming cash.`);
        await ns.sleep(loopSleepInterval);
        return false;
    }
    if ((bitNodeMults.CrimeMoney || 0) <= 0) {
        const currentWork = await getCurrentWorkInfo(ns);
        if (currentWork?.type == "CRIME")
            await stop(ns);
        const status = `No feasible infiltration target right now, and crimes currently pay $0 in this BitNode. Waiting instead of farming zero-cash crime.`;
        if (status != lastMoneyFallbackStatus) {
            lastMoneyFallbackStatus = status;
            ns.print(status);
        }
        await ns.sleep(loopSleepInterval);
        return false;
    }
    const mugStats = await getNsDataThroughFile(ns, 'ns.singularity.getCrimeStats(ns.args[0])', '/Temp/crime-money-fallback.txt', ["Mug"]);
    if ((mugStats?.money || 0) <= 0) {
        const currentWork = await getCurrentWorkInfo(ns);
        if (currentWork?.type == "CRIME" && String(currentWork?.crimeType || "").includes("Mug"))
            await stop(ns);
        const status = `No feasible infiltration target right now, and "Mug" currently pays ${formatMoney(mugStats?.money || 0)}. ` +
            `Waiting instead of farming zero-cash crime.`;
        if (status != lastMoneyFallbackStatus) {
            lastMoneyFallbackStatus = status;
            ns.print(status);
        }
        await ns.sleep(loopSleepInterval);
        return false;
    }
    const fallbackTarget = Math.max(0, Math.min(moneyTarget, cityTravelCost));
    const status = `No feasible infiltration target right now. Falling back to "Mug" until cash reaches ${formatMoney(fallbackTarget)} ` +
        `(current ${formatMoney(player.money)}, payout ${formatMoney(mugStats.money)}).`;
    if (status != lastMoneyFallbackStatus) {
        lastMoneyFallbackStatus = status;
        ns.print(status);
    }
    const currentWork = await getCurrentWorkInfo(ns);
    const crimeType = currentWork?.crimeType || "";
    if (!(currentWork?.type == "CRIME" && crimeType.includes("Mug"))) {
        if (await isValidInterruption(ns, currentWork)) return false;
        const focusArg = shouldFocus === undefined ? true : shouldFocus;
        await getNsDataThroughFile(ns, 'ns.singularity.commitCrime(ns.args[0], ns.args[1])', null, ["Mug", focusArg]);
        if (shouldFocus && !options['no-tail-windows']) tail(ns);
    }
    await ns.sleep(Math.max(loopSleepInterval, mugStats.time || 0));
    return true;
}

function devConsoleLog(message) {
    if (!options?.['infiltration-debug']) return;
    devConsole('log', `[work-for-factions pid=${scriptPid}] ${message}`);
}

function applyTailLayout(ns) {
    const width = Number(options['tail-width']);
    const height = Number(options['tail-height']);
    const x = Number(options['tail-x']);
    const y = Number(options['tail-y']);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        ns.ui.resizeTail(width, height, ns.pid);
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0)
        ns.ui.moveTail(x, y, ns.pid);
}

function infiltrationConsoleStatus(message, method = 'log') {
    if (message == lastInfiltrationConsoleStatus) return;
    lastInfiltrationConsoleStatus = message;
    devConsole(method, `[infiltration] ${message}`);
}

function moneyInfiltrationConsoleStatus(message, method = 'log') {
    if (message == lastMoneyInfiltrationConsoleStatus) return;
    lastMoneyInfiltrationConsoleStatus = message;
    devConsole(method, `[money-infiltration] ${message}`);
}

function formatFactionInfiltrationSelection(bestLocation, factionName, remainingRep, travelRoute = "") {
    const repPerRun = Math.max(0, bestLocation?.reward?.tradeRep || 0);
    const runsNeeded = repPerRun > 0 ? Math.max(1, Math.ceil(remainingRep / repPerRun)) : "?";
    const etaMs = estimateRepInfiltrationEtaMs(bestLocation, remainingRep, !!travelRoute);
    return `target ${bestLocation.location.name}@${bestLocation.location.city} -> ${factionName} ` +
        `(need ${Math.round(remainingRep).toLocaleString('en')} rep, ` +
        `${repPerRun > 0 ? `~${Math.round(repPerRun).toLocaleString('en')}/run` : "rep/run unknown"}, ` +
        `${runsNeeded} run${runsNeeded === 1 ? "" : "s"}, ETA ${formatDuration(etaMs)}` +
        `${travelRoute ? `, travel ${travelRoute}` : ""})`;
}

/** @param {NS} ns */
async function runInfiltrationRunner(ns, city, company, factionName = null, takeCash = false, allowTravel = true) {
    const resultFile = `/Temp/infiltration-runner-${ns.pid}.txt`;
    ns.rm(resultFile);
    const args = ['--city', city, '--company', company, '--result-file', resultFile];
    if (takeCash) args.push('--cash');
    else args.push('--faction', factionName);
    if (options['infiltration-debug']) args.push('--debug');
    const locationPrep = await prepareInfiltrationLocation(ns, city, company, shouldTreatGraftingAsBackground(factionName));
    if (!locationPrep.opened) {
        if (locationPrep.blocked == "grafting") {
            const result = { success: false, reason: 'grafting-active' };
            const detail = formatLocationPrepFailure(locationPrep);
            infiltrationConsoleStatus(`paused ${company}@${city}: ${result.reason}${detail} v=${workForFactionsVersion}`, 'log');
            return result;
        }
        const result = { success: false, reason: 'direct-go-to-location-failed' };
        const detail = formatLocationPrepFailure(locationPrep);
        infiltrationConsoleStatus(`failed ${company}@${city}: ${result.reason}${detail} v=${workForFactionsVersion}`, 'error');
        return result;
    }
    args.push('--location-ready');
    const startedAt = Date.now();
    const pid = await getNsDataThroughFile(ns, 'ns.run(ns.args[0], 1, ...JSON.parse(ns.args[1]))', null,
        [getFilePath('infiltration-runner.js'), JSON.stringify(args)]);
    if (!pid) {
        infiltrationConsoleStatus(`launch-failed ${company}@${city}`, 'error');
        return { success: false, reason: 'launch-failed' };
    }
    while (await getNsDataThroughFile(ns, 'ns.isRunning(ns.args[0])', null, [pid]))
        await ns.sleep(100);
    const result = ns.read(resultFile);
    const parsedResult = result ? JSON.parse(result) : { success: false, reason: 'missing-result' };
    parsedResult.durationMs = Date.now() - startedAt;
    infiltrationConsoleStatus(`${parsedResult.success ? 'done' : 'failed'} ${company}@${city}: ${parsedResult.reason}`,
        parsedResult.success ? 'log' : 'error');
    return parsedResult;
}

/** @param {NS} ns */
async function prepareInfiltrationLocation(ns, city, company, allowGraftingBackground = false) {
    const result = await getNsDataThroughFile(ns, `(() => {
        const city = ns.args[0];
        const company = ns.args[1];
        const allowGraftingBackground = ns.args[2];
        const beforePlayer = ns.getPlayer();
        const beforeWork = ns.singularity.getCurrentWork();
        const result = {
            requestedCity: city,
            company,
            beforeCity: beforePlayer.city,
            beforeWork,
            stopped: false,
            travelAttempted: false,
            travelResult: null,
            cityAfterTravel: beforePlayer.city,
            opened: false,
            afterCity: beforePlayer.city,
            afterWork: beforeWork,
        };
        if (beforeWork?.type == "GRAFTING" && !allowGraftingBackground)
            return { ...result, blocked: "grafting" };
        if (beforeWork?.type && beforeWork.type != "CLASS" && beforeWork.type != "GRAFTING") {
            result.stopped = ns.singularity.stopAction();
        }
        if (ns.getPlayer().city != city) {
            result.travelAttempted = true;
            result.travelResult = ns.singularity.travelToCity(city);
            result.cityAfterTravel = ns.getPlayer().city;
        }
        if (ns.getPlayer().city == city)
            result.opened = ns.singularity.goToLocation(company);
        result.afterCity = ns.getPlayer().city;
        result.afterWork = ns.singularity.getCurrentWork();
        return result;
    })()`, `/Temp/infiltration-location-prep-${ns.pid}.txt`, [city, company, allowGraftingBackground]);
    if (!result?.opened)
        devConsoleLog(`Direct infiltration location prep failed: ${JSON.stringify(result || {})}.`);
    return result || { opened: false, error: "missing-result" };
}

function formatLocationPrepFailure(result) {
    if (!result) return " (error=no-result)";
    const parts = [];
    if (result.error) parts.push(`error=${result.error}`);
    if (result.blocked) parts.push(`blocked=${result.blocked}`);
    if (result.beforeCity) parts.push(`beforeCity=${result.beforeCity}`);
    if (result.beforeCity && result.requestedCity && result.beforeCity != result.requestedCity)
        parts.push(`city ${result.beforeCity}->${result.cityAfterTravel || result.afterCity || "?"}`);
    if (result.travelAttempted)
        parts.push(`travel=${result.travelResult}`);
    if (result.beforeWork?.type)
        parts.push(`work=${result.beforeWork.type}${result.stopped ? "/stopped" : ""}`);
    if (result.afterWork?.type)
        parts.push(`afterWork=${result.afterWork.type}`);
    if (result.afterCity && result.requestedCity && result.afterCity != result.requestedCity)
        parts.push(`afterCity=${result.afterCity}`);
    if (result.opened !== undefined) parts.push(`opened=${result.opened}`);
    return parts.length ? ` (${parts.join(", ")})` : " (error=no-detail)";
}

/** Stop whatever focus work we're currently doing
 * @param {NS} ns */
async function stop(ns) { return await getNsDataThroughFile(ns, `ns.singularity.stopAction()`); }

/** Start the specified faction work
 * @param {NS} ns */
async function startWorkForFaction(ns, factionName, work, focus) {
    //log(ns, `INFO: startWorkForFaction(${factionName}, ${work}, ${focus})`);
    return await getNsDataThroughFile(ns, `ns.singularity.workForFaction(ns.args[0], ns.args[1], ns.args[2])`, null, [factionName, work, focus])
}

/** Measure our rep gain rate (per second)
 * TODO: Move this to helpers.js, measure all rep gain rates over a parameterizable number of game ticks (default 1) and return them all.
 * @param {NS} ns
 * @param {() => Promise<number>} fnSampleReputation - An async function that samples the reputation at a current point in time */
async function measureRepGainRate(ns, fnSampleReputation) {
    //return (await getPlayerInfo(ns)).workRepGainRate;
    // The game no longer provides the rep gain rate for a given work type, so we must measure it
    const initialReputation = await fnSampleReputation();
    let nextTickReputation;
    let start = Date.now();
    while (initialReputation == (nextTickReputation = await fnSampleReputation()) && Date.now() - start < 450)
        await ns.sleep(50);
    return (nextTickReputation - initialReputation) * 5; // Assume this rep gain was for a 200 tick
}
/** Measure our faction rep gain rate (per second)
 * @param {NS} ns */
async function measureFactionRepGainRate(ns, factionName) {
    return await measureRepGainRate(ns, async () => await getFactionReputation(ns, factionName));
}
/** Measure our company rep gain rate (per second)
 * @param {NS} ns */
async function measureCompanyRepGainRate(ns, companyName) {
    return await measureRepGainRate(ns, async () => await getCompanyReputation(ns, companyName));
}

/** Try all work types and see what gives the best rep gain with this faction!
 * @param {NS} ns
 * @param {string} factionName The name of the faction to work for
 * @returns {Promise<FactionWorkType>} The faction work type measured to give the best reputation gain rate */
async function detectBestFactionWork(ns, factionName) {
    let bestWork, bestRepRate = 0;
    for (const work of Object.values(ns.enums.FactionWorkType)) {
        if (!(await startWorkForFaction(ns, factionName, work, shouldFocus))) {
            //ns.print(`"${factionName}": "${work}"" work not supported.`);
            continue; // This type of faction work must not be supported
        }
        const currentRepGainRate = await measureFactionRepGainRate(ns, factionName);

        //ns.print(`"${factionName}" work ${work} provides ${formatNumberShort(currentRepGainRate)} rep rate`);
        if (currentRepGainRate > bestRepRate) {
            bestRepRate = currentRepGainRate;
            bestWork = work;
        }
    }
    if (bestWork === undefined) {
        mainLoopStart = 0; // Force break out of whatever work loop we're in to update info (maybe we formed a gang with the faction we were working for?)
        throw Error(`The faction "${factionName}" does not support any of the known work types. Cannot work for this faction!`);
    }
    return bestWork;
}

/** @param {NS} ns
 *  @param {Array<string>} megacorpFactionsInPreferredOrder - The list of all corporate factions to work for, sorted in the order they should be worked for
 *  @param {Array<string>} megacorpFactionsInPreferredOrder - The list of all corporate factions, sorted in the order they should be worked for
 * */
export async function workForAllMegacorps(ns, megacorpFactionsInPreferredOrder, alsoWorkForCompanyFactions, oneCompanyFactionAtATime) {
    let player = await getPlayerInfo(ns);
    if (player.skills.hacking < 225)
        return ns.print(`Hacking Skill ${player.skills.hacking} is to low to work for any megacorps (min req. 225).`);
    let joinedCompanyFactions = player.factions.filter(f => megacorpFactionsInPreferredOrder.includes(f)); // Company factions we've already joined
    if (joinedCompanyFactions.length > 0)
        ns.print(`${joinedCompanyFactions.length} companies' factions have already been joined: ${joinedCompanyFactions.join(", ")}`)
    let doFactionWork = alsoWorkForCompanyFactions && oneCompanyFactionAtATime;
    // Earn each obtainabl megacorp faction invite, and optionally also grind faction rep
    let earnedAnyInvite = false;
    for (const factionName of megacorpFactionsInPreferredOrder) {
        const earnedInvite = await workForMegacorpFactionInvite(ns, factionName, doFactionWork);
        earnedAnyInvite = earnedAnyInvite || earnedInvite;
        if (earnedInvite && doFactionWork && !breakToMainLoop())
            await workForSingleFaction(ns, factionName);
        if (breakToMainLoop()) return;
    }
    if (alsoWorkForCompanyFactions && !oneCompanyFactionAtATime) { // If configured, start grinding rep with company factions we've joined
        if (earnedAnyInvite) // Avoid log noise by only logging this when a new invite was earned
            ns.print(`Done working for companies, now working for all incomplete company factions...`);
        for (const factionName of megacorpFactionsInPreferredOrder)
            if (!breakToMainLoop()) await workForSingleFaction(ns, factionName);
    }
}

/** Helper to spend hashes on something and return the amount of hashes spent (if any)
 * @param {NS} ns */
async function trySpendHashes(ns, spendOn) {
    return await getNsDataThroughFile(ns,
        'ns.hacknet.numHashes() + ns.hacknet.spendHashes(ns.args[0]) - ns.hacknet.numHashes()',
        '/Temp/hacknet-spendHashes-returnSpent.txt', [spendOn]);
}

/** If we're wealthy, hashes have relatively little monetary value, spend hacknet-node hashes on contracts to gain rep faster
 * @param {NS} ns */
export async function tryBuyReputation(ns) {
    if (options['no-coding-contracts']) return;
    if ((await getPlayerInfo(ns)).money > 100E9) { // If we're wealthy, hashes have relatively little monetary value, spend hacknet-node hashes on contracts to gain rep faster
        let spentHashes = await trySpendHashes(ns, "Generate Coding Contract");
        if (spentHashes > 0) {
            log(ns, `Generated a new coding contract for ${formatNumberShort(Math.round(spentHashes / 100) * 100)} hashes`, false, 'success');
        }
    }
}

// Used when working for a company to see if their server has been backdoored. If so, we can expect an increase in rep-gain (used for predicting an ETA)
const serverByCompany = { "Bachman & Associates": "b-and-a", "ECorp": "ecorp", "Clarke Incorporated": "clarkinc", "OmniTek Incorporated": "omnitek", "NWO": "nwo", "Blade Industries": "blade", "MegaCorp": "megacorp", "KuaiGong International": "kuai-gong", "Fulcrum Technologies": "fulcrumtech", "Four Sigma": "4sigma" };

/** Apply to the specified role at the specified company
 * @param {NS} ns */
async function tryApplyToCompany(ns, company, role) {
    return await getNsDataThroughFile(ns, `ns.singularity.applyToCompany(ns.args[0], ns.args[1])`, null, [company, role])
}

/** Check if the server associated with the specified company has been backdoored. TODO: We could be caching this result once true.
 * @param {NS} ns
 * @returns {Promise<boolean>} True if the company is backdoored */
async function checkForBackdoor(ns, companyName) {
    return await getNsDataThroughFile(ns, `ns.getServer(ns.args[0]).backdoorInstalled`, null, [serverByCompany[companyName]]);
}

/** Check the backdoor status of every server.
 * @param {NS} ns
 * @returns {Promise<{[serverName:string]: boolean}>} An entry per server, and whether they're backdoored. */
async function backdoorStatusByServer(ns) {
    return await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(s => [s, ns.getServer(s).backdoorInstalled]))`,
        '/Temp/getServer-backdoorInstalled-all.txt', Object.values(serverByCompany));
}

/** @param {NS} ns */
export async function workForMegacorpFactionInvite(ns, factionName, waitForInvite) {
    if (options['no-company-work'])
        return ns.print(`Skipping company work for "${factionName}" because --no-company-work is set.`);
    const companyConfig = companySpecificConfigs.find(c => c.name == factionName); // For anything company-specific
    const companyName = companyConfig?.companyName || factionName; // Name of the company that gives the faction (same for all but Fulcrum)
    const statModifier = companyConfig?.statModifier || 0; // How much e.g. Hack / Cha is needed for a promotion above the base requirement for the job

    let player = await getPlayerInfo(ns);
    if (player.factions.includes(factionName)) return false; // Only return true if we did work to earn a new faction invite
    if ((await checkFactionInvites(ns)).includes(factionName))
        return waitForInvite ? await waitForFactionInvite(ns, factionName) : false;
    // TODO: In some scenarios, the best career path may require combat stats, this hard-codes the optimal path for hack stats
    const itJob = jobs.find(j => j.name == "IT");
    const softwareJob = jobs.find(j => j.name == "Software");
    const securityJob = jobs.find(j => j.name == "Security");
    if (itJob.reqHck[0] + statModifier > player.skills.hacking) // We don't qualify to work for this company yet if we can't meet IT qualifications (lowest there are)
        return ns.print(`Cannot yet work for "${companyName}": Need Hack ${itJob.reqHck[0] + statModifier} to get hired (current Hack: ${player.skills.hacking});`);
    ns.print(`Going to work for Company "${companyName}" next...`)
    let currentReputation, currentRole = "", currentJobTier = -1; // TODO: Derive our current position and promotion index based on player.jobs[companyName]
    let lastStatus = "", lastStatusUpdateTime = 0;
    let isStudying = false, isWorking = false, decidedNotToStudy = false;
    let backdoored = await checkForBackdoor(ns, companyName);
    let repRequiredForFaction = (companyConfig?.repRequiredForFaction || 400_000) - (backdoored ? 100_000 : 0);
    while (((currentReputation = (await getCompanyReputation(ns, companyName))) < repRequiredForFaction) && !player.factions.includes(factionName)) {
        if (breakToMainLoop()) return ns.print('INFO: Interrupting corporation work to check on high-level priorities.');
        // Determine the next promotion we're striving for (the sooner we get promoted, the faster we can earn company rep)
        const getTier = job => Math.min( // Check all requirements for all job (taking into account modifiers) and find the minimum we meet
            job.reqRep.filter(r => (r * (backdoored ? 0.75 : 1)) <= currentReputation).length,
            job.reqHck.filter(h => (h === 0 ? 0 : h + statModifier) <= player.skills.hacking).length,
            job.reqStr.filter(s => (s === 0 ? 0 : s + statModifier) <= player.skills.strength).length,
            job.reqDef.filter(v => (v === 0 ? 0 : v + statModifier) <= player.skills.defense).length,
            job.reqDex.filter(d => (d === 0 ? 0 : d + statModifier) <= player.skills.dexterity).length,
            job.reqAgi.filter(a => (a === 0 ? 0 : a + statModifier) <= player.skills.agility).length,
            job.reqCha.filter(c => (c === 0 ? 0 : c + statModifier) <= player.skills.charisma).length) - 1;
        const qualifyingItTier = getTier(itJob), qualifyingSoftwareTier = getTier(softwareJob), qualifyingSecurityTier = getTier(securityJob);
        const combatAvg = (player.skills.strength + player.skills.defense + player.skills.dexterity + player.skills.agility) / 4;
        const secBetter = securityCompanies.includes(companyName) && combatAvg > player.skills.hacking;
        const bestJobTier = secBetter ? qualifyingSecurityTier : Math.max(qualifyingItTier, qualifyingSoftwareTier);
        const bestRoleName = secBetter ? "Security" : qualifyingItTier > qualifyingSoftwareTier ? "IT" : "Software";
        if (currentJobTier < bestJobTier || currentRole != bestRoleName) { // We are ready for a promotion, ask for one!
            if (await tryApplyToCompany(ns, companyName, bestRoleName))
                log(ns, `Successfully applied to "${companyName}" for a '${bestRoleName}' Job or Promotion`, false, 'success');
            else if (currentJobTier !== -1) // Unless we just restarted "work-for-factions" and lost track of our current job, this is an error
                log(ns, `Application to "${companyName}" for a '${bestRoleName}' Job or Promotion failed.`, false, 'error');
            currentJobTier = bestJobTier; // API to apply for a job immediately gives us the highest tier we qualify for
            currentRole = bestRoleName;
            player = await getPlayerInfo(ns); // Update player.jobs info after attempted promotion
        }
        const currentJob = player.jobs[companyName];
        const nextJobTier = currentRole == "IT" ? currentJobTier : currentJobTier + 1;
        const nextJobName = currentRole == "Security" ? "Security" :
            currentRole == "IT" || nextJobTier >= itJob.reqRep.length ? "Software" : "IT";
        const nextJob = nextJobName == "Security" ? securityJob : nextJobName == "IT" ? itJob : softwareJob;
        const requiredRep = nextJob.reqRep[nextJobTier] * (backdoored ? 0.75 : 1); // Rep requirement is decreased when company server is backdoored
        const requiredHack = nextJob.reqHck[nextJobTier] === 0 ? 0 : nextJob.reqHck[nextJobTier] + statModifier; // Stat modifier only applies to non-zero reqs
        const requiredStr = nextJob.reqStr[nextJobTier] === 0 ? 0 : nextJob.reqStr[nextJobTier] + statModifier;
        const requiredDef = nextJob.reqDef[nextJobTier] === 0 ? 0 : nextJob.reqDef[nextJobTier] + statModifier;
        const requiredDex = nextJob.reqDex[nextJobTier] === 0 ? 0 : nextJob.reqDex[nextJobTier] + statModifier;
        const requiredAgi = nextJob.reqAgi[nextJobTier] === 0 ? 0 : nextJob.reqAgi[nextJobTier] + statModifier;
        const requiredCha = nextJob.reqCha[nextJobTier] === 0 ? 0 : nextJob.reqCha[nextJobTier] + statModifier; // Stat modifier only applies to non-zero reqs
        let status = `Next promotion ('${nextJobName}' #${nextJobTier}) at Hack:${requiredHack} Cha:${requiredCha} Rep:${requiredRep?.toLocaleString('en')}` +
            (repRequiredForFaction > requiredRep ? '' : `, but we won't need it, because we'll sooner hit ${repRequiredForFaction.toLocaleString('en')} reputation to unlock company faction "${factionName}"!`);
        if (nextJobTier >= nextJob.reqHck.length) // Special case status message if we're at the maximum promotion, but need additional reputation to unlock the company
            status = `We've reached the maximum promotion level, but are continuing to work until we hit ${repRequiredForFaction.toLocaleString('en')} reputation to unlock company faction "${factionName}."`;
        // Monitor that we are still performing the expected work
        let currentWork = await getCurrentWorkInfo(ns);
        // We should only study at university if every other requirement is met but Charisma
        // (assume daemon is grinding hack XP as fast as it can, so no point in studying for that)
        if (currentReputation >= requiredRep && player.skills.hacking >= requiredHack && player.skills.charisma < requiredCha && !options['no-studying']) {
            // Check whether we can train stats in a "reasonable amount of time"
            const em = requiredCha / options['training-stat-per-multi-threshold'];
            const chaHeuristic = classHeuristic(player, 'charisma');
            if (chaHeuristic < em) {
                if (!decidedNotToStudy) // Only generate the log below once
                    log(ns, `INFO: You are only lacking in Charisma to get our next promotion. Need: ${requiredCha}, Have: ${player.skills.charisma}` +
                        `\nUnfortunately, your combination of Charisma mult (${formatNumberShort(player.mults.charisma)}), ` +
                        `exp_mult (${formatNumberShort(player.mults.charisma_exp)}), and bitnode charisma / study exp mults ` +
                        `(${formatNumberShort(bitNodeMults.CharismaLevelMultiplier)}) / (${formatNumberShort(bitNodeMults.ClassGymExpGain)}) ` +
                        `are probably too low to increase charisma from ${player.skills.charisma} to ${requiredCha} in a reasonable amount of time ` +
                        `(${formatNumberShort(chaHeuristic)} < ${formatNumberShort(em, 2)} - configure with --training-stat-per-multi-threshold)`);
                decidedNotToStudy = true;
            } else // On any loop, we can change our mind and decide studying is worthwhile
                decidedNotToStudy = false;
            if (!decidedNotToStudy) {
                status = `Studying at ZB university until Cha reaches ${requiredCha}...\n` + status;
                // TODO: See if we can re-use the function "monitorStudies" here instead of duplicating a lot of the same code.
                let classType = currentWork.classType;
                if (isStudying && !(classType && classType.toLowerCase().includes('leadership'))) {
                    if (await isValidInterruption(ns, currentWork)) return;
                    log(ns, `Leadership studies were interrupted. classType="${classType}" Restarting...`, false, 'warning');
                    isStudying = false; // If something external has interrupted our studies, take note
                    if (!options['no-tail-windows']) tail(ns); // Force a tail window open to help the user kill this script if they accidentally closed the tail window and don't want to keep studying
                }
                if (!isStudying) { // Study at ZB university if CHA is the limiter.
                    if (await studyForCharisma(ns, shouldFocus))
                        [isWorking, isStudying] = [false, true];
                }
                if (requiredCha - player.skills.charisma > 10) { // Try to spend hacknet-node hashes on university upgrades while we've got a ways to study to make it go faster
                    let spentHashes = await trySpendHashes(ns, "Improve Studying");
                    if (spentHashes > 0) {
                        log(ns, 'Bought a "Improve Studying" upgrade.', false, 'success');
                        await studyForCharisma(ns, shouldFocus); // We must restart studying for the upgrade to take effect.
                    }
                }
            }
        } else if (isStudying) { // If we no longer need to study and we currently are, turn off study mode and get back to work!
            isStudying = false;
            continue; // Restart the loop so we refresh our promotion index and apply for a promotion before working more
        }
        await tryBuyReputation(ns);

        // Check if an external script has backdoored this company's server yet. If so, it affects our ETA.
        if (!backdoored) { // Don't need to check again once we've confirmed a backdoor.
            backdoored = await checkForBackdoor(ns, companyName);
            if (backdoored) {
                repRequiredForFaction -= 100_000; // Adjust total required faction reputation (since this was initialized outside of the loop)
                continue; // Restat the loop so we recompute promotion requirements
            }
        }

        // Regardless of the earlier promotion logic, always try for a promotion to make sure we don't miss a promotion due to buggy logic
        if (await tryApplyToCompany(ns, companyName, currentRole)) {
            player = await getPlayerInfo(ns); // Find out what our new job is
            log(ns, `Unexpected '${currentRole}' promotion from ${currentJob} to "${player.jobs[companyName]}. Promotion logic must be off..."`, false, 'warning');
        }

        // If not studying, ensure we are working for this company
        if (!isStudying && (!isWorking || currentWork.companyName != companyName)) {
            if (isWorking) { // Log a warning if we discovered that work we previously began was disrupted
                if (await isValidInterruption(ns, currentWork)) return false;
                log(ns, `Work for company ${companyName} was interrupted (Now: ${JSON.stringify(currentWork)}). Restarting...`, false, 'warning');
                isWorking = false;
                if (!options['no-tail-windows']) tail(ns); // Force a tail window open to help the user kill this script if they accidentally closed the tail window and don't want to keep working
            }
            if (await getNsDataThroughFile(ns, `ns.singularity.workForCompany(ns.args[0], ns.args[1])`, null, [companyName, shouldFocus])) {
                isWorking = true;
                if (shouldFocus && !options['no-tail-windows']) tail(ns); // Keep a tail window open if we're stealing focus
            } else {
                log(ns, `Something went wrong, failed to start working for company "${companyName}".`, false, 'error');
                break;
            }
        }
        if (lastStatus != status || (Date.now() - lastStatusUpdateTime) > statusUpdateInterval) {
            lastStatus = status;
            lastStatusUpdateTime = Date.now();
            // Measure rep gain rate to give an ETA
            const repGainRate = !isWorking ? 0 : await measureCompanyRepGainRate(ns, companyName);
            const eta = !isWorking ? "?" : formatDuration(1000 * ((requiredRep || repRequiredForFaction) - currentReputation) / repGainRate);
            player = await getPlayerInfo(ns);
            ns.print(`Currently a "${player.jobs[companyName]}" ('${currentRole}' #${currentJobTier}) for "${companyName}" earning ${formatNumberShort(repGainRate)} rep/sec. ` +
                (hasFocusPenalty && !shouldFocus ? `(after 20% non-focus Penalty)` : '') + `\n` +
                `${status}\nCurrent player stats are Hack:${player.skills.hacking} ${player.skills.hacking >= (requiredHack || 0) ? '✓' : '✗'} ` +
                (bestRoleName == "Security" ? `Str:${player.skills.strength} ${player.skills.strength >= (requiredStr || 0) ? '✓' : '✗'} ` +
                    `Def:${player.skills.defense} ${player.skills.defense >= (requiredDef || 0) ? '✓' : '✗'} ` +
                    `Dex:${player.skills.dexterity} ${player.skills.dexterity >= (requiredDex || 0) ? '✓' : '✗'} ` +
                    `Agi:${player.skills.agility} ${player.skills.agility >= (requiredAgi || 0) ? '✓' : '✗'} ` : "") +
                `Cha:${player.skills.charisma} ${player.skills.charisma >= (requiredCha || 0) ? '✓' : '✗'} ` +
                `Rep:${Math.round(currentReputation).toLocaleString('en')} ${currentReputation >= (requiredRep || repRequiredForFaction) ? '✓' : `✗ (ETA: ${eta})`}`);
        }
        await ns.sleep(loopSleepInterval); // Sleep now and wake up periodically to check our stats / reputation progress
        player = await getPlayerInfo(ns); // Update player after sleeping, before our next loop
    }
    // Return true if we succeeded, false otherwise.
    if (currentReputation >= repRequiredForFaction) {
        ns.print(`Attained ${repRequiredForFaction.toLocaleString('en')} rep with "${companyName}".`);
        if (!player.factions.includes(factionName) && waitForInvite)
            return await waitForFactionInvite(ns, factionName);
        return true;
    }
    ns.print(`Stopped working for "${companyName}" repRequiredForFaction: ${repRequiredForFaction.toLocaleString('en')} ` +
        `currentReputation: ${Math.round(currentReputation).toLocaleString('en')} inFaction: ${player.factions.includes(factionName)}`);
    return false;
}
