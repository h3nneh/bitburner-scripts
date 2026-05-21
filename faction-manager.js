// Based on: https://github.com/66Ton99/bitburner-scripts/blob/main/faction-manager.js
// Local change: removed crime_money from default desired stats
import {
    log, getConfiguration, instanceCount, formatNumberShort, formatMoney,
    getNsDataThroughFile, getActiveSourceFiles, tryGetBitNodeMultipliers, getStocksValue, getFilePath,
    formatDuration, getErrorInfo, devConsole
} from './helpers.js'

// PLAYER CONFIGURATION CONSTANTS
// This acts as a list of default "easy" factions to always show even if the user has --hide-locked-factions
const easyAccessFactions = [
    "Tian Di Hui", "Sector-12", "Chongqing", "New Tokyo", "Ishima", "Aevum", "Volhaven", // Location-Based
    "BitRunners", "CyberSec", "NiteSec", /* Hack Based */ "Netburners", /* Hacknet-based */ "Slum Snakes", "Tetrads", /* Early Crime */
];
const default_priority_augs = ["The Red Pill", "The Blade's Simulacrum", "Neuroreceptor Management Implant", "SoA - phyzical WKS harmonizer"]; // By default, take these augs when they are accessible
const augCashRoot = "CashRoot Starter Kit";
const default_desired_augs = [augCashRoot] // By default, mark these augs as "desired" regardless of their stats
// If not in a gang, and we are nearing unlocking gangs (54K Karma) we will attempt to join any/all of these factions
const potentialGangFactions = ["Slum Snakes", "Tetrads", "The Black Hand", "The Syndicate", "The Dark Army", "Speakers for the Dead"];
const default_hidden_stats = ['bladeburner', 'hacknet']; // Hide from the summary table by default because they clearly all come from one faction.
const output_file = "/Temp/affordable-augs.txt"; // Temp file produced for autopilot.js to relay information about current owned & affordable augs.
const installStateFile = "/Temp/faction-manager-install-state.txt";
const factionWorkIdleStatusFile = "/Temp/work-for-factions-idle-status.txt";
const stockmasterLiquidationPauseFile = "/Temp/stockmaster-liquidation-pause.txt";
const maxInstallBatchNeuroFluxRepTopUp = 25000;
const stockLiquidationPauseMs = 60 * 1000;
const staneksGift = "Stanek's Gift - Genesis";
const shadowsOfAnarchy = "Shadows of Anarchy";
const soaWksHarmonizer = "SoA - phyzical WKS harmonizer";
const augTRP = "The Red Pill";
const factionsWithoutDonation = ["Bladeburners", "Church of the Machine God", "Shadows of Anarchy"];
// Factors used in calculations
const nfCountMult = 1.14; // Factors that control how NeuroFlux prices scale
let augCountMult = 1.9; // The multiplier for the cost increase of augmentations (changes based on SF11 level)
// Various globals because this script does not do modularity well. Assigned values are all ignored, just used to get type hints
let playerData = (/**@returns{Player}*/() => null)(), bitNode = 0, gangFaction = "";
let numAugsAwaitingInstall = 0, nfLevelPurchased = 0, startingPlayerMoney = 0, stockValue = 0; // If the player holds stocks, their liquidation value will be determined
let factionNames = [""], joinedFactions = [""], desiredAugs = [""], desiredStatsFilters = [""], purchaseFactionRepCosts = [];
let ownedAugmentations = [""], installedAugmentations = [""], simulatedOwnedAugmentations = [""], allAugStats = [""], priorityAugs = [""];
let effectiveSourceFiles = (/**@returns {{[bitNode: number]: number}}*/() => ({}))();
let factionData = (/**@returns {{[factionName: string]: FactionData}}*/() => ({}))();
let augmentationData = (/**@returns {{[augmentationName: string]: AugmentationData}}*/() => ({}))();
let purchaseableAugs = (/**@returns {AugmentationData[]}*/() => [])();
let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)();
let printToTerminal, ignorePlayerData;
let _ns; // Used to avoid passing ns to functions that don't need it except for some logs.
let currentResetInfo = (/**@returns{ResetInfo}*/() => null)();
let installBatchTopUpStatus = [];

function getReservedCash() {
    return bitNode == 8 ? 0 : Number(_ns?.read("reserve.txt") || 0);
}

function getFavorToDonate() {
    return Math.floor(150 * (bitNodeMults?.FavorToDonateToFaction ?? 1));
}

function addInstallBatchTopUpStatus(status) {
    if (status) installBatchTopUpStatus.push(status);
}

function canDonateToFaction(faction) {
    return faction?.joined && faction.favor >= getFavorToDonate() &&
        ![gangFaction, ...factionsWithoutDonation].includes(faction.name);
}

function getCostOfReputation(rep) {
    return Math.ceil(1e6 * rep / playerData.mults.faction_rep / bitNodeMults.FactionWorkRepGain);
}

function getReqDonationForRep(repNeeded, factionOrFactionName) {
    const faction = factionOrFactionName.name ? factionOrFactionName : factionData[factionOrFactionName];
    return getCostOfReputation(Math.max(0, repNeeded - (faction?.reputation || 0)));
}

function shouldAllowDonationForAug(aug) {
    if (!aug?.name || ownedAugmentations.includes(aug.name)) return false;
    if (aug.name == augTRP && !shouldDeferBn3TrpForDaedalusBatch()) return true;
    // In BN10 money is the bottleneck; allow donations for any desired aug when we have high favor
    if (bitNode == 10 && aug.desired) return true;
    return false;
}

function getAugName(augOrName) {
    return typeof augOrName == "string" ? augOrName : augOrName?.name;
}

function formatAugList(augs, limit = 4) {
    const names = augs.map(getAugName).filter(Boolean);
    return names.slice(0, limit).map(name => `"${name}"`).join(", ") +
        (names.length > limit ? `, ...` : "");
}

function getBn3DaedalusBatchBlockers(plannedAugs = []) {
    if (bitNode != 3 || options?.['purchase-mode'] == "soa-only" || installedAugmentations.includes(augTRP)) return [];
    const daedalus = factionData["Daedalus"];
    const trp = augmentationData[augTRP];
    if (!daedalus?.joined || !trp) return [];
    const plannedNames = new Set(plannedAugs.map(getAugName).filter(Boolean));
    return daedalus.augmentations.map(name => augmentationData[name])
        .filter(aug => isBn3DaedalusBatchTarget(aug) && aug.name != augTRP)
        .filter(aug => aug.reputation > trp.reputation || aug.price > trp.price)
        .filter(aug => !plannedNames.has(aug.name))
        .sort((a, b) => (b.reputation - a.reputation) || (b.price - a.price) || a.name.localeCompare(b.name));
}

function shouldDeferBn3TrpForDaedalusBatch(plannedAugs = []) {
    return getBn3DaedalusBatchBlockers(plannedAugs).length > 0;
}

function isBn3DaedalusBatchTarget(aug) {
    if (!aug || bitNode != 3 || options?.['purchase-mode'] == "soa-only" || installedAugmentations.includes(augTRP))
        return false;
    const daedalus = factionData["Daedalus"];
    return daedalus?.joined && aug.name != strNF && !aug.owned && daedalus.augmentations.includes(aug.name);
}

function isPurchaseTargetAug(aug) {
    return aug?.desired || isBn3DaedalusBatchTarget(aug);
}

function getReqDonationForAug(aug, factionOrFactionName = null) {
    if (!shouldAllowDonationForAug(aug)) return 0;
    const faction = factionOrFactionName ? (factionOrFactionName.name ? factionOrFactionName : factionData[factionOrFactionName]) :
        factionData[aug.getFromJoined()];
    if (!canDonateToFaction(faction)) return 0;
    return getReqDonationForRep(aug.reputation, faction);
}

function shouldOnlyBuyTrpInBn8() {
    if (bitNode != 8 || ownedAugmentations.includes(augTRP)) return false;
    return playerData.factions.includes("Daedalus") ||
        (installedAugmentations.filter(aug => aug != strNF).length >= bitNodeMults.DaedalusAugsRequirement &&
            playerData.skills.hacking >= (2500 * 0.9));
}

/** @param {NS} ns @param {{[bitNode: number]: number}} ownedSourceFiles */
async function shouldDisableNeuroFluxForBn10Sleeves(ns, ownedSourceFiles) {
    if (bitNode != 10) return false;
    try {
        const targetSleeveCount = Math.min(8, 6 + (ownedSourceFiles[10] || 0));
        const numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
        // Only block NF when sleeves are still missing (very expensive). Memory upgrades cost far
        // less and are already protected by reserve.txt, so NF can safely run then.
        return numSleeves < targetSleeveCount;
    } catch {
        return false;
    }
}

let options = null; // A copy of the options used at construction time
const argsSchema = [ // The set of all command line arguments
    ['all', false], // Display all factions (spoilers), not just accessible factions
    ['hide-locked-factions', false], // Don't show factions that we don't currently have access to
    ['verbose', null], // Print the terminal as well as the script logs. If left null, this defaults to true in code now, but can be disabled with an explicit `--verbose false`
    ['ignore-player-data', false], // Display stats for all factions and augs, despite what we already have (kind of a "mock" mode)
    ['ignore-faction', []], // Factions to omit from all data, stats, and calcs, (e.g.) if you do not want to purchase augs from them, or do not want to see them because they are impractical to join at this time
    ['after-faction', []], // Pretend we were to buy all augs offered by these factions. Show us only what remains.
    ['force-join', null], // Always join these factions if we have an invite (useful to force join a gang faction)
    // Augmentation purchasing-related options. Controls what augmentations are included in cost calculations, and optionally purchased
    ['priority-aug', []], // If accessible, every effort is made not to drop these from the sort purchase order.
    ['omit-aug', []], // Augmentations to exclude from the augmentation list (e.g. because we do not wish to purchase it yet)
    ['aug-desired', []], // These augs will be marked as "desired" whether or not they match desired-stats
    ['stat-desired', []], // Augs that give these will be starred (marked as desired and staged for purchase). If empty, defaults are picked based on your situation.
    ['neuroflux-disabled', false], // Set to true to skip including as many neuroflux upgrades as we can afford
    ['purchase-mode', null], // Centralized purchase profile: cashroot-only, no-neuroflux, any.
    ['purchase', false], // Set to true to pull the trigger on purchasing all desired augs in the order specified
    ['manage-installs', false], // Centralized autopilot purchase/install policy owner.
    ['install-at-aug-count', 6],
    ['install-at-aug-plus-nf-count', 10],
    ['install-for-augs', ["The Red Pill"]],
    ['install-countdown', 5 * 60 * 1000],
    ['reduced-aug-requirement-per-hour', 0.5],
    ['wait-for-4s-threshold', 0.9],
    ['disable-wait-for-4s', false],
    ['money-focus-active', false],
    ['bn10-sleeves-incomplete', false],
    ['bn10-sleeve-reserve', 0],
    ['reserving-money-for-daedalus', false],
    ['player-in-gang', false],
    ['on-reset-script', "autopilot.js"],
    ['ignore-stocks', false], // Set to true to ignore the liquidation value of stocks currently held when running
    ['ignore-stanek', false], // Set to true to ignore the fact that stanek is not yet taken before purchasing your first augs
    ['show-unavailable-aug-purchase-order', false], // Set to true to print the list of unavailable augmentations in optimal purchase order. (Note: Always displayed when no augs are available)
    ['show-all-purchase-lists', false], // Set to true to re-print the list of augmentations each time it changes
    // Display-related options - controls what information is displayed in the final "cumulative stats by faction" table
    ['sort', null], // What stat is the table of total faction stats sorted by. Defaults to your first --stat-desired
    ['hide-stat', []], // Stats to exclude from the final table (partial matching works)
    ['unique', false], // When displaying cumulative stats by faction, only include augs not given by a faction further up the list
];

// For convenience, these lists provide command-line <tab> auto-complete values
const stat_multis = ["agility_exp", "agility", "charisma_exp", "charisma", "company_rep", "crime_money", "crime_success", "defense_exp", "defense", "dexterity_exp", "dexterity",
    "faction_rep", "hacking_chance", "hacking_exp", "hacking_grow", "hacking_money", "hacking", "hacking_speed", "strength_exp", "strength", "work_money",
    "bladeburner_analysis", "bladeburner_max_stamina", "bladeburner_stamina_gain", "bladeburner_success_chance",
    "hacknet_node_core_cost", "hacknet_node_level_cost", "hacknet_node_money", "hacknet_node_purchase_cost", "hacknet_node_ram_cost"];
const statShortcuts = ["agi_exp", "agi", "cha_exp", "cha", "cmp_rep", "crm_$", "crm_prob", "def_exp", "def", "dex_exp", "dex", "fac_rep", "hack_prob", "hack_exp", "hack_grow", "hack_$", "hack", "hack_speed", "str_exp", "str", "work_$", 'bladeburner', 'hacknet'];
const statPlayer = ["hacking", "strength", "defense", "dexterity", "agility", "charisma"]; // Since these are substrings of other stats, we can specifically request this stat with e.g. "hacking_level"
const allFactions = ["Illuminati", "Daedalus", "The Covenant", "ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries", "NWO", "Clarke Incorporated", "OmniTek Incorporated",
    "Four Sigma", "KuaiGong International", "Fulcrum Secret Technologies", "BitRunners", "The Black Hand", "NiteSec", "Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12",
    "Volhaven", "Speakers for the Dead", "The Dark Army", "The Syndicate", "Silhouette", "Tetrads", "Slum Snakes", "Netburners", "Tian Di Hui", "CyberSec", "Bladeburners", "Church of the Machine God", "Shadows of Anarchy"];
const augmentations = ["ADR-V1 Pheromone Gene", "ADR-V2 Pheromone Gene", "Artificial Bio-neural Network Implant", "Artificial Synaptic Potentiation", "Augmented Targeting I", "Augmented Targeting II", "Augmented Targeting III", "BLADE-51b Tesla Armor", "BLADE-51b Tesla Armor: Energy Shielding Upgrade", "BLADE-51b Tesla Armor: IPU Upgrade", "BLADE-51b Tesla Armor: Omnibeam Upgrade", "BLADE-51b Tesla Armor: Power Cells Upgrade", "BLADE-51b Tesla Armor: Unibeam Upgrade", "BigD's Big ... Brain", "Bionic Arms", "Bionic Legs", "Bionic Spine", "BitRunners Neurolink", "BitWire", "Blade's Runners", "BrachiBlades", "CRTX42-AA Gene Modification", "CashRoot Starter Kit", "Combat Rib I", "Combat Rib II", "Combat Rib III", "CordiARC Fusion Reactor", "Cranial Signal Processors - Gen I", "Cranial Signal Processors - Gen II", "Cranial Signal Processors - Gen III", "Cranial Signal Processors - Gen IV", "Cranial Signal Processors - Gen V", "DataJack", "DermaForce Particle Barrier", "ECorp HVMind Implant", "EMS-4 Recombination", "Eloquence Module", "Embedded Netburner Module", "Embedded Netburner Module Analyze Engine", "Embedded Netburner Module Core Implant", "Embedded Netburner Module Core V2 Upgrade", "Embedded Netburner Module Core V3 Upgrade", "Embedded Netburner Module Direct Memory Access Upgrade", "Enhanced Myelin Sheathing", "Enhanced Social Interaction Implant", "EsperTech Bladeburner Eyewear", "FocusWire", "GOLEM Serum", "Glibness Enhancement", "Golden Tongue Module", "Graphene Bionic Arms Upgrade", "Graphene Bionic Legs Upgrade", "Graphene Bionic Spine Upgrade", "Graphene Bone Lacings", "Graphene BrachiBlades Upgrade", "Hacknet Node CPU Architecture Neural-Upload", "Hacknet Node Cache Architecture Neural-Upload", "Hacknet Node Core Direct-Neural Interface", "Hacknet Node Kernel Direct-Neural Interface", "Hacknet Node NIC Architecture Neural-Upload", "HemoRecirculator", "Hydroflame Left Arm", "HyperSight Corneal Implant", "Hyperion Plasma Cannon V1", "Hyperion Plasma Cannon V2", "I.N.T.E.R.L.I.N.K.E.D", "INFRARET Enhancement", "LuminCloaking-V1 Skin Implant", "LuminCloaking-V2 Skin Implant", "Magnetism Amplifier", "NEMEAN Subdermal Weave", "Nanofiber Weave", "Neotra", "Neural Accelerator", "Neural Wit Amplifier", "Neural-Retention Enhancement", "Neuralstimulator", "Neuregen Gene Modification", "NeuroFlux Governor", "Neuronal Densification", "Neuroreceptor Management Implant", "Neurotrainer I", "Neurotrainer II", "Neurotrainer III", "Nuoptimal Nootropic Injector Implant", "NutriGen Implant", "ORION-MKIV Shoulder", "OmniTek InfoLoad", "PC Direct-Neural Interface", "PC Direct-Neural Interface NeuroNet Injector", "PC Direct-Neural Interface Optimization Submodule", "PCMatrix", "Photosynthetic Cells", "Power Recirculation Core", "QLink", "SPTN-97 Gene Modification", "SmartJaw", "SmartSonar Implant", "SoA - Beauty of Aphrodite", "SoA - Chaos of Dionysus", "SoA - Flood of Poseidon", "SoA - Hunt of Artemis", "SoA - Knowledge of Apollo", "SoA - Might of Ares", "SoA - Trickery of Hermes", "SoA - Wisdom of Athena", "SoA - phyzical WKS harmonizer", "Social Dynamics Processor", "Social Negotiation Assistant (S.N.A)", "Speech Enhancement", "Speech Processor Implant", "Stanek's Gift - Awakening", "Stanek's Gift - Genesis", "Stanek's Gift - Serenity", "Synaptic Enhancement Implant", "Synfibril Muscle", "Synthetic Heart", "TITN-41 Gene-Modification Injection", "The B00ts of Perseus", "The B1ade of Solomonoff", "The Black Hand", "The Blade's Simulacrum", "The H4mmer of Daedalus", "The Illustrated Primer", "The L4w of Bayes", "The Red Pill", "The Shadow's Simulacrum", "The St4ff of Asclepius", "The W1ngs of Icarus", "Unstable Circadian Modulator", "Vangelis Virus", "Vangelis Virus 3.0", "Wired Reflexes", "Xanipher", "Z.O.Ë.", "nextSENS Gene Modification", "violet Congruity Implant"]
const strNF = "NeuroFlux Governor"

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--sort" || lastFlag == "--stat-desired" || lastFlag == "--hide-stat")
        return statShortcuts.concat(stat_multis).concat(statPlayer.map(s => `${s}_level`));
    if (lastFlag == "--purchase-mode")
        return ["cashroot-only", "soa-only", "no-neuroflux", "any"];
    if (lastFlag == "--ignore-faction" || lastFlag == "--after-faction")
        return allFactions.map(f => f.replaceAll(" ", "_")).sort(); // Command line doesn't like spaces
    if (lastFlag == "--omit-aug" || lastFlag == "--aug-desired" || lastFlag == "--priority-aug")
        return augmentations.map(f => f.replaceAll(" ", "_"));
    return [];
}

function pushUnique(array, value) {
    if (!array.includes(value)) array.push(value);
}

function applyPurchaseMode(ns, runOptions) {
    const mode = runOptions['purchase-mode'];
    if (!mode) return true;
    if (mode == "cashroot-only") {
        pushUnique(runOptions['priority-aug'], augCashRoot);
        pushUnique(runOptions['aug-desired'], augCashRoot);
        runOptions['neuroflux-disabled'] = true;
        return true;
    }
    if (mode == "soa-only") {
        pushUnique(runOptions['priority-aug'], soaWksHarmonizer);
        pushUnique(runOptions['aug-desired'], soaWksHarmonizer);
        runOptions['neuroflux-disabled'] = true;
        return true;
    }
    if (mode == "no-neuroflux") {
        runOptions['neuroflux-disabled'] = true;
        return true;
    }
    if (mode == "any") {
        pushUnique(runOptions['stat-desired'], "*");
        return true;
    }
    log(ns, `ERROR: Unknown --purchase-mode "${mode}". Valid values: cashroot-only, no-neuroflux, any.`, true, 'error');
    return false;
}

// Use --all to include all factions and --verbose false to suppress terminal output.
/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('disableLog');
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    if (!applyPurchaseMode(ns, runOptions)) return;
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
    _ns = ns;

    // Ensure all globals are reset before we proceed with the script, in case we've done things out of order
    augCountMult = playerData = gangFaction = nfLevelPurchased = startingPlayerMoney = stockValue = null;
    factionNames = [], joinedFactions = [], desiredAugs = [], desiredStatsFilters = [], purchaseFactionRepCosts = [];
    ownedAugmentations = [], installedAugmentations = [], simulatedOwnedAugmentations = [], effectiveSourceFiles = {}, allAugStats = [], priorityAugs = [], purchaseableAugs = [];
    factionData = {}, augmentationData = {}, bitNodeMults = {}, currentResetInfo = null, installBatchTopUpStatus = [];

    printToTerminal = (options.verbose === true || options.verbose === null) && !options['join-only'];
    ignorePlayerData = options['ignore-player-data'];
    const afterFactions = options['after-faction'].map(f => f.replaceAll("_", " "));
    const omitAugs = options['omit-aug'].map(f => f.replaceAll("_", " "));
    // Set up augs which should take priority (in our purchase budget) over all others
    priorityAugs = options['priority-aug']?.map(f => f.replaceAll("_", " "));
    if (priorityAugs.length == 0) priorityAugs = default_priority_augs;
    // Set up "desired augs" to always include in our purhase order (but with standard priority). Should include priority-augs as well
    desiredAugs = options['aug-desired'].map(f => f.replaceAll("_", " "));
    if (desiredAugs.length == 0) desiredAugs = default_desired_augs;
    desiredAugs = priorityAugs.concat(desiredAugs);

    // Determine which source files are active, which, for one, lets us determine how the cost of augmentations will scale
    playerData = await getPlayerInfo(ns);
    let resetInfo = (/**@returns{ResetInfo}*/() => null)(); // Hack to get type hints.
    resetInfo = await getNsDataThroughFile(ns, `ns.getResetInfo()`);
    currentResetInfo = resetInfo;
    bitNode = resetInfo.currentNode;
    const ownedSourceFiles = await getActiveSourceFiles(ns, false);
    effectiveSourceFiles = await getActiveSourceFiles(ns, true);
    const sf4Level = bitNode == 4 ? 3 : ownedSourceFiles[4] || 0; // If in BN4, singularity costs are as though you had SF4.3
    if (!(bitNode == 4 || 4 in ownedSourceFiles))
        return log(ns, `ERROR: This script requires Singularity functions to work.`, true, 'error');
    else if (sf4Level < 3)
        log(ns, `WARNING: This script makes heavy use of singularity functions, which are quite expensive before you have SF4.3. ` +
            `Unless you have a lot of free RAM for temporary scripts, you may get runtime errors.`);
    const sf11Level = ownedSourceFiles[11] || 0;
    augCountMult = 1.9 * [1, 0.96, 0.94, 0.93][sf11Level];

    log(ns, `Player has sf11Level ${sf11Level}, so the multiplier after each aug purchased is ${augCountMult}.`);

    // Collect information about the player
    const gangInfo = await getGangInfo(ns);
    gangFaction = gangInfo ? gangInfo.faction : null;
    startingPlayerMoney = playerData.money;
    stockValue = options['ignore-stocks'] ? 0 : await getStocksValue(ns);
    joinedFactions = ignorePlayerData ? [] : playerData.factions;
    log(ns, 'In factions: ' + joinedFactions);
    // Get owned augmentations (whether they've been installed or not). Ignore strNF because you can always buy more.
    ownedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
    installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
    numAugsAwaitingInstall = ownedAugmentations.length - installedAugmentations.length;
    if (bitNode == 8) {
        options['neuroflux-disabled'] = true;
        if (!omitAugs.includes(strNF)) omitAugs.push(strNF);
        log(ns, `INFO: Disabling ${strNF} purchases in BN8.`, printToTerminal);
    } else if (options['neuroflux-disabled']) {
        if (!omitAugs.includes(strNF)) omitAugs.push(strNF);
    } else if (await shouldDisableNeuroFluxForBn10Sleeves(ns, ownedSourceFiles)) {
        options['neuroflux-disabled'] = true;
        if (!omitAugs.includes(strNF)) omitAugs.push(strNF);
        log(ns, `INFO: Disabling ${strNF} purchases because BN10 Covenant sleeves/memory are not complete yet.`, printToTerminal);
    }
    simulatedOwnedAugmentations = ignorePlayerData ? [] : ownedAugmentations.filter(a => a != strNF);
    // Clear "priority" / "desired" lists of any augs we already own
    priorityAugs = priorityAugs.filter(name => !simulatedOwnedAugmentations.includes(name));
    desiredAugs = desiredAugs.filter(name => !simulatedOwnedAugmentations.includes(name));
    // Determine the set of desired augmentation stats. If not specified by the user, it's based on our situation
    desiredStatsFilters = options['stat-desired'];
    if ((desiredStatsFilters?.length ?? 0) == 0) { // If the user does has not specified stats or augmentations to prioritize, use sane defaults
        // There are some situations where we will accept any augmentation whatsoever...
        const cashRootOwned = ownedAugmentations.includes(augCashRoot);
        const cashRootPriorityEligible = bitNode == 3 && installedAugmentations.filter(a => a != strNF).length > 0;
        const cashRootOnlyMode = options['purchase-mode'] == "cashroot-only";
        const forceOnlyCashRoot = cashRootOnlyMode || (cashRootPriorityEligible && !cashRootOwned && options['aug-desired'].length == 0);
        const willTakeAnyAug = !forceOnlyCashRoot && (
            (cashRootOwned && ownedAugmentations.length > 40) || // Once we have more than N augs, switch to buying up anything and everything
            (bitNode == 6 || bitNode == 7 || playerData.factions.includes("Bladeburners")) || // If doing bladeburners, combat augs matter too, so just get everything
            (cashRootOwned && (Date.now() - resetInfo.lastAugReset) < 20 * 60 * 1000)); // Early quick-install mode is only for the post-CashRoot path
        desiredStatsFilters = forceOnlyCashRoot ? [] :
            willTakeAnyAug ? ['*'] : // Take any aug if one of the above criteria is met
            bitNode == 8 ? ['hacking_level', 'hacking_speed', 'hacking_grow', 'hacking_chance'] : // In BN8, money comes from stocks, so favor stats that improve stock manipulation throughput and target access.
                ['hacking', 'faction_rep', 'company_rep', 'charisma', 'hacknet']; // Otherwise get hacking + rep boosting, etc. for unlocking augs more quickly
    }
    log(ns, 'Desired stats filter: ' + JSON.stringify(desiredStatsFilters));

    // Prepare global data sets of faction and augmentation information
    log(ns, 'Getting all faction data...');
    await updateFactionData(ns, options['ignore-faction'].map(f => f.replaceAll("_", " ")));
    log(ns, 'Getting all augmentation data...');
    await updateAugmentationData(ns);

    // Join available factions that would give access to additional desired augmentations
    if (ignorePlayerData)
        log(ns, 'INFO: Skipping joining available factions due to the --ignore-player-data flag set.');
    else {
        log(ns, 'Joining available factions...');
        let forceJoinFactions = options['force-join'] ? [...options['force-join']] : [];
        // If the user didn't set the 'force-join' option, there are some defaults we should apply
        if (options['force-join'] == null) {
            forceJoinFactions.push("Shadows of Anarchy");
            // If we're in BN 10, we can purchase special Sleeve-related things from the Covenant, so we should always join it
            if (bitNode == 10)
                forceJoinFactions.push("The Covenant");
            // If gangs are an available feature, we should by default want to join any available gang factions
            if (!gangFaction && 2 in ownedSourceFiles && ns.heart.break() <= -53000) {
                forceJoinFactions.push(...potentialGangFactions); // Try to join all gang factions as we near unlocking gangs, regardless of their augmentations
                log(ns, `INFO: Will join any gang faction because Karma is at ${formatNumberShort(ns.heart.break())}`, printToTerminal, printToTerminal ? 'info' : undefined);
            }
        }
        let joined = await joinFactions(ns, forceJoinFactions);
        if (joined) log(ns, `SUCCESS: Joined ${joined} factions.`);
        displayJoinedFactionSummary(ns);
    }

    // Display the summary of all factions and total aug stats available from each
    let hideSummaryStats = options['hide-stat'];
    if (hideSummaryStats.length == 0) hideSummaryStats = default_hidden_stats;
    const sort = unshorten(options.sort || desiredStatsFilters[0]);
    displayFactionSummary(ns, sort, options.unique, afterFactions, hideSummaryStats);

    // Determine the current bitnode multipliers
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    // Create the table of all augmentations, and the breakdown of what we can afford
    await manageUnownedAugmentations(ns, omitAugs);

    if (options.purchase && ownedAugmentations.length <= 1 && 13 in ownedSourceFiles && !ownedAugmentations.includes(staneksGift) && !options['ignore-stanek'])
        log(ns, `WARNING: You have not yet accepted Stanek's Gift from the church in Chongqing. Purchasing augs will ` +
            `prevent you from doing so for the rest of this BN. (Run with '--ignore-stanek' to bypass this warning.)`, true);
    else if (options.purchase && purchaseableAugs) {
        await purchaseDesiredAugs(ns);
        // Refresh owned/pending state after purchases so the output file reflects the actual post-purchase situation.
        ownedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
        numAugsAwaitingInstall = ownedAugmentations.length - installedAugmentations.length;
        purchaseableAugs = [];
        purchaseFactionRepCosts = [];
    }
    let installStatus = null;
    if (options['manage-installs'] && !ignorePlayerData)
        installStatus = await manageAutomatedAugmentations(ns, resetInfo, ownedSourceFiles, sf11Level);
    if (!ignorePlayerData) { // Don't do this next part if we were "mocking" the player for this run
        // Write a file that summarizes what augs we could afford if we could ascend right now. (used by autopilot.js)
        const output = buildAugmentationStatus();
        if (installStatus) output.install_status = installStatus;
        ns.write(output_file, JSON.stringify(output, undefined, 2), "w");
    }
}

function buildAugmentationStatus() {
    const augsAwaitingInstall = ownedAugmentations.slice(installedAugmentations.length); // Assumes augs are returned in purchased order
    const nfInstalled = nfLevelPurchased - augsAwaitingInstall.filter(a => a == strNF).length;
    // Compute projected multiplier boosts from all pending + affordable non-NF augs (used by hud.js)
    const projBoost = { hacking: 1, hacking_money: 1, hacking_speed: 1, hacking_chance: 1, faction_rep: 1 };
    for (const augName of [...augsAwaitingInstall, ...purchaseableAugs.map(a => a.name)].filter(a => a !== strNF)) {
        const s = augmentationData[augName]?.stats ?? {};
        if (s.hacking_level_mult)  projBoost.hacking        *= s.hacking_level_mult;
        if (s.hacking_money_mult)  projBoost.hacking_money  *= s.hacking_money_mult;
        if (s.hacking_speed_mult)  projBoost.hacking_speed  *= s.hacking_speed_mult;
        if (s.hacking_chance_mult) projBoost.hacking_chance *= s.hacking_chance_mult;
        if (s.faction_rep_mult)    projBoost.faction_rep    *= s.faction_rep_mult;
    }
    return {
        installed_augs: installedAugmentations,
        installed_count: installedAugmentations.length,
        installed_count_nf: nfInstalled,
        installed_count_ex_nf: installedAugmentations.filter(a => a != strNF).length,
        purchased_augs: ownedAugmentations,
        purchased_count: ownedAugmentations.length,
        purchased_count_nf: nfLevelPurchased,
        purchased_count_ex_nf: ownedAugmentations.filter(a => a != strNF).length,
        awaiting_install_augs: augsAwaitingInstall,
        awaiting_install_count: numAugsAwaitingInstall,
        awaiting_install_count_nf: augsAwaitingInstall.filter(a => a == strNF).length,
        awaiting_install_count_ex_nf: augsAwaitingInstall.filter(a => a != strNF).length,
        affordable_augs: purchaseableAugs.map(a => a.name),
        affordable_count: purchaseableAugs.length,
        affordable_count_nf: purchaseableAugs.filter(a => a.name == strNF).length,
        affordable_count_ex_nf: purchaseableAugs.filter(a => a.name != strNF).length,
        total_rep_cost: Object.values(purchaseFactionRepCosts).reduce((t, r) => t + r, 0),
        total_aug_cost: getTotalCost(purchaseableAugs),
        unpurchased_count: Object.values(augmentationData).filter(a => !a.owned).length,
        projBoost,
    };
}

function readInstallState(ns, resetInfo) {
    let state = {};
    try { state = JSON.parse(ns.read(installStateFile) || "{}"); }
    catch { state = {}; }
    if (state.lastAugReset != resetInfo.lastAugReset)
        state = {};
    return {
        lastAugReset: resetInfo.lastAugReset,
        installCountdown: Number(state.installCountdown) || 0,
        installCountdownResets: Number(state.installCountdownResets) || 0,
        reservedPurchase: Number(state.reservedPurchase) || 0,
        lastBn8TrpPurchaseAttempt: Number(state.lastBn8TrpPurchaseAttempt) || 0,
    };
}

function writeInstallState(ns, state) {
    ns.write(installStateFile, JSON.stringify(state), "w");
}

function getRecentFactionWorkIdleStatus(ns, resetInfo, maxAgeMs = 10 * 60 * 1000) {
    let status = null;
    try { status = JSON.parse(ns.read(factionWorkIdleStatusFile) || "null"); }
    catch { return null; }
    const noProgressReasons = new Set(["nothing-actionable", "bladeburner-active", "deferred-invite"]);
    if (!status || !noProgressReasons.has(status.reason)) return null;
    if (status.lastAugReset != resetInfo.lastAugReset) return null;
    if (Date.now() - Number(status.updated || 0) > maxAgeMs) return null;
    return status;
}

function isBn3FirstAugReset(resetInfo = currentResetInfo) {
    return bitNode == 3 && resetInfo && Math.abs(resetInfo.lastAugReset - resetInfo.lastNodeReset) < 1000;
}

function getPendingAugmentationSummary(status) {
    const awaitingInstallNonNfCount = Math.max(status.awaiting_install_count_ex_nf || 0,
        (status.purchased_count_ex_nf || 0) - (status.installed_count_ex_nf || 0));
    const pendingAugCount = status.affordable_count_ex_nf + awaitingInstallNonNfCount;
    const pendingNfCount = status.affordable_count_nf + status.awaiting_install_count_nf;
    const pendingAugInclNfCount = pendingAugCount + pendingNfCount;
    let awaitingAugs = status.awaiting_install_augs.filter(aug => aug != strNF);
    if (awaitingAugs.length == 0 && awaitingInstallNonNfCount > 0)
        awaitingAugs.push(`${awaitingInstallNonNfCount} non-NeuroFlux augmentations`);
    let affordableAugs = status.affordable_augs.filter(aug => aug != strNF);
    if (status.awaiting_install_count_nf > 0)
        awaitingAugs.push(`${strNF} (x${status.awaiting_install_count_nf})`);
    if (status.affordable_count_nf > 0)
        affordableAugs.push(`${strNF} (x${status.affordable_count_nf})`);
    const augSummary = `${pendingAugCount} of ${status.unpurchased_count - 1} remaining augmentations` +
        (pendingNfCount > 0 ? ` + ${pendingNfCount} levels of NeuroFlux.` : '.');
    const detailLines = [];
    if (awaitingAugs.length > 0)
        detailLines.push(`\n  Awaiting install: [\"${awaitingAugs.join("\", \"")}\"]`);
    if (affordableAugs.length > 0)
        detailLines.push(`\n  Affordable now: [\"${affordableAugs.join("\", \"")}\"]`);
    return { awaitingInstallNonNfCount, pendingAugCount, pendingNfCount, pendingAugInclNfCount, augSummary, detailLines };
}

async function checkIfGrafting(ns) {
    const currentWork = await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()', '/Temp/facman-current-work.txt');
    if (currentWork?.type != "GRAFTING") return false;
    log(ns, "Grafting in progress. faction-manager.js will not install augmentations or otherwise interrupt it.", printToTerminal);
    return true;
}

async function shouldDelayAutomatedInstall(ns, resetInfo, status, augsNeeded, augsNeededInclNf) {
    if (await checkIfGrafting(ns))
        return `Grafting in progress. Not installing augmentations.`;
    const bn3DaedalusBlockers = getBn3DaedalusBatchBlockers(purchaseableAugs);
    if (bn3DaedalusBlockers.length > 0)
        return `BN3 Daedalus batch mode: not installing while higher-rep/price Daedalus target(s) remain outside the current purchase batch: ` +
            `${formatAugList(bn3DaedalusBlockers)}. Continuing faction work instead.`;
    const remainingNonNfAugs = Math.max(0, (status.unpurchased_count || 0) - 1);
    const affordableNowCount = (status.affordable_count_ex_nf || 0) + (status.affordable_count_nf || 0);
    const awaitingNonNfCount = Math.max(status.awaiting_install_count_ex_nf || 0,
        (status.purchased_count_ex_nf || 0) - (status.installed_count_ex_nf || 0));
    const awaitingInclNfCount = status.awaiting_install_count || 0;
    const alreadyMeetsInstallThreshold = awaitingNonNfCount >= augsNeeded || awaitingInclNfCount >= augsNeededInclNf;
    const bn8DelayForRedPill = playerData.factions.includes("Daedalus") ||
        (status.installed_count >= bitNodeMults.DaedalusAugsRequirement && playerData.skills.hacking >= (2500 * 0.9));
    if (bitNode == 8 && !installedAugmentations.includes(augTRP) && bn8DelayForRedPill &&
        !status.affordable_augs.includes(augTRP) && !status.awaiting_install_augs.includes(augTRP))
        return `BN8 Red Pill mode: not installing until "${augTRP}" is affordable or awaiting install.`;
    if (bitNode == 8 && awaitingInclNfCount > 0)
        return null;
    if (bitNode != 8 && !alreadyMeetsInstallThreshold && awaitingInclNfCount > 0 && affordableNowCount == 0 && remainingNonNfAugs > 0)
        return `Not installing yet because only ${awaitingInclNfCount} augmentations are waiting to install, ` +
            `that is still below the current install threshold (${augsNeeded} excluding NeuroFlux / ${augsNeededInclNf} including NeuroFlux), ` +
            `and we cannot afford any additional purchases right now while ${remainingNonNfAugs} non-NeuroFlux augmentations remain.`;
    if (bitNode != 8 && !options['disable-wait-for-4s']) {
        const have4STixApi = await getNsDataThroughFile(ns, `ns.stock.has4SDataTixApi()`, '/Temp/facman-has-4s-tix.txt');
        if (!have4STixApi) {
            const have4SData = await getNsDataThroughFile(ns, `ns.stock.has4SData()`, '/Temp/facman-has-4s-data.txt');
            const totalWorth = playerData.money + stockValue;
            const totalCost = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost +
                (have4SData ? 0 : 1E9 * bitNodeMults.FourSigmaMarketDataCost);
            const ratio = totalWorth / totalCost;
            if (ratio >= options['wait-for-4s-threshold'])
                return `Not installing until scripts purchase the 4SDataTixApi because we have ` +
                    `${(100 * totalWorth / totalCost).toFixed(0)}% of the cost (controlled by --wait-for-4s-threshold)`;
        }
    }
    if (bitNode == 8) {
        if (playerData.factions.includes("Daedalus")) {
            if (!installedAugmentations.includes(augTRP) && !status.affordable_augs.includes(augTRP) && !status.awaiting_install_augs.includes(augTRP))
                return `We're in Daedalus, so we won't install until we can afford to purchase "${augTRP}".`;
        } else if (status.installed_count >= bitNodeMults.DaedalusAugsRequirement && playerData.skills.hacking >= (2500 * 0.9)) {
            return `Not installing because we're in BN8 and we have enough augs and ` +
                (playerData.skills.hacking < 2500 ? 'nearly ' : '') +
                `enough hack level to get invited to Daedalus once we hit $100b.`;
        }
    }
    if (options['reserving-money-for-daedalus'])
        return `Not installing since we are close to earning an invite from Daedalus.`;
    if (bitNode == 10 && playerData.money >= 10e15)
        return `Not installing anymore since we are nearing the 100q needed to purchase the 6th sleeve from the Covenant.`;
    return null;
}

async function refreshOwnedAfterAutomatedPurchase(ns) {
    ownedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
    installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
    numAugsAwaitingInstall = ownedAugmentations.length - installedAugmentations.length;
    purchaseableAugs = [];
    purchaseFactionRepCosts = [];
}

async function purchaseManagedAugs(ns, state, purchaseMode = null) {
    if (purchaseMode && purchaseMode != options['purchase-mode']) {
        options['purchase-mode'] = purchaseMode;
        if (purchaseMode == "no-neuroflux") options['neuroflux-disabled'] = true;
        if (purchaseMode == "cashroot-only") {
            options['neuroflux-disabled'] = true;
            priorityAugs = [augCashRoot];
            desiredAugs = [augCashRoot];
            purchaseableAugs = purchaseableAugs.filter(aug => aug.name == augCashRoot);
        }
    }
    await ns.write("reserve.txt", 0, "w");
    await purchaseDesiredAugs(ns);
    await refreshOwnedAfterAutomatedPurchase(ns);
    state.reservedPurchase = 0;
    state.installCountdown = 0;
    state.installCountdownResets = 0;
    writeInstallState(ns, state);
}

function appendAffordableNeuroFluxForInstallBatch(ns) {
    if (options['neuroflux-disabled'] || bitNode == 8) {
        const reason = options['neuroflux-disabled'] ? 'disabled' : 'BN8';
        addInstallBatchTopUpStatus(`NF skipped: ${reason}`);
        log(ns, `INFO: Install-batch ${strNF} top-up skipped: ${reason}.`, false);
        return 0;
    }
    const augNf = augmentationData[strNF];
    const augNfFaction = factionData[augNf?.getFromJoined?.()];
    if (!augNf || !augNfFaction || !augNf.canAfford()) {
        const reason = !augNf ? `augmentation data missing` :
            !augNfFaction ? `no joined provider` :
                `${augNfFaction.name} rep ${formatNumberShort(augNfFaction.reputation)}/${formatNumberShort(augNf.reputation)}`;
        addInstallBatchTopUpStatus(`NF skipped: ${reason}`);
        log(ns, `INFO: Install-batch ${strNF} top-up skipped: ${reason}.`, false);
        return 0;
    }
    let [purchaseCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
    let budget = Math.max(0, playerData.money + stockValue - getReservedCash());
    nfLevelPurchased = Math.round(Math.log(augNf.price / (augCountMult ** numAugsAwaitingInstall * 750000 * bitNodeMults.AugmentationMoneyCost)) / Math.log(nfCountMult));
    let nfPurchased = purchaseableAugs.filter(a => a.name == strNF).length;
    let added = 0;
    while (added < 200) {
        const nextNfCost = augNf.price * (nfCountMult ** nfPurchased) * (augCountMult ** purchaseableAugs.length);
        const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
        if (totalAugCost + totalRepCost + nextNfCost > budget || nextNfRep > augNfFaction.reputation) {
            const remainingBudget = Math.max(0, budget - totalAugCost - totalRepCost);
            addInstallBatchTopUpStatus(`NF +${added}; next ${formatMoney(nextNfCost)}/${formatNumberShort(nextNfRep)} rep; ` +
                `remaining ${formatMoney(remainingBudget)} of cash+stocks budget ${formatMoney(budget)}; ` +
                `${augNfFaction.name} rep ${formatNumberShort(augNfFaction.reputation)}`);
            log(ns, `INFO: Install-batch ${strNF} top-up stopped after ${added}: next level needs ` +
                `${getCostString(nextNfCost, 0)} and ${formatNumberShort(nextNfRep)} rep; ` +
                `remaining budget ${formatMoney(remainingBudget)}, ` +
                `${augNfFaction.name} rep ${formatNumberShort(augNfFaction.reputation)}.`, false);
            break;
        }
        const nfClone = new AugmentationData(augNf.name, nextNfRep, augNf.price * (nfCountMult ** nfPurchased), augNf.stats, augNf.prereqs);
        nfClone.displayName += ` Level ${nfLevelPurchased + nfPurchased + 1}`;
        purchaseableAugs.push(nfClone);
        totalAugCost += nextNfCost;
        nfPurchased++;
        added++;
    }
    if (added > 0) {
        [purchaseFactionRepCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        if (!installBatchTopUpStatus.some(status => status.startsWith(`NF +${added};`)))
            addInstallBatchTopUpStatus(`NF +${added}; cash+stocks budget ${formatMoney(budget)}`);
        log(ns, `INFO: Added ${added} ${strNF} level${added == 1 ? '' : 's'} as install-batch leftover spend. ` +
            `New batch cost: ${getCostString(totalAugCost, totalRepCost)}.`, printToTerminal, 'info');
    }
    return added;
}

function appendAffordableConcreteAugsForInstallBatch(ns) {
    if (options['purchase-mode'] == "cashroot-only" || options['purchase-mode'] == "soa-only") {
        addInstallBatchTopUpStatus(`concrete skipped: ${options['purchase-mode']}`);
        log(ns, `INFO: Install-batch concrete top-up skipped in ${options['purchase-mode']} mode.`, false);
        return 0;
    }
    if (bitNode == 8) {
        addInstallBatchTopUpStatus(`concrete skipped: BN8`);
        log(ns, `INFO: Install-batch concrete top-up skipped in BN8.`, false);
        return 0;
    }
    let added = 0;
    let lastCandidates = 0;
    let lastRemainingBudget = 0;
    let lastBudget = 0;
    let lastCheapestCandidateCost = Infinity;
    while (added < 200) {
        const plannedNames = new Set(purchaseableAugs.map(aug => aug.name));
        const [purchaseCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        const budget = Math.max(0, playerData.money + stockValue - getReservedCash());
        lastBudget = budget;
        const ownedOrPlanned = new Set([...simulatedOwnedAugmentations, ...plannedNames]);
        lastRemainingBudget = Math.max(0, budget - totalAugCost - totalRepCost);
        const candidates = Object.values(augmentationData)
            .filter(aug => aug.name != strNF && !aug.owned && !plannedNames.has(aug.name))
            .filter(aug => !(aug.name == augTRP && shouldDeferBn3TrpForDaedalusBatch(purchaseableAugs)))
            .filter(aug => aug.canAfford() || aug.canAffordWithDonation())
            .filter(aug => aug.prereqs.every(prereq => ownedOrPlanned.has(prereq)));
        lastCandidates = candidates.length;
        const candidatesWithCosts = candidates.map(aug => ({
            aug,
            cost: aug.price * augCountMult ** purchaseableAugs.length + getReqDonationForAug(aug),
        }));
        lastCheapestCandidateCost = candidatesWithCosts.length > 0 ? Math.min(...candidatesWithCosts.map(candidate => candidate.cost)) : Infinity;
        const nextAug = sortAugs(ns, candidatesWithCosts
            .filter(candidate => totalAugCost + totalRepCost + candidate.cost <= budget)
            .map(candidate => candidate.aug))[0];
        if (!nextAug) break;
        purchaseableAugs.push(nextAug);
        purchaseFactionRepCosts = purchaseCosts;
        added++;
    }
    if (added > 0) {
        const costs = computeCosts(purchaseableAugs);
        purchaseFactionRepCosts = costs[0];
        const totalRepCost = costs[1];
        const totalAugCost = costs[2];
        addInstallBatchTopUpStatus(`concrete +${added}; cash+stocks budget ${formatMoney(lastBudget)}`);
        log(ns, `INFO: Added ${added} extra non-NeuroFlux augmentation${added == 1 ? '' : 's'} as install-batch leftover spend. ` +
            `New batch cost: ${getCostString(totalAugCost, totalRepCost)}.`, printToTerminal, 'info');
    } else {
        addInstallBatchTopUpStatus(`concrete +0; candidates ${lastCandidates}; remaining ${formatMoney(lastRemainingBudget)}` +
            (Number.isFinite(lastCheapestCandidateCost) ? `; cheapest ${formatMoney(lastCheapestCandidateCost)}` : '') +
            `; cash+stocks budget ${formatMoney(lastBudget)}`);
        log(ns, `INFO: Install-batch concrete top-up added none: ${lastCandidates} candidate(s) within rep/prereq, ` +
            `remaining budget ${formatMoney(lastRemainingBudget)}.`, false);
    }
    return added;
}

function getInstallBatchNeuroFluxRepTopUpBlocker() {
    if (options['neuroflux-disabled'] || bitNode == 8) return null;
    const augNf = augmentationData[strNF];
    const augNfFaction = factionData[augNf?.getFromJoined?.()];
    if (!augNf || !augNfFaction) return null;
    const [purchaseCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
    const budget = Math.max(0, playerData.money + stockValue - getReservedCash());
    const nfPurchased = purchaseableAugs.filter(a => a.name == strNF).length;
    const nextNfCost = augNf.price * (nfCountMult ** nfPurchased) * (augCountMult ** purchaseableAugs.length);
    const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
    const remainingBudget = Math.max(0, budget - totalAugCost - totalRepCost);
    const repGap = nextNfRep - augNfFaction.reputation;
    if (repGap <= 0 || repGap > maxInstallBatchNeuroFluxRepTopUp) return null;
    if (nextNfCost > remainingBudget) return null;
    return { faction: augNfFaction.name, currentRep: augNfFaction.reputation, nextRep: nextNfRep, repGap, nextCost: nextNfCost, remainingBudget, budget };
}

function launchAscendForManagedInstall(ns, status, summary) {
    const ascendArgs = ['--install-augmentations', true, '--skip-faction-manager-purchase', '--on-reset-script', options['on-reset-script']];
    if (summary.pendingAugInclNfCount == 0)
        ascendArgs.push("--allow-soft-reset");
    log(ns, `INFO: faction-manager.js invoking ascend.js to install: ${summary.augSummary}`, true, 'info');
    try {
        ns.spawn(getFilePath('ascend.js'), { threads: 1, spawnDelay: 1000 }, ...ascendArgs);
        return `Invoking ascend.js to install: ${summary.augSummary}`;
    } catch (error) {
        const message = `ERROR: Failed to launch ascend.js. Will try again later. Caught: ${getErrorInfo(error)}`;
        log(ns, message, true, 'error');
        return message;
    }
}

async function manageAutomatedAugmentations(ns, resetInfo, ownedSourceFiles, sf11Level) {
    const state = readInstallState(ns, resetInfo);
    if (options['money-focus-active']) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return { status: `BN3 --money-focus is active. Not buying or installing augmentations while money-focus is enabled.` };
    }
    if (options['bn10-sleeves-incomplete']) {
        const sleeveReserve = options['bn10-sleeve-reserve'] || 0;
        // Decide: save for sleeve (no install), or allow installs to boost income multipliers.
        // Heuristic: if sleeve is achievable within 3h at current gang income → save.
        // If farther away, an aug-reset now pays off (better multipliers → higher gang income → sleeve sooner).
        let sleeveAchievableSoon = !sleeveReserve;
        if (sleeveReserve > 0) {
            const gangInfo = await getGangInfo(ns);
            const incomePerSec = gangInfo?.moneyGainRate || 0;
            const shortfall = Math.max(0, sleeveReserve - playerData.money - stockValue);
            const secondsToSleeve = shortfall <= 0 ? 0 : (incomePerSec > 0 ? shortfall / incomePerSec : Infinity);
            const thresholdSec = 90 * 60; // 90min: beyond this, installs beat passive saving
            sleeveAchievableSoon = secondsToSleeve < thresholdSec;
            const etaStr = Number.isFinite(secondsToSleeve) ? formatDuration(secondsToSleeve * 1000) : "∞";
            const decision = sleeveAchievableSoon ? "saving for sleeve (< 90min away)" : "allowing aug-reset to boost income multipliers (≥ 90min away)";
            log(ns, `INFO: BN10 next sleeve/memory: shortfall ${formatMoney(shortfall)}, gang income ${formatMoney(incomePerSec)}/s, ` +
                `ETA ${etaStr} → ${decision}.`, printToTerminal, 'info');
        }
        if (sleeveAchievableSoon) {
            state.reservedPurchase = 0;
            state.installCountdown = 0;
            writeInstallState(ns, state);
            // Buy NF/augs with excess money above the sleeve reserve but do NOT install.
            // purchaseDesiredAugs respects reserve.txt (set by autopilot to sleeveReserve).
            await purchaseDesiredAugs(ns);
            await refreshOwnedAfterAutomatedPurchase(ns);
            return {
                status: `BN10 sleeves/memory incomplete: sleeve < 90min away. ` +
                    `Buying augs/NF with excess cash only; reserving ${formatMoney(sleeveReserve)} for sleeve/memory.`
            };
        }
        // Sleeve is ≥ 90min away — fall through to normal install path so aug-reset boosts income multipliers.
    }

    const bn3FirstInstall = isBn3FirstAugReset(resetInfo) && installedAugmentations.filter(a => a != strNF).length == 0;
    if (bn3FirstInstall) {
        const nonNfAwaitingInstall = ownedAugmentations.slice(installedAugmentations.length).filter(a => a != strNF).length;
        if (nonNfAwaitingInstall > 0)
            purchaseableAugs = [];
        else {
            const firstNonNfAug = purchaseableAugs.find(aug => aug.name != strNF);
            purchaseableAugs = firstNonNfAug ? [firstNonNfAug] : purchaseableAugs.filter(aug => aug.name == strNF);
        }
        [purchaseFactionRepCosts] = computeCosts(purchaseableAugs);
    }

    const status = buildAugmentationStatus();
    const summary = getPendingAugmentationSummary(status);
    const totalCost = status.total_rep_cost + status.total_aug_cost;
    const factionWorkIdleStatus = getRecentFactionWorkIdleStatus(ns, resetInfo);
    const inFirstBn9Aug = bitNode == 9 && Math.abs(resetInfo.lastNodeReset - resetInfo.lastAugReset) < 1000;
    let reducedAugReq = Math.floor(options['reduced-aug-requirement-per-hour'] * (Date.now() - resetInfo.lastAugReset) / 3.6E6);
    if (inFirstBn9Aug)
        reducedAugReq = -2;
    const augsNeeded = bn3FirstInstall ? 1 : Math.max(1, options['install-at-aug-count'] + sf11Level - reducedAugReq);
    const augsNeededInclNf = bn3FirstInstall ? 1 : Math.max(1, options['install-at-aug-plus-nf-count'] + sf11Level - reducedAugReq);
    const bn8FrequentInstall = bitNode == 8;
    const bn8TrpReady = status.affordable_augs.includes(augTRP) || status.awaiting_install_augs.includes(augTRP);
    const bn8DaedalusReady = playerData.factions.includes("Daedalus") ||
        (status.installed_count >= bitNodeMults.DaedalusAugsRequirement && playerData.skills.hacking >= (2500 * 0.9));
    const bn8RedPillMode = bn8FrequentInstall && !installedAugmentations.includes(augTRP) && (bn8DaedalusReady || bn8TrpReady);
    const soaPriorityMode = bitNode == 3 && options['purchase-mode'] == "soa-only" && !installedAugmentations.includes(soaWksHarmonizer);
    const cashRootPriorityEligible = bitNode == 3 && status.installed_count_ex_nf > 0;
    const cashRootReady = cashRootPriorityEligible && !installedAugmentations.includes(augCashRoot) &&
        (status.affordable_augs.includes(augCashRoot) || status.awaiting_install_augs.includes(augCashRoot));
    const cashRootGateActive = !soaPriorityMode && cashRootPriorityEligible && !installedAugmentations.includes(augCashRoot) && !cashRootReady;
    const bn3FirstInstallNfFallback = bn3FirstInstall && status.affordable_count_ex_nf == 0 &&
        status.awaiting_install_count_ex_nf == 0 && (status.affordable_count_nf > 0 || status.awaiting_install_count_nf > 0);

    if (bn8RedPillMode && playerData.factions.includes("Daedalus") && !bn8TrpReady) {
        const interval = 60 * 1000;
        if (Date.now() - state.lastBn8TrpPurchaseAttempt < interval) {
            writeInstallState(ns, state);
            return { status: `BN8 Red Pill mode: joined Daedalus but "${augTRP}" is not purchased. Waiting before retrying faction-manager purchase.` };
        }
        state.lastBn8TrpPurchaseAttempt = Date.now();
        writeInstallState(ns, state);
        log(ns, `INFO: BN8 Red Pill mode: forcing a faction-manager purchase attempt for "${augTRP}".`, true, 'info');
        await purchaseManagedAugs(ns, state, "no-neuroflux");
        return { status: `BN8 Red Pill mode: forced a purchase attempt for "${augTRP}".` };
    }
    if (cashRootGateActive) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return {
            status: `CashRoot priority mode: not buying or installing non-CashRoot augmentation(s). ` +
                `Working toward "${augCashRoot}" from Sector-12 first.` + summary.detailLines.join("")
        };
    }
    if (bn8RedPillMode && status.affordable_count_ex_nf > 0 && !status.affordable_augs.includes(augTRP)) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return {
            status: `BN8 Red Pill mode: not buying ${status.affordable_count_ex_nf} non-TRP augmentation(s). ` +
                `Preserving this reset and cash for Daedalus and "${augTRP}". Ready now: ${summary.augSummary}` + summary.detailLines.join("")
        };
    }

    let resetStatus = `Reserving ${formatMoney(totalCost)} to install ${summary.augSummary}`;
    const bn3DaedalusBlockers = getBn3DaedalusBatchBlockers(purchaseableAugs);
    const installTargetReady = options['install-for-augs'].some(a =>
        !(a == augTRP && bn3DaedalusBlockers.length > 0) &&
        (status.affordable_augs.includes(a) || status.awaiting_install_augs.includes(a)));
    let shouldReset = installTargetReady ||
        summary.pendingAugCount >= augsNeeded || summary.pendingAugInclNfCount >= augsNeededInclNf;
    let installCountdown = Number(options['install-countdown']) || 0;
    if (!shouldReset && factionWorkIdleStatus && summary.pendingAugCount > 0) {
        shouldReset = true;
        installCountdown = 0;
        resetStatus = `Faction work made no progress recently (${factionWorkIdleStatus.reason}), so installing the currently available batch instead of waiting for ` +
            `${augsNeeded} new augs.\n${resetStatus}`;
    }
    if (bn3FirstInstall) {
        resetStatus = (bn3FirstInstallNfFallback ?
            `BN3 first-install mode: no non-NeuroFlux augmentation is ready; installing maximum affordable NeuroFlux Governor levels instead.` :
            `BN3 first-install mode: installing after exactly one non-NeuroFlux augmentation is ready.`) +
            `\n${resetStatus}`;
        installCountdown = 0;
    }
    if (cashRootReady) {
        resetStatus = `"${augCashRoot}" is ready or awaiting install. Holding it until the normal install policy is ready.\n${resetStatus}`;
    }
    if (soaPriorityMode) {
        resetStatus = `BN3 SoA priority mode: buying/installing "${soaWksHarmonizer}" before CashRoot faction work.\n${resetStatus}`;
        installCountdown = 0;
    }
    if (bn8FrequentInstall && status.affordable_count_ex_nf > 0 && (!bn8RedPillMode || status.affordable_augs.includes(augTRP))) {
        shouldReset = true;
        resetStatus = `BN8 frequent-install mode: buying the current non-NeuroFlux batch immediately before installing.\n${resetStatus}`;
        installCountdown = 0;
    }
    if (bn8FrequentInstall && status.awaiting_install_count > 0 && status.affordable_count_ex_nf == 0 && (!bn8RedPillMode || bn8TrpReady)) {
        shouldReset = true;
        resetStatus = `BN8 frequent-install mode: installing already-purchased augmentations immediately after buying the current non-NeuroFlux batch.\n${resetStatus}`;
        installCountdown = 0;
    } else if (bn8RedPillMode && status.awaiting_install_count > 0 && !bn8TrpReady) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return {
            status: `BN8 Red Pill mode: not installing already-purchased non-TRP augmentation(s). ` +
                `Preserving this reset for Daedalus and "${augTRP}". Ready now: ${summary.augSummary}` + summary.detailLines.join("")
        };
    }

    const quickInstallThreshold = options['player-in-gang'] ? 6 : 4;
    if (!cashRootGateActive && !inFirstBn9Aug && !bn8FrequentInstall &&
        (Date.now() - resetInfo.lastAugReset) < 20 * 60 * 1000 && summary.pendingAugInclNfCount >= quickInstallThreshold) {
        shouldReset = true;
        resetStatus = `We haven't been in this reset for long. We can do a quick reset immediately for a quick stat boost.\n${resetStatus}`;
        if (installCountdown > 30 * 1000 && !options['player-in-gang'])
            installCountdown = 30 * 1000;
    }

    if (!shouldReset && bn8RedPillMode && !status.affordable_augs.includes(augTRP)) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return {
            status: `BN8 Red Pill mode is preserving this reset and cash until "${augTRP}" is affordable or awaiting install. ` +
                `Ready now: ${summary.augSummary}` + summary.detailLines.join("") +
                ` (\`run faction-manager.js --purchase-mode no-neuroflux\` for details)`
        };
    }
    if (!shouldReset) {
        state.reservedPurchase = 0;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        if (bn3DaedalusBlockers.length > 0)
            return {
                status: `BN3 Daedalus batch mode: ${status.awaiting_install_augs.includes(augTRP) ? `"${augTRP}" is awaiting install, but ` : ''}` +
                    `higher-rep/price Daedalus target(s) remain: ${formatAugList(bn3DaedalusBlockers)}. ` +
                    `Continuing faction work instead of buying/installing "${augTRP}" early.`
            };
        if (bn8FrequentInstall)
            return {
                status: `BN8 frequent-install mode is waiting for an affordable or purchased non-NeuroFlux augmentation. ` +
                    `Ready now: ${summary.augSummary}` + summary.detailLines.join("") +
                    ` (\`run faction-manager.js --purchase-mode no-neuroflux\` for details)`
            };
        return {
            status: `Currently at ${formatDuration(Date.now() - resetInfo.lastAugReset)} since last aug. ` +
                `Waiting for ${augsNeeded} new augs (or ${augsNeededInclNf} including NeuroFlux levels) before installing.` +
                `\nReady now: ${summary.augSummary}` + summary.detailLines.join("") +
                ((status.affordable_count_ex_nf + status.affordable_count_nf) == 0 ? '' : `\n  Total Cost to buy remaining affordable augs: ${formatMoney(totalCost)}`) +
                ` (\`run faction-manager.js\` for details)`
        };
    }

    const delayReason = await shouldDelayAutomatedInstall(ns, resetInfo, status, augsNeeded, augsNeededInclNf);
    if (delayReason) {
        state.reservedPurchase = 0;
        writeInstallState(ns, state);
        return { status: delayReason };
    }

    const addedConcrete = appendAffordableConcreteAugsForInstallBatch(ns);
    const addedNf = appendAffordableNeuroFluxForInstallBatch(ns);
    if (addedConcrete > 0 || addedNf > 0) {
        const refreshedStatus = buildAugmentationStatus();
        const refreshedSummary = getPendingAugmentationSummary(refreshedStatus);
        status.affordable_augs = refreshedStatus.affordable_augs;
        status.affordable_count = refreshedStatus.affordable_count;
        status.affordable_count_nf = refreshedStatus.affordable_count_nf;
        status.affordable_count_ex_nf = refreshedStatus.affordable_count_ex_nf;
        status.total_rep_cost = refreshedStatus.total_rep_cost;
        status.total_aug_cost = refreshedStatus.total_aug_cost;
        summary.pendingAugCount = refreshedSummary.pendingAugCount;
        summary.pendingNfCount = refreshedSummary.pendingNfCount;
        summary.pendingAugInclNfCount = refreshedSummary.pendingAugInclNfCount;
        summary.augSummary = refreshedSummary.augSummary;
        summary.detailLines = refreshedSummary.detailLines;
    }
    const finalTotalCost = status.total_rep_cost + status.total_aug_cost;
    const nfRepTopUpBlocker = getInstallBatchNeuroFluxRepTopUpBlocker();
    if (nfRepTopUpBlocker) {
        state.reservedPurchase = finalTotalCost;
        state.installCountdown = 0;
        writeInstallState(ns, state);
        return {
            status: `Waiting for short ${strNF} reputation top-up before installing current batch. ` +
                `${nfRepTopUpBlocker.faction} has ${formatNumberShort(nfRepTopUpBlocker.currentRep)}/${formatNumberShort(nfRepTopUpBlocker.nextRep)} rep ` +
                `(missing ${formatNumberShort(nfRepTopUpBlocker.repGap)}, cap ${formatNumberShort(maxInstallBatchNeuroFluxRepTopUp)}); ` +
                `next level costs ${formatMoney(nfRepTopUpBlocker.nextCost)} with ${formatMoney(nfRepTopUpBlocker.remainingBudget)} remaining budget. ` +
                `Ready now: ${summary.augSummary}` + summary.detailLines.join("")
        };
    }

    if (state.reservedPurchase < finalTotalCost) {
        if (state.reservedPurchase == 0)
            state.installCountdown = Date.now() + (bn8FrequentInstall ? 0 : installCountdown);
        else if (addedConcrete == 0 && addedNf == 0 && !status.affordable_augs.includes(augTRP) && !status.awaiting_install_augs.includes(augTRP)) {
            state.installCountdownResets++;
            const newCountdown = Date.now() + Math.max(10 * 1000,
                installCountdown * (1 - (state.installCountdownResets / augsNeededInclNf)));
            if (newCountdown > state.installCountdown)
                state.installCountdown = newCountdown;
        }
        state.reservedPurchase = finalTotalCost;
        writeInstallState(ns, state);
    }
    if (state.installCountdown > Date.now()) {
        resetStatus += `\n  Waiting for ${formatDuration(installCountdown)} (--install-countdown) ` +
            `to elapse before we install, in case we're close to being able to purchase more augmentations...`;
        ns.toast(`Heads up: faction-manager plans to reset in ${formatDuration(state.installCountdown - Date.now())}`, 'info');
        writeInstallState(ns, state);
        return { status: resetStatus, install_countdown: state.installCountdown };
    }
    await ns.write("reserve.txt", 0, "w");
    if ((status.affordable_count_ex_nf + status.affordable_count_nf) > 0) {
        log(ns, `INFO: Buying the selected augmentation batch immediately before install handoff.`, true, 'info');
        await purchaseManagedAugs(ns, state, bn8FrequentInstall ? "no-neuroflux" : null);
    }
    return { status: launchAscendForManagedInstall(ns, status, summary), installing: true };
}

/** Ram-dodge getting updated player info.
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} Gang information, if we're in a gang, or False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false',
        '/Temp/gang-stats.txt');
}

// Helper function to make multi names shorter for display in a table
function shorten(mult) {
    return mult.replace("_mult", "").replace("company", "cmp").replace("faction", "fac").replace("money", "$").replace("crime", "crm")
        .replace("agility", "agi").replace("strength", "str").replace("charisma", "cha").replace("defense", "def").replace("dexterity", "dex").replace("hacking", "hack")
        .replace("hacknet_node", "hn").replace("bladeburner", "bb").replace("stamina", "stam")
        .replace("success_chance", "success").replace("success", "prob").replace("chance", "prob");
}

// Helper function to take a shortened multi name provided by the user and map it to a real multi
function unshorten(strMult) {
    if (!strMult) return strMult;
    if (stat_multis.includes(strMult)) return strMult; // They just omitted the "_mult" suffix shared by all
    if (stat_multis.includes(strMult.replace("_mult", ""))) return strMult.replace("_mult", ""); // _mult suffix no longer appears
    if (stat_multis.includes(strMult.replace("_level", ""))) return strMult.replace("_level", ""); // Users can explicitly request just the base mult (and not all mults that include it) by specifying the _level suffix
    if (strMult == "*") return "hacking"; // Default if no one stat was provided (* is the wildcard)
    let match = stat_multis.find(m => m == strMult || shorten(m) == strMult) || // Match exactly on the short-form of a multiplier
        stat_multis.find(m => m.startsWith(strMult)) || // Otherwise match on the first multiplier that starts with the provided string
        stat_multis.find(m => m.includes(strMult)); // Otherwise match on the first multiplier that contains the provided string
    if (match !== undefined) return match;
    throw `The specified stat name '${strMult}' does not match any of the known stat names: ${stat_multis.join(', ')}`;
}

let factionSortOrder = (a, b) => factionSortValue(a) - factionSortValue(b);
let factionSortValue = faction => {
    let preferredIndex = factionNames.indexOf(faction.name || faction);
    return preferredIndex == -1 ? 99 : preferredIndex;
};

/** Ram-dodging helper, runs a command for all items in a list and returns a dictionary.
 * @returns {string} */
const dictCommand = (command) => `Object.fromEntries(ns.args.map(o => [o, ${command}]))`;

/** Get a dictionary from retrieving the same infromation for every server name
 * @param {NS} ns
 * @param {any[]} listItems
 * @returns {Promise<{[k: string]: any}>} */
async function getSingularityDict(ns, command, listItems) {
    return await getNsDataThroughFile(ns, dictCommand(`ns.singularity.${command}(o)`),
        `/Temp/singularity-${command}-all.txt`, listItems);
}

/** @param {NS} ns
 * @param {string[]} factionsToOmit **/
async function updateFactionData(ns, factionsToOmit) {
    // Gather a list of all faction names to collect information about. Start with any player joined and invited factions
    const invitations = (/**@returns {string[]}*/() => null)() ??
        await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()', '/Temp/ns-singularity-checkFactionInvitations.txt');
    factionNames = joinedFactions.concat(invitations);
    // Add in factions the user hasn't seen. All factions by default, or a small subset of easy-access factions if --hide-locked-factions is set
    factionNames.push(...(options['hide-locked-factions'] ? easyAccessFactions : allFactions).filter(f => !factionNames.includes(f)));
    // Unless "all factions" is requested, omit factions that are in no way accessible on this reset
    if (!options.all) {
        if (!(13 in effectiveSourceFiles)) factionsToOmit.push("Church of the Machine God");
        if (!(6 in effectiveSourceFiles || 7 in effectiveSourceFiles)) factionsToOmit.push("Bladeburners");
    }
    // Finally, remove all factions marked as omitted
    log(ns, `We "know" about ${factionNames.length} factions, and will omit ${factionsToOmit.length} of them.`);
    factionNames = factionNames.filter(f => !factionsToOmit.includes(f));
    // Force-feed typescript information about the type of these dictionaries retrieved via ram-dodging
    const dictFactionAugs = (/**@returns {{[factionName: string]: string[]}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationsFromFaction', factionNames);
    const dictFactionReps = (/**@returns {{[factionName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getFactionRep', factionNames);
    const dictFactionFavors = (/**@returns {{[factionName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getFactionFavor', factionNames);

    // Need information about our gang to work around a TRP bug - gang faction appears to have it available, but it's not (outside of BN2)
    if (gangFaction && bitNode != 2)
        dictFactionAugs[gangFaction] = dictFactionAugs[gangFaction]?.filter(a => a != "The Red Pill");
    if (dictFactionAugs[shadowsOfAnarchy])
        dictFactionAugs[shadowsOfAnarchy] = dictFactionAugs[shadowsOfAnarchy].filter(a => a == soaWksHarmonizer);

    factionData = Object.fromEntries(factionNames.map(faction => [faction, new FactionData(
        faction, invitations.includes(faction), joinedFactions.includes(faction), dictFactionReps[faction], dictFactionFavors[faction], dictFactionAugs[faction]
    )]));
}

/** Custom class with all faction data we care to gather, plus some helper functions. */
class FactionData {
    /** @param {string} faction The faction name
     * @param {boolean} invited Whether we have an invitation to this faction 
     * @param {boolean} joined Whether we have an already joined this faction 
     * @param {number} factionRep The amount of reputation we have with this faction
     * @param {number} factionFavor The amount of faction favour we have with this faction
     * @param {string[]} augmentationNames The names of all augmentations offered by this faction **/
    constructor(faction, invited, joined, factionRep, factionFavor, augmentationNames) {
        this.name = faction;
        this.invited = invited;
        this.joined = joined;
        this.reputation = factionRep || 0;
        this.favor = factionFavor;
        this.augmentations = augmentationNames;
    }
    /** @param {boolean} includeNf Whether to include NeuroFlux (generally offered by all factions) in the list of augmentations offered.
     * @returns {string[]} A list of augmentations we don't own that are offered by this faction */
    unownedAugmentations(includeNf = false) {
        return this.augmentations.filter(aug => !simulatedOwnedAugmentations.includes(aug) && (aug != strNF || includeNf))
    }
    /** @returns {number} The most cost (monetary) of the most expensive augmentation offered by this faction. */
    mostExpensiveAugCost() {
        return this.augmentations.map(augName => augmentationData[augName]).reduce((max, aug) => Math.max(max, aug.price), 0)
    }
    /** @returns {Map<string, AugmentationData>}  */
    totalUnownedMults() {
        return this.unownedAugmentations().map(augName => augmentationData[augName])
            .reduce((arr, aug) => Object.keys(aug.stats).forEach(stat => arr[stat] = ((arr[stat] || 1) * aug.stats[stat])) || arr, new Map);
    }
}

/** Updates the global "augmentationData" property with information about every augmentation.
 * @param {NS} ns **/
async function updateAugmentationData(ns) {
    const augmentationNames = [...new Set(Object.values(factionData).flatMap(f => f.augmentations))]; // augmentations.slice();
    // Force-feed typescript information about the type of these dictionaries retrieved via ram-dodging
    const dictAugRepReqs = (/**@returns {{[augmentationName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationRepReq', augmentationNames);
    const dictAugPrices = (/**@returns {{[augmentationName: string]: number}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationPrice', augmentationNames);
    const dictAugStats = (/**@returns {{[augmentationName: string]: Multipliers}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationStats', augmentationNames);
    const dictAugPrereqs = (/**@returns {{[augmentationName: string]: string[]}}*/() => null)() ??
        await getSingularityDict(ns, 'getAugmentationPrereq', augmentationNames);
    // Create a new dictionary of augmentation data by augmentation name
    augmentationData = Object.fromEntries(augmentationNames.map(aug => [aug, new AugmentationData(
        aug, dictAugRepReqs[aug], dictAugPrices[aug], dictAugStats[aug], dictAugPrereqs[aug]
    )]));
    /** Helper function which will propagate the "desired" (priority) status to any dependencies of desired augs.
     * Note when --all mode is not enabled, it's possible some prereqs will be missing from our list
     * @param {AugmentationData} aug */
    function propagateDesired(aug) {
        if (!aug.desired || !aug.prereqs) return;
        aug.prereqs.forEach(prereqName => {
            let pa = augmentationData[prereqName];
            if (!pa) return log(ns, `WARNING: Missing info about aug ${aug.name} prerequisite ${prereqName}. We likely don't have access.`);
            if (pa.owned) return;
            if (!pa.desired) {
                log(ns, `INFO: Promoting aug "${prereqName}" to "desired" status, because desired aug "${aug.name}" depends on it.`);
                pa.desired = true;
            } // Also propagate the "priority" status to any dependencies of priority augs (dependency must be made a higher priority)
            if (priorityAugs.includes(aug.name) && !priorityAugs.includes(prereqName)) {
                log(ns, `INFO: Promoting aug "${prereqName}" to "priority" status, because priority aug "${aug.name}" depends on it.`, true);
                priorityAugs.splice(priorityAugs.indexOf(aug.name), 0, prereqName);
            }
            propagateDesired(pa); // Recurse on any nested prerequisites of this prerequisite aug.
        })
    }
    const allAugmentations = Object.values(augmentationData);
    allAugmentations.forEach(a => propagateDesired(a));
    // Prepare a collection of all augmentations' statistics
    allAugStats = allAugmentations.flatMap(aug => Object.keys(aug.stats)).filter((v, i, a) => a.indexOf(v) === i).sort();
}

/** Helper function to determine if the specified stat matches one of the requested desired stats.
 * @param {string} stat_name The name of the player multiplier affected */
function isStatDesired(stat_name) {
    return desiredStatsFilters.includes('*') || desiredStatsFilters.includes('_') || // Wildcards - if all stats are desired, always return true (_ is for backwards compatibility when all stat names ended with '_mult')
        desiredStatsFilters.some(filter => stat_name.includes(filter) || // A stat is desired if any "desired stat" string appears anywhere in the stat name
            stat_name == filter.replace("_level", "")); // Users can explicitly request just the base mult (and not all mults that include it as a substring) by specifying the _level suffix
}

/** Custom class with all augmentation data we care to gather, plus some helper functions. */
class AugmentationData {
    /** @param {string} aug The augmentation name
     * @param {number} reputationRequirement The required reputation to unlock this augmentation (it's the same for all factions that carry it)
     * @param {number} price The cost (money) of this augmentation
     * @param {Multipliers} augmentationStats The stats granted if this augmentation is installed.
     * @param {string[]} augmentationPrereqs The names of all augmentations which must be installed before this one. **/
    constructor(aug, reputationRequirement, price, augmentationStats, augmentationPrereqs) {
        this.name = aug;
        this.displayName = aug;
        this.owned = simulatedOwnedAugmentations.includes(aug);
        this.reputation = reputationRequirement;
        this.price = price;
        /** The stats for this augmentation, except that all properties with a value of 1.0 have been stripped out. @type {Multipliers} */
        this.stats = Object.fromEntries(Object.entries(augmentationStats).filter(([k, v]) => v != 1));
        this.prereqs = augmentationPrereqs || [];
        this.desired = desiredAugs.includes(aug) || // Mark as "desired" augs explicitly requested, or those with stats in the 'stat-desired' command line options
            desiredStatsFilters.includes('*') || desiredStatsFilters.includes('_') || // Wildcards - all stats are desired (_ is for backwards compatibility when all stat names ended with '_mult')
            Object.keys(this.stats).some(stat => isStatDesired(stat));
        // Get the name of the "most-early-game" faction from which we can buy this augmentation. Estimate this by cost of the most expensive aug the offer
        this.getFromAny = factionNames.map(f => factionData[f]).sort((a, b) => a.mostExpensiveAugCost - b.mostExpensiveAugCost)
            .filter(f => f.augmentations.includes(aug))[0]?.name ?? "(unknown)";
    }
    /** @returns {FactionData[]} A list of joined factions that have this augmentation */
    joinedFactionsWithAug() {
        return factionNames.map(f => factionData[f]).filter(f => f.joined && f.augmentations.includes(this.name));
    }
    /** @returns {boolean} Whether there is some joined faction which already has enough reputation to buy this augmentation */
    canAfford() {
        return this.joinedFactionsWithAug().some(f => f.reputation >= this.reputation);
    }
    /** @returns {boolean} Whether this augmentation can be unlocked with a donation in the current automation path. */
    canAffordWithDonation() {
        return shouldAllowDonationForAug(this) && this.joinedFactionsWithAug().some(f => canDonateToFaction(f));
    }
    /** @returns {string} Get the name of the joined faction from which we should purchase this augmentation. */
    getFromJoined() {
        // For most augmentations, choose to get the augmentation from the faction requiring the lowest cost 
        const augFactions = this.joinedFactionsWithAug();
        if (this.name != strNF)
            return (augFactions.filter(f => f.reputation >= this.reputation)[0] || // Any faction we can buy it from
                (shouldAllowDonationForAug(this) ? augFactions.filter(f => canDonateToFaction(f))
                    .sort((a, b) => getReqDonationForAug(this, a) - getReqDonationForAug(this, b))[0] : null) ||
                augFactions.sort((a, b) => b.reputation - a.reputation)[0] || // Faction we are closest to being able to get it from (most rep)
                augFactions[0])?.name; // First faction in our faction list order (which should be ordered by priority)

        return augFactions.sort((a, b) => ((canDonateToFaction(b) ? 1 : 0) - (canDonateToFaction(a) ? 1 : 0)) || (b.reputation - a.reputation))[0]?.name;
    }
    /** @returns {string} A formatted row of information for this augmentation */
    toString() {
        const factionColWidth = 16, augColWidth = 40, statsColWidth = 60;
        const statKeys = Object.keys(this.stats);
        const statsString = `Stats:${statKeys.length.toFixed(0).padStart(2)}` + (statKeys.length == 0 ? '' : (` { ` +
            // Display a summary of stats (capped at a maximum length). Prioritize showing desired stats, then those with the largest mult
            statKeys.sort((a, b) => (isStatDesired(b) - isStatDesired(a)) || (this.stats[b] - this.stats[a]))
                .map(prop => shorten(prop) + ': ' + Math.round((this.stats[prop] + Number.EPSILON) * 100) / 100).join(', ') + ` }`));
        const factionName = this.getFromJoined() || this.getFromAny;
        const fCreep = Math.max(0, factionName.length - factionColWidth);
        const budget = Math.max(0, playerData.money + stockValue - getReservedCash());
        const augNameShort = this.displayName.length <= (augColWidth - fCreep) ? this.displayName :
            `${this.displayName.slice(0, Math.ceil(augColWidth / 2 - 3 - fCreep))}...${this.displayName.slice(this.displayName.length - Math.floor(augColWidth / 2))}`;
        return `${this.desired ? '*' : ' '} Price: ${formatMoney(this.price, 4).padEnd(7)} ${this.price <= budget ? '✓' : '✗'}  ` +
            `Rep: ${formatNumberShort(this.reputation, 4).padEnd(6)} ${this.canAfford() ? '✓' : this.canAffordWithDonation() ? '$' : '✗'}  ` +
            `Faction: ${factionName.padEnd(factionColWidth)}  Aug: ${augNameShort.padEnd(augColWidth - fCreep)}  ` +
            `${statsString.length <= statsColWidth ? statsString : (statsString.substring(0, statsColWidth - 4) + '... }')}`;
    }
}

/** Helper function to join any factions we have an invite to, and which have augmentations we want.
 * @param {NS} ns
 * @param {string[]} forceJoinFactions A list of factions to join even if they have no remaining augmentations. **/
async function joinFactions(ns, forceJoinFactions) {
    let manualJoin = ["Sector-12", "Chongqing", "New Tokyo", "Ishima", "Aevum", "Volhaven"];
    // If we have already joined one of the "precluding" factions, we are free to join the remainder
    if (joinedFactions.some(f => manualJoin.includes(f)))
        manualJoin = [];
    // Collect the set of augmentations we already have access to given the factions we've joined
    const accessibleAugmentations = new Set(joinedFactions.flatMap(fac => factionData[fac]?.augmentations ?? []));
    log(ns, `${accessibleAugmentations.size} augmentations are already accessible from our ${joinedFactions.length} joined factions.`);
    // Check for faction invitations
    const invitations = Object.values(factionData).filter(f => f.invited);
    log(ns, `Outstanding invitations from ${invitations.length} factions: ${JSON.stringify(invitations.map(f => f.name))}`);
    let joined = 0;
    // Join all factions with remaining augmentations we care about
    for (const faction of invitations.sort(factionSortOrder)) {
        let unownedAugs = faction.unownedAugmentations(true); // Filter out augmentations we've already purchased
        let newAugs = unownedAugs.filter(aug => !accessibleAugmentations.has(aug)); //  Filter out augmentations we can purchase from another faction we've already joined
        let desiredAugs = newAugs.filter(aug => augmentationData[aug].desired); //  Filter out augmentations we have no interest in
        log(ns, `${faction.name} has ${faction.augmentations.length} augs, ${unownedAugs.length} unpurchased, ${newAugs.length} not offered by joined factions, ` +
            `${desiredAugs.length} with desirable stats` + (desiredAugs.length == 0 ? ' (joining anyway for favor/intelligence)' : `: ${JSON.stringify(desiredAugs)}`));
        if (manualJoin.includes(faction.name) && !forceJoinFactions.includes(faction.name))
            log(ns, `INFO: You have an invite from faction ${faction.name}, but it will not be automatically joined, ` +
                `because this would prevent you from joining some other factions.`, printToTerminal, printToTerminal ? 'info' : undefined);
        else {
            log(ns, `Joining faction ${faction.name} which has ${desiredAugs.length} desired augmentations: ${desiredAugs}`);
            let response;
            if (response = await getNsDataThroughFile(ns, `ns.singularity.joinFaction(ns.args[0])`, null, [faction.name])) {
                faction.joined = true;
                faction.augmentations.forEach(aug => accessibleAugmentations.add(aug));
                joinedFactions.push(faction.name);
                log(ns, `SUCCESS: Joined faction ${faction.name} (Response: ${response})`, true, 'success');
                joined++;
            } else
                log(ns, `ERROR: Error joining faction ${faction.name}. Response: ${response}`, false, 'error');
        }
    }
    return joined;
}

/** @param {AugmentationData[]} augPurchaseOrder The augmentations we wish to purchase in order of purchase.
 * @returns The total cost of purchasing all these augmentations in the specified order */
let getTotalCost = (augPurchaseOrder) => augPurchaseOrder.reduce((total, aug, i) => total + aug.price * augCountMult ** i, 0);

/** @param {AugmentationData} a @param {AugmentationData} b */
let augSortOrder = (a, b) =>
    // Hack: Multiple NF have to be from least expensive to most expensive
    (a.name == strNF && b.name == strNF ? a.price - b.price : 0) ||
    (b.price - a.price) || (b.reputation - a.reputation) ||
    (b.desired != a.desired ? (a.desired ? -1 : 1) : a.name.localeCompare(b.name));

/** @param {AugmentationData} a @param {AugmentationData} b */
let cheapAugSortOrder = (a, b) =>
    // BN8 is cash-constrained, so buy cheap augmentations first to lock in frequent resets.
    (a.name == strNF && b.name == strNF ? a.price - b.price : 0) ||
    (a.price - b.price) || (a.reputation - b.reputation) ||
    (b.desired != a.desired ? (a.desired ? -1 : 1) : a.name.localeCompare(b.name));

/** Sort augmentations such that they are in order of price, except when there are prerequisites to worry about
 * @param {NS} ns
 * @param {AugmentationData[]} augs augmentations to sort
 * @returns {AugmentationData[]} The input array of augs, which were sorted in place */
function sortAugs(ns, augs = []) {
    const remaining = augs.slice().sort(bitNode == 8 ? cheapAugSortOrder : augSortOrder);
    const sorted = [];
    const ownedOrSorted = new Set(simulatedOwnedAugmentations);

    while (remaining.length > 0) {
        const nextIndex = remaining.findIndex(aug => aug.prereqs.every(prereq => ownedOrSorted.has(prereq)));
        if (nextIndex === -1) {
            log(ns, `WARNING: Could not find any augmentation with satisfied prerequisites while sorting purchase order. Keeping remaining order as-is.`);
            sorted.push(...remaining);
            break;
        }
        const nextAug = remaining.splice(nextIndex, 1)[0];
        sorted.push(nextAug);
        ownedOrSorted.add(nextAug.name);
    }

    augs.splice(0, augs.length, ...sorted);
    return augs;
}

/** @param {AugmentationData[]} sortedAugs */
function getAffordablePrefixByPurchaseOrder(sortedAugs, budget) {
    const affordable = [];
    let total = 0;
    for (const aug of sortedAugs) {
        const nextCost = aug.price * augCountMult ** affordable.length;
        if (total + nextCost > budget)
            break;
        affordable.push(aug);
        total += nextCost;
    }
    return affordable;
}

/** @param {NS} ns
 * @param {string[]} ignoredAugs a list of augmentation names to ignore
 * Display all information about all augmentations, including lists of available / desired / affordable augmentations in their optimal purchase order.  */
function shouldDemoteTrpPriorityForBn3DaedalusBatch(augs) {
    if (bitNode != 3 || installedAugmentations.includes(augTRP)) return false;
    const daedalus = factionData["Daedalus"];
    const trp = augmentationData[augTRP];
    if (!daedalus?.joined || !trp || !augs.some(aug => aug.name == augTRP)) return false;
    return augs.some(aug => isBn3DaedalusBatchTarget(aug) && aug.name != augTRP &&
        (aug.reputation > trp.reputation || aug.price > trp.price));
}

function getBudgetProtectedPriorityAugs(augs) {
    const demoteTrp = shouldDemoteTrpPriorityForBn3DaedalusBatch(augs);
    return priorityAugs.filter(name => !(demoteTrp && name == augTRP));
}

function getBudgetDropCandidate(augs) {
    const neuroFlux = augs.filter(a => a.name == strNF).slice().sort((a, b) => b.price - a.price)[0];
    if (neuroFlux) return neuroFlux;
    const protectedPriorityAugs = getBudgetProtectedPriorityAugs(augs);
    const unprotected = augs.filter(a => !protectedPriorityAugs.includes(a.name));
    if (unprotected.length > 0)
        return unprotected.slice().sort((a, b) =>
            (a.reputation - b.reputation) || (a.price - b.price) || b.name.localeCompare(a.name))[0];
    const prioritizedInOrder = protectedPriorityAugs.filter(name => augs.some(a => a.name == name));
    return prioritizedInOrder.length == 0 ? null : augs.find(a => a.name == prioritizedInOrder[prioritizedInOrder.length - 1]);
}

function getConcreteTargetAugsNotInPurchaseOrder() {
    const plannedNonNf = new Set(purchaseableAugs.filter(aug => aug.name != strNF).map(aug => aug.name));
    return Object.values(augmentationData)
        .filter(aug => aug.name != strNF && !aug.owned && isPurchaseTargetAug(aug) && !plannedNonNf.has(aug.name));
}

async function manageUnownedAugmentations(ns, ignoredAugs) {
    const reqDaedalusAugs = bitNodeMults.DaedalusAugsRequirement;
    let outputRows = [`Currently have ${ownedAugmentations.length}/${reqDaedalusAugs} Augmentations required for Daedalus.`];
    const unownedAugs = Object.values(augmentationData).filter(aug => (!aug.owned || aug.name == strNF) && !ignoredAugs.includes(aug.name));
    if (unownedAugs.length == 0) return log(ns, `All ${Object.keys(augmentationData).length} augmentations are either owned or ignored!`, printToTerminal)
    let unavailableAugs = unownedAugs.filter(aug => aug.getFromJoined() == null);
    let availableAugs = unownedAugs.filter(aug => aug.getFromJoined() != null);
    // List unavailable augs only if there are none available, or if the user specifically requested to see this list.
    if (availableAugs.length == 0 || unavailableAugs.length > 0 && options['show-unavailable-aug-purchase-order'])
        await manageFilteredSubset(ns, outputRows, 'Unavailable', unavailableAugs, true, false);
    // Prepare and display a little legend of what symbols in our augmentation list mean
    const legendTitle = 'Optimized Purchase Order Legend';
    outputRows.push(legendTitle, '-'.repeat(legendTitle.length), "✓  Can afford", "$  Can donate for required reputation", "✗  Cannot afford",
        `*  Desired aug/stats (${desiredStatsFilters.join(", ")})`, '-'.repeat(legendTitle.length));
    const countAvailable = availableAugs?.length || 0; // Get a count of available augs (including NF) to determine whether to prepare a purchase order
    // Display available augs. We use the return value to "lock in" the new sort order. If enabled, subsequent tables are displayed if the filtered sort order changes.
    availableAugs = ignorePlayerData ? unavailableAugs : // Note: We omit NF from available augs here because as many as we can afford are added at the end.
        await manageFilteredSubset(ns, outputRows, 'Available', availableAugs.filter(aug => aug.name != strNF), true);
    if (countAvailable > 0) {
        let augsWithRep = availableAugs.filter(aug => aug.canAfford() || aug.canAffordWithDonation());
        let desiredAugs = availableAugs.filter(isPurchaseTargetAug);
        if (augsWithRep.length > desiredAugs.length) {
            augsWithRep = await manageFilteredSubset(ns, outputRows, 'Within Rep', augsWithRep)
            desiredAugs = await manageFilteredSubset(ns, outputRows, 'Desired', desiredAugs);
        } else {
            desiredAugs = await manageFilteredSubset(ns, outputRows, 'Desired', desiredAugs);
            augsWithRep = await manageFilteredSubset(ns, outputRows, 'Within Rep', augsWithRep);
        }
        let accessibleAugs = await manageFilteredSubset(ns, outputRows, 'Desired Within Rep', augsWithRep.filter(isPurchaseTargetAug));
        await managePurchaseableAugs(ns, outputRows, accessibleAugs);
    }
    // Print all rows of output that were prepped. Keep as many rows in one log as possible to avoid scrolling the history too much
    log(ns, outputRows.join("\n  "), printToTerminal);
    if (purchaseableAugs.length > 0)
        log(ns, `INFO: The above ${purchaseableAugs.length} augmentations ${options.purchase ? 'will' : 'can'} be purchased ` +
            `${stockValue > 0 ? 'after liquidating stocks' : 'right now'}.` +
            (options.purchase ? '' : ' Run with the --purchase flag to make the purchase.'), printToTerminal);
}

/** Helper to compute the total purchase cost for augmentations, including donations when available.
 * @param {AugmentationData[]} sortedAugs The augmentations we're purchasing, in the order we'll puchase them
 * @returns {[{[factionName: string]: number},number,number]} */
function computeCosts(sortedAugs) {
    const repCostByFaction = {};
    for (const aug of sortedAugs) {
        if (!shouldAllowDonationForAug(aug)) continue;
        const faction = factionData[aug.getFromJoined()];
        const reqDonation = getReqDonationForAug(aug, faction);
        if (reqDonation > 0)
            repCostByFaction[faction.name] = Math.max(repCostByFaction[faction.name] || 0, reqDonation);
    }
    const totalRepCost = Object.values(repCostByFaction).reduce((t, r) => t + r, 0);
    const totalAugCost = getTotalCost(sortedAugs);
    return [repCostByFaction, totalRepCost, totalAugCost];
}

/** Helper to produce a summary of the cost of augs with reputation. */
function getCostString(augCost, repCost) {
    return `${formatMoney(augCost + repCost, 4)}` + (repCost == 0 ? '' : ` (Augs: ${formatMoney(augCost, 4)} + Rep: ${formatMoney(repCost, 4)})`);
}

/** Helper to remove augs that cannot be purchased because their prerequisites are not owned and have been filtered out */
function filterMissingPrereqs(ns, subset) {
    let subsetLength;
    do {
        subsetLength = subset.length
        for (const aug of subset) {
            const missingPreqs = aug.prereqs.filter(prereq => !(simulatedOwnedAugmentations.includes(prereq) || subset.some(a => a.name === prereq)))
            if (missingPreqs.length > 0) {
                log(ns, `INFO: Removing from aug "${aug.name}" (${aug.getFromAny}) due to prerequisites having been filtered out: ${missingPreqs}`)
                subset.splice(subset.indexOf(aug), 1);
            }
        }
        // If any augs were removed, we mut loop back to the start and see if that means other augs need removing
    } while (subsetLength !== subset.length);
    return subset;
}


/** Helper to generate outputs for different subsets of the augmentations, each in optimal sort order
 * @param {NS} ns
 * @param {string[]} outputRows An array of strings to which we should log the cost of these augmentations, and other details as specified.
 * @param {AugmentationData[]} subset A list of augmentations to include in the output.
 * @param {boolean|undefined} printList Whether to print the list to the outputRows. If undefined, we will only automatically print only if the sort order changed.
 * @param {boolean}
 * @returns {Promise<AugmentationData[]>} The list of augmentations, with the requested operations performed */
async function manageFilteredSubset(ns, outputRows, subsetName, subset, printList = undefined, removeMissingPrereqs = true, reorder = true) {
    subset = subset.slice(); // Take a copy so we don't mess up the original array sent in.
    // If enabled, filter out augs who are missing prerequisites
    if (removeMissingPrereqs)
        filterMissingPrereqs(ns, subset)
    let subsetLength = subset.length;
    if (subsetLength == 0) {
        outputRows.push(`There are 0 ${subsetName}`);
        return subset;
    }
    // Sort the filtered subset into its optimal purchase order
    let subsetSorted = reorder ? sortAugs(ns, subset.slice()) : subset;
    let [repCostByFaction, totalRepCost, totalAugCost] = computeCosts(subsetSorted);
    // By default, if the purchase order is unchanged after filtering out augmentations, don't bother reprinting the full list
    if (printList === true || printList !== false && options['show-all-purchase-lists'] && !subset.every((v, i) => v == subsetSorted[i]))
        outputRows.push(`${subset.length} ${subsetName} Augmentations in Optimized Purchase Order:\n  ${subsetSorted.join('\n  ')}`);
    outputRows.push(`Total Cost of ${subset.length} ${subsetName}:`.padEnd(37) + ` ${getCostString(totalAugCost, totalRepCost)}` +
        (totalRepCost == 0 ? '' : `  Donate: {${Object.keys(repCostByFaction).map(f => `"${f}":${formatNumberShort(repCostByFaction[f], 4)}`).join(", ")}}`));
    return subsetSorted;
}

/** @param {NS} ns
 * Prepares a "purchase order" of augs that we can afford.
 * Note: Stores this info in global properties `purchaseableAugs` and `purchaseFactionRepCosts` so that a final action in the main method will do the purchase. */
async function managePurchaseableAugs(ns, outputRows, accessibleAugs) {
    // Refresh player data to get an accurate read of current money
    playerData = await getPlayerInfo(ns);
    const budget = Math.max(0, playerData.money + stockValue - getReservedCash());
    if (shouldOnlyBuyTrpInBn8()) {
        const trp = augmentationData[augTRP];
        accessibleAugs = accessibleAugs.filter(aug => aug.name == augTRP);
        if (accessibleAugs.length == 0 && trp?.getFromJoined() != null && trp.canAfford())
            accessibleAugs = [trp];
        outputRows.push(`INFO: BN8 Red Pill mode: preserving cash and reset progress. Only ${augTRP} will be considered for purchase.`);
    }
    let totalRepCost, totalAugCost, dropped, restart;
    // We will make every effort to keep "priority" augs in the purchase order, but start dropping them if we find we cannot afford them all
    const inaccessiblePriorityAugs = priorityAugs.filter(name => {
        const aug = augmentationData[name];
        return !aug || !accessibleAugs.includes(aug) || aug.price + getReqDonationForAug(aug) > budget;
    });
    const droppedPriorityAugs = inaccessiblePriorityAugs;
    do { // Outer loop is only repeated if we have to drop a priority aug and start over with our purchasable augs determination
        restart = false; // Flag as to whether we need to loop again with different starting set of priority augs
        dropped = [];
        purchaseableAugs = filterMissingPrereqs(ns, accessibleAugs.slice().filter(a => !droppedPriorityAugs.includes(a.name) && a.price + getReqDonationForAug(a) <= budget));
        if (bitNode == 8)
            purchaseableAugs = getAffordablePrefixByPurchaseOrder(sortAugs(ns, purchaseableAugs), budget);
        [purchaseFactionRepCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        // Remove lower-value augmentations until we can afford all that remain.
        while (totalAugCost + totalRepCost > budget && purchaseableAugs.length > 0) {
            let augToDrop = getBudgetDropCandidate(purchaseableAugs);
            const protectedPriorityAugs = getBudgetProtectedPriorityAugs(purchaseableAugs);
            if (!augToDrop) { // If there is nothing but "priority augs" left, then we need the user to deprioritize one or the other
                const aPa = protectedPriorityAugs.filter(name => purchaseableAugs.some(a => a.name == name));
                const toDrop = aPa[aPa.length - 1];
                log(ns, `WARNING: We can afford ${aPa.length} priority augs on their own, but not together. We must drop the lowest-priority one: ${toDrop}`, true, 'warning');
                droppedPriorityAugs.push(toDrop);
                restart = true;
                break;
            }
            let costBefore = getCostString(totalAugCost, totalRepCost);
            purchaseableAugs = sortAugs(ns, purchaseableAugs.filter(aug => aug !== augToDrop));
            [purchaseFactionRepCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
            let costAfter = getCostString(totalAugCost, totalRepCost);
            dropped.unshift({ aug: augToDrop, costBefore, costAfter });
            log(ns, `Dropping lower-priority aug from the purchase order: \"${augToDrop.name}\". New total cost: ${costAfter}`);
        }
    } while (restart);

    const bn3DaedalusBlockers = getBn3DaedalusBatchBlockers(purchaseableAugs);
    if (bn3DaedalusBlockers.length > 0 && purchaseableAugs.some(aug => aug.name == augTRP)) {
        purchaseableAugs = sortAugs(ns, purchaseableAugs.filter(aug => aug.name != augTRP));
        [purchaseFactionRepCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        outputRows.push(`INFO: BN3 Daedalus batch mode: deferring "${augTRP}" purchase until higher-rep/price Daedalus target(s) are included: ` +
            `${formatAugList(bn3DaedalusBlockers)}.`);
    }

    // Display unique affordable augs, but only show the full list if we aren't adding NeuroFlux levels below
    manageFilteredSubset(ns, outputRows, 'Unique Affordable', purchaseableAugs, options['neuroflux-disabled']);

    // The the user know about some of the next upcoming augs / import augs that had to be dropped
    let nextUpAug = dropped.length == 0 ? null : `Next desired aug available at:`.padEnd(37) + ` ${dropped[0].costBefore}  ` +
        `for \"${dropped[0].aug.name}\" from "${dropped[0].aug.getFromJoined()}" (${dropped.length} dropped lower-priority aug${dropped.length == 1 ? '' : 's'})`
    if (nextUpAug && options['neuroflux-disabled']) outputRows.push(nextUpAug); // Output this now if we will be exiting early, otherwise save for after the last table.
    if (numAugsAwaitingInstall > 0)
        outputRows.push(`WARNING: Prices all have a x ${formatNumberShort(augCountMult ** numAugsAwaitingInstall)} cost penalty, because ` +
            `${numAugsAwaitingInstall} Augmentations were previously purchased but are not yet installed.`);
    if (inaccessiblePriorityAugs.length > 0)
        outputRows.push(`INFO: ${inaccessiblePriorityAugs.length} 'priority' augs are not yet accessible: ${inaccessiblePriorityAugs.map(n => `"${n}"`).join(", ")}`);
    const additionalDroppedPri = droppedPriorityAugs.filter(n => !inaccessiblePriorityAugs.includes(n));
    if (additionalDroppedPri.length > 0)
        outputRows.push(`INFO: ${additionalDroppedPri.length} 'priority' augs had to be droped: ${additionalDroppedPri.map(n => `"${n}"`).join(", ")}`);

    // NEXT STEP: Add as many NeuroFlux levels to our purchase as we can (unless disabled)
    if (options['neuroflux-disabled']) return;
    const remainingConcreteTargets = getConcreteTargetAugsNotInPurchaseOrder();
    const bn3FirstInstall = isBn3FirstAugReset() && installedAugmentations.filter(a => a != strNF).length == 0;
    const bn3FirstInstallNeedsNfFallback = bn3FirstInstall && !purchaseableAugs.some(aug => aug.name != strNF);
    if (remainingConcreteTargets.length > 0 && !bn3FirstInstallNeedsNfFallback) {
        outputRows.push(`INFO: Not buying ${strNF} yet. ${remainingConcreteTargets.length} concrete target augmentation(s) remain, ` +
            `so ${strNF} is reserved for leftover cash after goals are complete: ` +
            remainingConcreteTargets.slice(0, 8).map(aug => `"${aug.name}"`).join(", ") +
            (remainingConcreteTargets.length > 8 ? `, ...` : ''));
        if (nextUpAug) outputRows.push(nextUpAug);
        return;
    } else if (bn3FirstInstallNeedsNfFallback && remainingConcreteTargets.length > 0) {
        outputRows.push(`INFO: BN3 first-install mode: no non-${strNF} augmentation is immediately purchasable, ` +
            `so ${strNF} is allowed as the fast first-reset fallback.`);
    }
    const augNf = augmentationData[strNF];
    // We can reverse-engineer our current NeuroFlux level by looking at its current price, and knowing its cost scales at x1.14 per level.
    nfLevelPurchased = Math.round(Math.log(augNf.price / (augCountMult ** numAugsAwaitingInstall * 750000 * bitNodeMults.AugmentationMoneyCost)) / Math.log(1.14));
    let nextNfLevel = nfLevelPurchased + 1;
    let getFrom = augNf.getFromJoined();
    // If No currently joined factions can provide us with the next level of Neuroflux, look for the best joined **or unjoined** faction to get NF from.
    if (!augNf.canAfford()) {
        outputRows.push(`Cannot purchase any ${strNF}. The next level (${nextNfLevel}) requires ${formatNumberShort(augNf.reputation)} reputation, but ` +
            (!getFrom ? `it isn't being offered by any of our factions` : `the best faction (${getFrom}) has insufficient rep (${formatNumberShort(factionData[getFrom].reputation)}).`));
        const factionSort = (a, b) => (b.reputation - a.reputation) || (b.favor - a.favor);
        const factionsWithAug = Object.values(factionData).filter(f => f.augmentations.includes(augNf.name)).sort(factionSort);
        const factionsWithAugAndInvite = factionsWithAug.filter(f => f.invited || f.joined).sort(factionSort);
        const factionWithMostFavor = factionsWithAugAndInvite[0] ?? factionsWithAug[0];
        let joined = 0;
        if (getFrom != factionsWithAug[0].name && factionsWithAug[0] != factionsWithAugAndInvite[0])
            outputRows.push(`SUGGESTION: Earn an invitation to faction ${factionsWithAug[0].name} to get rep for ${strNF}.`);
        else if (factionsWithAug[0].joined)
            outputRows.push(`SUGGESTION: Do infiltration/work for faction ${factionsWithAug[0].name} to earn rep for ${strNF}.`);
        else if (!getFrom || (factionData[getFrom].favor < factionWithMostFavor.favor && factionWithMostFavor.invited)) {
            outputRows.push(`Attempting to join faction ${factionWithMostFavor.name} to make it easier to earn rep for ${strNF}.`);
            joined = await joinFactions(ns, [factionWithMostFavor.name]);
            if (!joinedFactions.includes(factionWithMostFavor.name))
                outputRows.push(`Failed to join ${factionWithMostFavor.name}. NeuroFlux will not be accessible.`);
            // If after the above potential attempt to join a faction offering NF we still can't afford it, we're done here
            getFrom = augNf.getFromJoined();
            if (!getFrom) return log(ns, "Cannot buy any NF due to no joined or joinable factions offering it.");
        }
        if (!augNf.canAfford())
            log(ns, `Cannot buy any NF due to best provider faction ${getFrom} having insufficient rep.`);
        else if (joined)
            outputRows.push(`SUCCESS: Joined ${joined} factions just to gain access to additional NeuroFlux levels.`);
    }
    // Start adding as many NeuroFlux levels as we can afford
    let nfPurchased = purchaseableAugs.filter(a => a.name === augNf.name).length;
    const augNfFaction = factionData[augNf.getFromJoined()];
    if (augNfFaction && augNf.canAfford())
        log(ns, `Getting NF from faction ${augNfFaction.name} (rep: ${formatNumberShort(augNfFaction.reputation)}). Price of next NF (Level ${nextNfLevel}) is ` +
            `${formatMoney(augNf.price)}, requires reputation: ${formatNumberShort(augNf.reputation)} ` +
            `(have ${formatNumberShort(augNfFaction.reputation)})`);
    let nextUpNf; // Will tell the user when they will unlock the next NF level
    while (augNfFaction && nfPurchased < 200) { // Limit to 200 to avoid breaking the game if near infinite money.
        const nextNfCost = augNf.price * (nfCountMult ** nfPurchased) * (augCountMult ** purchaseableAugs.length);
        const nextNfRep = augNf.reputation * (nfCountMult ** nfPurchased);
        const nextNfRepCost = 0;
        const totalCostWithNextNf = totalAugCost + nextNfCost + totalRepCost + nextNfRepCost;
        log(ns, `Adding ${nfPurchased + 1} NF (Level ${nextNfLevel}) Requires ${formatNumberShort(nextNfRep, 4)} reputation, ` +
            `would cost another ${getCostString(nextNfCost, nextNfRepCost)} for a ` +
            `total of ${getCostString(totalAugCost + nextNfCost, totalRepCost + nextNfRepCost)}`);
        if (totalCostWithNextNf > budget || nextNfRep > augNfFaction.reputation) {
            nextUpNf = `Next NF (L${nextNfLevel}) will be available at:`.padEnd(37) +
                ` ${getCostString(totalAugCost + nextNfCost, totalRepCost + nextNfRepCost)}  Money (` +
                `${(totalCostWithNextNf > budget ? '✗' : '✓')}) and ${formatNumberShort(nextNfRep)} Reputation with "${augNfFaction.name}" (` +
                (nextNfRep > augNfFaction.reputation ? '✗' : '✓') +
                ` have ${formatNumberShort(augNfFaction.reputation)})`;
            break; // If we cannot afford the next NF, break
        }
        // Otherwise, add the next NF to the end of our purchase order as leftover spend after concrete goals.
        const nextNfPrice = augNf.price * (nfCountMult ** nfPurchased); // Note this should be the base price, before scaling for number of augs purchased
        const nfClone = new AugmentationData(augNf.name, nextNfRep, nextNfPrice, augNf.stats, augNf.prereqs); // { ...augNf };
        nfClone.displayName += ` Level ${nextNfLevel}`
        purchaseableAugs.push(nfClone);
        totalAugCost += nextNfCost;
        nextNfLevel++;
        nfPurchased++;
    }
    log(ns, `With ${formatMoney(budget)}, can afford to purchase ${nfPurchased} level${nfPurchased == 1 ? '' : 's'} of ${strNF}.` +
        ` New total cost: ${getCostString(totalAugCost, totalRepCost)}`);
    manageFilteredSubset(ns, outputRows, `(${purchaseableAugs.length - nfPurchased} Augs + ${nfPurchased} NF)`, purchaseableAugs, true, false, false);
    if (nextUpAug) outputRows.push(nextUpAug);
    if (nextUpNf) outputRows.push(nextUpNf);
};

/** @param {NS} ns
 * Purchase the desired augmentations */
async function purchaseDesiredAugs(ns) {
    installBatchTopUpStatus = [];
    if (bitNode == 8 && purchaseableAugs.some(aug => aug.name == strNF)) {
        purchaseableAugs = purchaseableAugs.filter(aug => aug.name != strNF);
        log(ns, `INFO: Removed ${strNF} from the purchase order because BN8 must not buy it.`, printToTerminal);
    }
    appendAffordableConcreteAugsForInstallBatch(ns);
    appendAffordableNeuroFluxForInstallBatch(ns);
    let [purchaseCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
    purchaseFactionRepCosts = purchaseCosts;
    if (purchaseableAugs.length == 0)
        return log(ns, `INFO: Cannot afford to buy any augmentations at this time.`, printToTerminal)
    const externalReservedCash = getReservedCash();
    const restoreExternalReserve = async () => {
        if (Number(ns.read("reserve.txt") || 0) != externalReservedCash)
            await ns.write("reserve.txt", externalReservedCash, "w");
    };
    // Refresh player data to get an accurate read of current money
    playerData = await getPlayerInfo(ns);
    let spendableMoney = Math.max(0, playerData.money - externalReservedCash);
    if (stockValue > 0 && totalAugCost + totalRepCost > spendableMoney) {
        const plannedCost = totalAugCost + totalRepCost;
        await ns.write("reserve.txt", Math.max(externalReservedCash, plannedCost), "w");
        await ns.write(stockmasterLiquidationPauseFile, String(Date.now() + stockLiquidationPauseMs), "w");
        const pid = ns.run(getFilePath('stockmaster.js'), 1, '--liquidate', '--kill-trader', '--liquidation-pause-ms', stockLiquidationPauseMs);
        if (!pid) {
            await restoreExternalReserve();
            return log(ns, `ERROR: Could not launch stockmaster.js --liquidate while holding stocks worth ${formatMoney(stockValue)}.`, printToTerminal, 'error');
        }
        log(ns, `INFO: Liquidating stocks worth ${formatMoney(stockValue)} before purchasing augmentations. ` +
            `Need ${getCostString(totalAugCost, totalRepCost)}, spendable cash ${formatMoney(spendableMoney)}.`, printToTerminal, 'info');
        while (ns.isRunning(pid))
            await ns.sleep(100);
        await ns.sleep(200);
        playerData = await getPlayerInfo(ns);
        stockValue = await getStocksValue(ns);
        spendableMoney = Math.max(0, playerData.money - externalReservedCash);
        if (plannedCost > spendableMoney && spendableMoney + stockValue >= plannedCost) {
            await restoreExternalReserve();
            return log(ns, `ERROR: Stock liquidation did not make enough cash available for augmentation purchase. ` +
                `Need ${getCostString(totalAugCost, totalRepCost)}, cash ${formatMoney(spendableMoney)}, ` +
                `stocks still ${formatMoney(stockValue)}. Refusing partial purchase.`, printToTerminal, 'error');
        }
    }
    while (purchaseableAugs.length > 0 && totalAugCost + totalRepCost > spendableMoney) {
        let augToDrop = getBudgetDropCandidate(purchaseableAugs);
        if (!augToDrop) {
            const prioritizedInOrder = getBudgetProtectedPriorityAugs(purchaseableAugs).filter(name => purchaseableAugs.some(a => a.name == name));
            if (prioritizedInOrder.length == 0) break;
            augToDrop = purchaseableAugs.find(a => a.name == prioritizedInOrder[prioritizedInOrder.length - 1]);
            log(ns, `WARNING: Post-liquidation budget is still too small, dropping lowest-priority priority aug "${augToDrop.name}".`, printToTerminal, 'warning');
        } else {
            log(ns, `INFO: Post-liquidation budget is smaller than the planned purchase order. Dropping lower-priority "${augToDrop.name}" and recalculating.`, printToTerminal, 'info');
        }
        purchaseableAugs = sortAugs(ns, purchaseableAugs.filter(aug => aug !== augToDrop));
        [purchaseFactionRepCosts, totalRepCost, totalAugCost] = computeCosts(purchaseableAugs);
        spendableMoney = Math.max(0, playerData.money - externalReservedCash);
    }
    if (purchaseableAugs.length == 0) {
        await restoreExternalReserve();
        return log(ns, `INFO: Cannot afford to buy any augmentations at this time.`, printToTerminal)
    }
    if (totalAugCost + totalRepCost > spendableMoney && totalAugCost + totalRepCost > spendableMoney * 1.1) {
        await restoreExternalReserve();
        return log(ns, `ERROR: Purchase order total cost (${getCostString(totalAugCost, totalRepCost)})` +
            ` is far more than current spendable player money (${formatMoney(spendableMoney)} of ${formatMoney(playerData.money)}). Your money may have recently changed (It was ${formatMoney(startingPlayerMoney)} at startup), ` +
            `or there may be a bug in purchasing logic.`, printToTerminal, 'error');
    }
    if (totalAugCost + totalRepCost > spendableMoney) {
        await restoreExternalReserve();
        return log(ns, `ERROR: Purchase order total cost (${getCostString(totalAugCost, totalRepCost)})` +
            ` is more than current spendable player money (${formatMoney(spendableMoney)} of ${formatMoney(playerData.money)}). ` +
            `Refusing partial augmentation purchase.`, printToTerminal, 'error');
    }
    if (Object.keys(purchaseFactionRepCosts).length > 0 && Object.values(purchaseFactionRepCosts).some(v => v > 0)) {
        const donations = Object.keys(purchaseFactionRepCosts).map(f => ({ faction: f, amount: purchaseFactionRepCosts[f] }));
        const donated = await getNsDataThroughFile(ns,
            'JSON.parse(ns.args[0]).reduce((success, o) => success && ns.singularity.donateToFaction(o.faction, o.amount), true)',
            '/Temp/facman-donate.txt', [JSON.stringify(donations)]);
        if (donated) {
            log(ns, `SUCCESS: Donated to ${donations.length} faction(s) to unlock augmentation reputation.`, printToTerminal, 'success');
            await updateFactionData(ns, options['ignore-faction'].map(f => f.replaceAll("_", " ")));
        } else {
            await restoreExternalReserve();
            return log(ns, `ERROR: One or more faction donations failed. Aborting augmentation purchase.`, printToTerminal, 'error');
        }
    }
    const beforePurchaseMoney = playerData.money;
    const beforePurchaseStocks = await getStocksValue(ns);
    const beforePurchaseNet = beforePurchaseMoney + beforePurchaseStocks;
    const plannedCost = totalAugCost + totalRepCost;
    // Purchase desired augs (using a ram-dodging script of course)
    const purchased = await getNsDataThroughFile(ns, 'JSON.parse(ns.args[0]).reduce((total, o) => total + (ns.singularity.purchaseAugmentation(o.faction, o.augmentation) ? 1 : 0), 0)',
        '/Temp/facman-purchase-augs.txt', [JSON.stringify(purchaseableAugs.map(aug => ({ faction: aug.getFromJoined(), augmentation: aug.name })))]);
    const afterPurchasePlayer = await getPlayerInfo(ns);
    const afterPurchaseStocks = await getStocksValue(ns);
    const afterPurchaseNet = afterPurchasePlayer.money + afterPurchaseStocks;
    await restoreExternalReserve();
    const nfCount = purchaseableAugs.filter(aug => aug.name == strNF).length;
    const nonNfNames = purchaseableAugs.filter(aug => aug.name != strNF).map(aug => aug.name);
    const batchSummary = [
        nonNfNames.length > 0 ? nonNfNames.join(", ") : null,
        nfCount > 0 ? `${strNF} x${nfCount}` : null,
    ].filter(Boolean).join("; ");
    devConsole('log', `[augs] bought ${purchased}/${purchaseableAugs.length}` +
        (batchSummary ? ` (${batchSummary})` : '') +
        `; spent ~${formatMoney(Math.max(0, beforePurchaseNet - afterPurchaseNet))}/${formatMoney(plannedCost)}` +
        `; left cash ${formatMoney(afterPurchasePlayer.money)}, stocks ${formatMoney(afterPurchaseStocks)}, net ${formatMoney(afterPurchaseNet)}` +
        (installBatchTopUpStatus.length > 0 ? `; top-up: ${installBatchTopUpStatus.join(" | ")}` : ''));
    if (purchased == purchaseableAugs.length)
        log(ns, `SUCCESS: Purchased ${purchased} desired augmentations in optimal order!`, printToTerminal, 'success')
    else
        log(ns, `ERROR: We were only able to purchase ${purchased} of our ${purchaseableAugs.length} augmentations. ` +
            `Expected cost was ${getCostString(totalAugCost, totalRepCost)}. Player money was ${formatMoney(playerData.money)} right before purchase, ` +
            `is now ${formatMoney(afterPurchasePlayer.money)}`, printToTerminal, 'error');
}

/** @param {NS} ns **/
function displayJoinedFactionSummary(ns) {
    let joinedFactions = Object.values(factionData).filter(f => f.joined);
    let summary = `${joinedFactions.length} Joined Factions:`
    let noaugs = joinedFactions.filter(f => f.unownedAugmentations().length == 0)
    if (noaugs.length > 0)
        summary += `\n  ${noaugs.length} joined factions have no unowned augs remaining: "${noaugs.map(f => f.name).join('", "')}"`;
    for (const faction of joinedFactions.filter(f => !noaugs.includes(f)))
        summary += `\n  ${faction.name}: ${faction.unownedAugmentations().length} augs remaining (${faction.unownedAugmentations().join(", ")})`;
    log(ns, summary, printToTerminal);
}

/** @param {NS} ns **/
function displayFactionSummary(ns, sortBy, unique, overrideFinishedFactions, excludedStats) {
    let noAugs = Object.values(factionData).filter(f => f.unownedAugmentations().length == 0);
    let summary = "";
    if (noAugs.length > 0)
        summary += `${noAugs.length} factions have no augmentations to purchase (excluding NF): ${JSON.stringify(noAugs.map(a => a.name))}\n`;
    let summaryFactions = Object.values(factionData).filter(f => f.unownedAugmentations().length > 0 && !overrideFinishedFactions.includes(f.name));
    if (summaryFactions.length == 0) return;
    // Apply any override faction options
    joinedFactions.push(...overrideFinishedFactions.filter(f => !joinedFactions.includes(f)));
    for (const faction of overrideFinishedFactions)
        simulatedOwnedAugmentations.push(...factionData[faction]?.unownedAugmentations() || []);
    // Grab disctinct augmentations stats
    const relevantAugStats = allAugStats.filter(s => !excludedStats.find(excl => s.includes(excl)) &&
        undefined !== summaryFactions.find(f => f.unownedAugmentations().find(aug => 1 != (augmentationData[aug].stats[s] || 1))));
    summary += `${summaryFactions.length} factions with augmentations (✓=Joined ✉=Invited ✗=Locked, sorted by total ${sortBy}):`;
    // Creates the table header row
    let getHeaderRow = countName => `\n   Faction Name ${countName.padStart(9)} / Total Augs ` + relevantAugStats.map(key => shorten(key).padStart(4)).join(' ');
    // Creates the string to display a single faction's stats in the table
    let getFactionSummary = faction => {
        const totalMults = faction.totalUnownedMults();
        return `\n ${faction.joined ? '✓' : faction.invited ? '✉' : '✗'} ${faction.name} `.padEnd(32) +
            `${String(faction.unownedAugmentations().length).padStart(2)} / ${String(faction.augmentations.length).padEnd(2)} ` +
            relevantAugStats.map(key => (totalMults[key] === undefined ? '-' : totalMults[key].toPrecision(3)).padStart(Math.max(shorten(key).length, 4))).join(' ');
    };
    // Helper to sort the factions in order of most-contributing to the desired multiplier
    let sortFunction = (a, b) => {
        let aMultiContrib = a.totalUnownedMults()[sortBy] || 1, bMultiContrib = b.totalUnownedMults()[sortBy] || 1;
        let sort1 = bMultiContrib - aMultiContrib; // Sort by the total amount of desired multi provided by this faction
        let sort2 = (a.joined ? 0 : 1) - (b.joined ? 0 : 1); // If tied, sort by which faction we've joined
        if (unique && bMultiContrib > 1 && aMultiContrib > 1 && sort2 != 0) return sort2; // When in "unique" mode it's important to first list contributing factions we've already joined
        if (sort1 != 0) return sort1;
        if (sort2 != 0) return sort2;
        let sort3 = b.reputation - a.reputation; // If tied, sort by which faction we have the most rep with
        if (sort3 != 0) return sort3;
        let sort4 = a.mostExpensiveAugCost().length - b.mostExpensiveAugCost().length; // If tied, "soonest to unlock", estimated by their most expensive aug cost
        if (sort4 != 0) return sort4;
        return (a.name).localeCompare(b.name) // If still tied, sort by naeme
    };
    // Helper to insert a table separator between factions that do and don't contribute to the specified stat
    let moreContributors = true;
    let getSeparator = faction => (moreContributors && !(moreContributors = faction.totalUnownedMults()[sortBy] !== undefined)) ?
        `\n---------------------------  (Factions below offer no augs that contribute to '${sortBy}')` : '';
    summary += getHeaderRow(unique ? 'New' : 'Unowned');
    const unownedAugCount = Object.values(augmentationData).length - simulatedOwnedAugmentations.length;
    if (!unique) // Each faction is summarized based on all the unowned augs it has, regardless of whether a faction higher up the list has the same augs
        for (const faction of summaryFactions.sort(sortFunction))
            summary += getSeparator(faction) + getFactionSummary(faction);
    else { // Each faction's stats computed as though the faction sorted above it was joined and bought out first, so only showing new augs
        const actualOwnedAugs = simulatedOwnedAugmentations;
        const actualUnjoinedFactions = summaryFactions;
        do {
            summaryFactions.sort(sortFunction);
            const faction = summaryFactions.shift();
            summary += getSeparator(faction) + getFactionSummary(faction);
            joinedFactions.push(faction.name);  // Simulate that we've now joined and bought out all this factions augs
            simulatedOwnedAugmentations.push(...faction.unownedAugmentations())
        } while (summaryFactions.length > 0)
        simulatedOwnedAugmentations = actualOwnedAugs; // Restore the original lists once the simulation is complete
        summaryFactions = actualUnjoinedFactions;
    }
    log(ns, `INFO: The following is a summary of ${unownedAugCount} remaining augmentations available from each faction:\n` + summary, printToTerminal);
}
