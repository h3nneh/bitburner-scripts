// Based on: https://github.com/66Ton99/bitburner-scripts/blob/main/daemon.js
import {
    formatMoney, formatRam, formatDuration,
    hashCode, disableLogs, log, getFilePath, getConfiguration,
    getNsDataThroughFile_Custom, runCommand_Custom, waitForProcessToComplete_Custom,
    tryGetBitNodeMultipliers_Custom, getActiveSourceFiles_Custom,
    getFnRunViaNsExec, tail, autoRetry, getErrorInfo, getStocksValue
} from './helpers.js'


// These parameters are meant to let you tweak the script's behaviour from the command line (without altering source code)
let options;
const argsSchema = [
    // Behaviour-changing flags
    ['spend-hashes-for-money-when-under', 10E6], // (Default 10m) Convert 4 hashes to money whenever we're below this amount
    ['disable-spend-hashes', false], // An easy way to set the above to a very large negative number, thus never spending hashes for Money

    ['xp-only', false], // Focus on a strategy that produces the most hack EXP rather than money
    ['share', undefined], // Enable sharing free RAM to boost faction rep gain (auto-enabled at 1TB network RAM)
    ['no-share', true], // Disable sharing free RAM to boost faction rep gain
    ['share-max-utilization', 0.8], // Share threads fill up to this fraction of total network RAM
    ['share-cooldown', 5000], // ms between share scheduling attempts
    ['money-focus', false], // Relay to hack.js to prioritize money and skip hack-XP kickstarts.
    ['initial-study-time', 10], // Seconds. Set to 0 to not do any studying at startup. By default, if early in an augmentation, will start with a little study to boost hack XP
    ['initial-hack-xp-time', 10], // Seconds. Set to 0 to not do any hack-xp grinding at startup. By default, if early in an augmentation, will start with a little study to boost hack XP

    ['reserved-ram', 32], // Keep this much home RAM free when scheduling hack/grow/weaken cycles on home.
    ['double-reserve-threshold', 512], // in GB of RAM. Double our home RAM reserve once there is this much home max RAM.

    ['tail-windows', false], // Open tail windows for helper scripts. Disabled by default; pass --tail-windows to opt in.
    ['tail-go', false], // Open a tail window for go.js when it is launched
    ['work-tail-x', -1], // Optional x position for the work-for-factions.js tail window.
    ['work-tail-y', -1], // Optional y position for the work-for-factions.js tail window.
    ['work-tail-width', -1], // Optional width for the work-for-factions.js tail window.
    ['work-tail-height', -1], // Optional height for the work-for-factions.js tail window.

    ['autopilot-mode', false], // Let daemon own background automation launches requested by autopilot.js.
    ['singularity-confirmed', false], // Autopilot already verified Singularity access; avoid source-file false negatives for automation gating.
    ['casino-complete', false], // Casino bootstrap is complete, so daemon may launch post-casino automation.
    ['cashroot-priority', false], // Prioritize Sector-12/CashRoot before generic faction/crime work.
    ['bn3-first-install', false], // Relay to work-for-factions that this is the first augmentation install in BN3.
    ['disable-casino', false], // Relay autopilot casino setting for helper args that protect casino seed money.
    ['disable-corporation', false], // Disable corporation automation launch in autopilot mode.
    ['disable-darknet', false], // Disable darknet automation launch in autopilot mode.
    ['disable-grafting', false], // Disable grafting automation launch in autopilot mode.
    ['disable-rush-gangs', false], // Disable rush-gang work-for-factions mode in autopilot mode.
    ['disable-bladeburner', false], // Relay autopilot bladeburner disablement to managed helpers.
    ['disable-puppet', false], // Use the legacy hack.js batcher instead of the default puppet.js (Sphyxis Puppet2) saturation batcher.
    ['cross-city-background-training', true], // Let work-for-factions start gym training in one city and then travel elsewhere for infiltration.
    ['disable-cross-city-background-training', false], // Disable cross-city background gym training.
    ['late-netburners', false], // Enable late-game Netburners/hacknet faction mode.
    ['late-company-work', false], // Enable late-game company faction work mode.
    ['force-stock-liquidate', false], // Autopilot requested a one-shot stock liquidation via stockmaster.js.
    ['stock-cash-frac', 0.1], // stockmaster --fracH in autopilot mode.
    ['stock-buy-frac', 0.4], // stockmaster --fracB in autopilot mode.
    ['bn10-sleeve-reserve', 0], // Reserve target for BN10 Covenant sleeves/memory.
    ['critical-home-ram-reserve', 0], // Extra home RAM to preserve for high-level orchestration helpers.
    ['time-before-boosting-best-hack-server', 900000], // Delay before spending hashes on the best hack-income server.
    ['spend-hashes-on-server-hacking-threshold', 0.1], // Minimum hack income rate to spend hashes boosting the best server.

    ['enable-hacknet-upgrade-manager', false], // By default, do not auto-launch hacknet-upgrade-manager.js from daemon/autopilot.
    ['disable-script', []], // The names of scripts that you do not want run by our scheduler
    ['run-script', []], // The names of additional scripts that you want daemon to run on home

    ['max-purchased-server-spend', 0.25], // Percentage of total hack income earnings we're willing to re-invest in new hosts (extra RAM in the current aug only)

    // Batch script fine-tuning flags
    ['initial-max-targets', undefined], // Initial number of servers to target / prep (default is 2 + 1 for every 500 TB of RAM on the network)
    ['cycle-timing-delay', 4000], // (ms) Length of a hack cycle. The smaller this is, the more batches (HWGW) we can schedule before the first cycle fires, but the greater the chance of a misfire
    ['queue-delay', 1000], // (ms) Delay before the first script begins, to give time for all scripts to be scheduled
    ['recovery-thread-padding', 1], // Multiply the number of grow/weaken threads needed by this amount to automatically recover more quickly from misfires.
    ['max-batches', 40], // Maximum overlapping cycles to schedule in advance. Note that once scheduled, we must wait for all batches to complete before we can schedule mor
    ['max-steal-percentage', 0.75], // Don't steal more than this in case something goes wrong with timing or scheduling, it's hard to recover frome

    ['looping-mode', false], // Set to true to attempt to schedule perpetually-looping tasks.

    // Special-situation flags
    ['i', false], // Farm intelligence with manual hack.

    // Debugging flags
    ['silent-misfires', false], // Instruct remote scripts not to alert when they misfire
    ['no-tail-windows', false], // Legacy explicit suppression flag. Tail windows are already disabled by default unless --tail-windows is passed.
    ['hack-only', false], // Do nothing but hack, no prepping (drains servers to 0 money, if you want to do that for some reason)
    ['verbose', false], // Detailed logs about batch scheduling / tuning
    ['run-once', false], // Good for debugging, run the main targeting loop once then stop, with some extra logs
];

const hackForwardedOptionNames = new Set([
    'xp-only', 'money-focus', 'initial-study-time', 'initial-hack-xp-time',
    'reserved-ram', 'double-reserve-threshold',
    'initial-max-targets', 'cycle-timing-delay', 'queue-delay', 'recovery-thread-padding',
    'max-batches', 'max-steal-percentage', 'looping-mode',
    'i', 'silent-misfires', 'no-tail-windows', 'hack-only', 'verbose', 'run-once',
]);

function getHackArgs(rawArgs) {
    const forwarded = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (typeof arg !== 'string' || !arg.startsWith('-'))
            continue;
        const optionName = arg.replace(/^-+/, '');
        if (!hackForwardedOptionNames.has(optionName))
            continue;
        forwarded.push(arg);
        if (i + 1 < rawArgs.length && (typeof rawArgs[i + 1] !== 'string' || !rawArgs[i + 1].startsWith('-')))
            forwarded.push(rawArgs[++i]);
    }
    return forwarded;
}

function setOrReplaceArg(args, flag, value) {
    const normalized = flag.startsWith("--") ? flag : `--${flag}`;
    const result = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] == normalized) {
            if (i + 1 < args.length && (typeof args[i + 1] !== 'string' || !args[i + 1].startsWith('-')))
                i++;
            continue;
        }
        result.push(args[i]);
    }
    result.push(normalized, value);
    return result;
}

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--disable-script" || lastFlag == "--run-script")
        return data.scripts;
    return [];
}

// script entry point
/** @param {NS} ns **/
export async function main(ns) {
    // --- CONSTANTS ---
    // The name given to purchased servers (should match what's in host-manager.js)
    const purchasedServersName = "daemon";
    // The name of the server to try running scripts on if home RAM is <= 16GB (early BN1)
    const backupServerName = 'harakiri-sushi'; // Somewhat arbitrarily chosen. It's one of several servers with 16GB which requires no open ports to crack.
    const corporationMinHomeRam = 4096;
    const corporationSelfFundingCost = 150e9;
    const darknetMinHomeRam = 8192;
    const helperBurstRam = {
        stats: 3.6,
        go: 20.2,
        contractor: 14.2,
        ramManager: 6.6,
        factionManager: 6.6,
        workForFactions: 16.6,
    };
    const helperReservePadding = 4;

    // --- VARS ---
    // DISCLAIMER: Take any values you see assigned here with a grain of salt. Due to oddities in how Bitburner runs scripts,
    // global state can be shared between multiple instances of the same script. As such, many of these values must
    // be reset in the main method of this script (and if they aren't it's likely to manifest as a bug.)

    let loopInterval = 1000; //ms
    // Allows some home ram to be reserved for ad-hoc terminal script running and when home is explicitly set as the "preferred server" for starting a helper
    let homeReservedRam = 0; // (Set in command line args)

    let allHostNames = (/**@returns {string[]}*/() => [])(); // simple name array of servers that have been discovered
    let _allServers = (/**@returns{Server[]}*/() => [])(); // Array of Server objects - our internal model of servers for hacking
    let homeServer = (/**@returns{Server}*/() => [])(); // Quick access to the home server object.
    // Lists of tools (external scripts) run
    let asynchronousHelpers, periodicScripts;
    let lastShareTime = 0; // Tracks when share was last scheduled so we can respect the configured share-cooldown
    let corporationLaunchGateStatus = null; // Cached result of getCorporationLaunchGateStatus
    let corporationLaunchGateStatusTime = 0; // When the above was last computed
    // Helper dict for remembering the names and costs of the scripts we use the most
    let toolsByShortName = (/**@returns{{[id: string]: Tool;}}*/() => undefined)(); // Dictionary of tools keyed by tool short name
    let allHelpersRunning = false; // Tracks whether all long-lived helper scripts have been launched
    let studying = false; // Whether we're currently studying
    let focusReservedUntil = 0; // While hack.js does initial study/XP, don't launch focus-stealing helpers.
    let openTailWindows = false;

    // Command line Flags
    let xpOnly = false; // --xp-only command line arg - focus on a strategy that produces the most hack EXP rather than money
    let verbose = false; // --verbose command line arg - Detailed logs about batch scheduling / tuning
    let runOnce = false; // --run-once command line arg - Good for debugging, run the main targeting loop once then stop
    let loopingMode = false;

    let daemonHost = null; // the name of the host of this daemon, so we don't have to call the function more than once.
    let dictSourceFiles = (/**@returns{{[bitNode: number]: number;}}*/() => undefined)(); // Available source files
    let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)();
    let bitNodeN = 1; // The bitnode we're in
    let haveTixApi = false, have4sApi = false; // Whether we have WSE API accesses
    let _cachedPlayerInfo = (/**@returns{Player}*/() => undefined)(); // stores multipliers for player abilities and other player info
    let moneySources = (/**@returns{MoneySources}*/() => undefined)(); // Cache of player income/expenses by category
    let playerInGang = false;

    // Property to avoid log churn if our status hasn't changed since the last loop
    let lastUpdate = "";
    let lastUpdateTime = Date.now();

    /** Ram-dodge getting updated player info.
     * @param {NS} ns
     * @returns {Promise<Player>} */
    async function getPlayerInfo(ns) {
        // return _cachedPlayerInfo = ns.getPlayer();
        return _cachedPlayerInfo = await getNsDataThroughFile(ns, `ns.getPlayer()`);
    }

    function playerHackSkill() { return _cachedPlayerInfo.skills.hacking; }

    /** @param {NS} ns
     * @returns {Promise<{ type: "COMPANY"|"FACTION"|"CLASS"|"CRIME", cyclesWorked: number, crimeType: string, classType: string, location: string, companyName: string, factionName: string, factionWorkType: string }>} */
    async function getCurrentWorkInfo(ns) {
        return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {};
    }

    /** Helper to check if a file exists.
     * A helper is used so that we have the option of exploring alternative implementations that cost less/no RAM.
     * @param {NS} ns
     * @returns {Promise<boolean>} */
    async function doesFileExist(ns, fileName, hostname = undefined) {
        // Fast (and free) - for local files, try to read the file and ensure it's not empty
        hostname ??= daemonHost;
        if (hostname === daemonHost && !fileName.endsWith('.exe'))
            return ns.read(fileName) != '';
        // return ns.fileExists(fileName, hostname);
        // TODO: If the approach below causes too much latency, we may wish to cease ram dodging and revert to the simple method above.
        const targetServer = getServerByName(hostname); // Each server object should have a cache of files on that server.
        if (!targetServer) // If the servers are not yet set up, use the fallback approach (filesExist)
            return await filesExist(ns, [fileName], hostname);
        return await targetServer.hasFile(fileName);
    }

    /** Helper to check which of a set of files exist on a remote server in a single batch ram-dodging request
     * @param {NS} ns
     * @param {string[]} fileNames
     * @returns {Promise<boolean[]>} */
    async function filesExist(ns, fileNames, hostname = undefined) {
        return await getNsDataThroughFile(ns, `ns.args.slice(1).map(f => ns.fileExists(f, ns.args[0]))`,
            '/Temp/files-exist.txt', [hostname ?? daemonHost, ...fileNames])
    }

    let psCache = (/**@returns{{[serverName: string]: ProcessInfo[];}}*/() => ({}))();
    /** PS can get expensive, and we use it a lot so we cache this for the duration of a loop
     * @param {NS} ns
     * @param {string} serverName
     * @returns {ProcessInfo[]} All processes running on this server. */
    function processList(ns, serverName, canUseCache = true) {
        let psResult = null;
        if (canUseCache)
            psResult = psCache[serverName];
        // Note: We experimented with ram-dodging `ps`, but there's so much data involed that serializing/deserializing generates a lot of latency
        //psResult ??= await getNsDataThroughFile(ns, 'ns.ps(ns.args[0])', null, [serverName]));
        psResult ??= psCache[serverName] = ns.ps(serverName);
        return psResult;
    }

    /** Get the players own money
     * @param {NS} ns
     * @returns {number} */
    function getPlayerMoney(ns) {
        return ns.getServerMoneyAvailable("home");
    }

    function getManagedHelperBurstReserve(ns) {
        const homeMaxRam = ns.getServerMaxRam("home");
        const requirements = [];
        if (homeMaxRam >= 64) {
            requirements.push(helperBurstRam.stats, helperBurstRam.contractor, helperBurstRam.ramManager);
            requirements.push(helperBurstRam.go);
        }
        if (options?.['singularity-confirmed'] || 4 in dictSourceFiles)
            requirements.push(helperBurstRam.factionManager, helperBurstRam.workForFactions);
        const largestBurst = Math.max(0, ...requirements);
        const practicalFloor = homeMaxRam >= 64 ? 32 : 0;
        return Math.max(practicalFloor, largestBurst + helperReservePadding);
    }

    function refreshHomeReservedRam(ns) {
        const homeMaxRam = ns.getServerMaxRam("home");
        const requestedReserve = Math.max(options?.['reserved-ram'] ?? 0, options?.['critical-home-ram-reserve'] ?? 0);
        homeReservedRam = Math.min(homeMaxRam, Math.max(requestedReserve, getManagedHelperBurstReserve(ns)));
    }

    function getManagedHackArgs(ns) {
        let args = getHackArgs(ns.args);
        args = setOrReplaceArg(args, "--reserved-ram", homeReservedRam);
        args = setOrReplaceArg(args, "--double-reserve-threshold", Number.MAX_SAFE_INTEGER);
        if (!openTailWindows && !args.includes("--no-tail-windows"))
            args.push("--no-tail-windows");
        return args;
    }

    // Default batcher is puppet.js (Sphyxis Puppet2 saturation batcher). Pass --disable-puppet to fall back to the legacy hack.js engine.
    function usePuppetBatcher() { return !options['disable-puppet']; }
    function getBatcherToolName() { return usePuppetBatcher() ? 'puppet.js' : 'hack.js'; }
    function getManagedBatcherArgs(ns) {
        if (!usePuppetBatcher()) return getManagedHackArgs(ns);
        // puppet.js owns hacking only; let daemon's host-manager handle server purchases. Run quiet unless tail windows are enabled.
        const args = []; //['nopurchase'];
        if (!openTailWindows) args.push('quiet');
        return args;
    }

    /** Returns the amount of money we should currently be reserving. Dynamically adapts to save money for a couple of big purchases on the horizon
     * @param {NS} ns
     * @returns {number} */
    function reservedMoney(ns) {
        let shouldReserve = Number(ns.read("reserve.txt") || 0);
        let playerMoney = getPlayerMoney(ns);
        // Conserve money if we get close to affording the last hack tool
        if (!ns.fileExists("SQLInject.exe", "home") && playerMoney > 200e6)
            shouldReserve += 250e6; // Start saving at 200m of the 250m required for SQLInject
        // Conserve money if we're close to being able to afford the Stock Market 4s API
        const fourSigmaCost = (bitNodeMults.FourSigmaMarketDataApiCost * 25000000000);
        if (!have4sApi && playerMoney >= fourSigmaCost / 2)
            shouldReserve += fourSigmaCost; // Start saving if we're half-way to buying 4S market access
        // Conserve money if we're in BN10 and nearing the cost of the last last sleeve
        if (bitNodeN == 10 && playerMoney >= 10e15) // 10q - 10% the cost of the last sleeve
            shouldReserve = 100e15; // 100q, the cost of the 6th sleeve from The Covenant
        return shouldReserve;
    }

    /** Returns the reserve to enforce for hacknet spending.
     * In late BN10 autopilot, allow a small bootstrap budget for hacknet without giving up the sleeve reserve entirely.
     * @param {NS} ns
     * @returns {number} */
    function hacknetReserve(ns) {
        const shouldReserve = reservedMoney(ns);
        if (!options?.['enable-hacknet-upgrade-manager'])
            return shouldReserve;
        if (bitNodeN == 10 && shouldReserve >= 100e15) {
            const playerMoney = getPlayerMoney(ns);
            const bootstrapBudget = Math.min(playerMoney * 0.01, 1e15); // Allow up to 1% of cash, capped at 1q, for late-game hacknet ramp-up
            return Math.max(0, shouldReserve - bootstrapBudget);
        }
        return shouldReserve;
    }

    /** @param {NS} ns **/
    async function startup(ns) {
        daemonHost = "home"; // ns.getHostname(); // get the name of this node (realistically, will always be home)
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions) return;

        // Ensure no other copies of this script are running (they share memory)
        const scriptName = ns.getScriptName();
        const competingDaemons = processList(ns, daemonHost, false /* Important! Don't use the (global shared) cache. */)
            .filter(s => s.filename == scriptName && s.pid != ns.pid);
        if (competingDaemons.length > 0) { // We expect only 1, due to this logic, but just in case, generalize the code below to support multiple.
            const daemonPids = competingDaemons.map(p => p.pid);
            log(ns, `Info: Killing another '${scriptName}' instance running on home (pid: ${daemonPids} args: ` +
                `[${competingDaemons[0].args.join(", ")}]) with new args ([${ns.args.join(", ")}])...`, true)
            const killPid = await killProcessIds(ns, daemonPids);
            await waitForProcessToComplete_Custom(ns, getHomeProcIsAlive(ns), killPid);
            await ns.sleep(loopInterval); // The game can be slow to kill scripts, give it an extra bit of time.
        }

        disableLogs(ns, ['getServerMaxRam', 'getServerUsedRam', 'getServerMoneyAvailable', 'getServerGrowth', 'getServerSecurityLevel', 'exec', 'scan', 'sleep']);
        // Reset global vars on startup since they persist in memory in certain situations (such as on Augmentation)
        // TODO: Can probably get rid of all of this now that the entire script is wrapped in the main function.
        lastUpdate = "";
        lastUpdateTime = Date.now();
        focusReservedUntil = 0;
        allHostNames = [], _allServers = [], homeServer = null;
        resetServerSortCache();
        psCache = {};

        // Process configuration
        options = runOptions;
        xpOnly = options['xp-only'] && !options['money-focus'];
        verbose = options['verbose'];
        runOnce = options['run-once'];
        loopingMode = options['looping-mode'];
        homeReservedRam = Math.max(options['reserved-ram'], options['critical-home-ram-reserve']);
        openTailWindows = options['tail-windows'] && !options['no-tail-windows'];
        if (ns.getServerMaxRam("home") <= 8) {
            const lowHomeHackArgs = setOrReplaceArg(
                setOrReplaceArg(getHackArgs(ns.args), "--reserved-ram", ns.getServerMaxRam("home")),
                "--double-reserve-threshold", Number.MAX_SAFE_INTEGER);
            if (!openTailWindows && !lowHomeHackArgs.includes("--no-tail-windows"))
                lowHomeHackArgs.push("--no-tail-windows");
            log(ns, `INFO: Home has only ${formatRam(ns.getServerMaxRam("home"))}. ` +
                `Spawning hack.js and exiting daemon.js before temp-helper startup scans.`, true, 'info');
            return ns.spawn(getFilePath('hack.js'), { threads: 1, spawnDelay: 100 }, ...lowHomeHackArgs);
        }

        // Get information about the player's current stats (also populates a cache)
        const playerInfo = await getPlayerInfo(ns);

        // Try to get "resetInfo", with a fallback for a failed dynamic call (i.e. low-ram conditions)
        let resetInfo;
        try {
            resetInfo = await getNsDataThroughFile(ns, `ns.getResetInfo()`);
        } catch {
            resetInfo = { currentNode: 1, lastAugReset: Date.now() };
        }
        bitNodeN = resetInfo.currentNode;
        dictSourceFiles = await getActiveSourceFiles_Custom(ns, getNsDataThroughFile);
        log(ns, "The following source files are active: " + JSON.stringify(dictSourceFiles));

        // Log which flags are active
        if (options['money-focus']) log(ns, '--money-focus - Money-focused hacking mode activated; daemon startup XP helpers are disabled.');
        if (xpOnly) log(ns, '--xp-only - Hack XP Grinding mode activated!');
        if (xpOnly && !options['no-share']) { options['no-share'] = true; log(ns, '--no-share implied by --xp-only'); }
        if (verbose) log(ns, '--verbose - Verbose logging activated!');
        if (runOnce) log(ns, '--run-once - Run-once mode activated!');
        if (loopingMode) {
            log(ns, '--looping-mode - scheduled remote tasks will loop themselves');
        }
        // These scripts are started once and expected to run forever (or terminate themselves when no longer needed)
        if (openTailWindows) log(ns, 'Opening tail windows for helper scripts (--tail-windows was enabled)');

        await establishMultipliers(ns); // figure out the various bitNode and player multipliers

        // Helper to determine whether we meed a given home RAM requirement (To avoid wasting precious early-BN RAM, many scripts don't launch unless we have more than a certain amount)
        const reqRam = (ram) => homeServer.totalRam(/*ignoreReservedRam:*/true) >= ram;
        // Helper to decide whether we should launch one of the hacknet upgrade manager scripts.
        const shouldUpgradeHacknet = () =>
            options['enable-hacknet-upgrade-manager'] &&
            bitNodeMults.HacknetNodeMoney > 0 && // Ensure hacknet is not disabled in this BN
            reqRam(Math.min(64, homeReservedRam + 6.1)) && // These scripts consume 6.1 GB and keep running a long time, so we want to ensure we have more than the home reservered RAM amount available if home reserved RAM is a small number
            getPlayerMoney(ns) > hacknetReserve(ns); // Player money exceeds the hacknet reserve (which may intentionally allow a small late-game bootstrap budget)
        if (options['enable-hacknet-upgrade-manager']) {
            const fullReserve = reservedMoney(ns);
            const effectiveReserve = hacknetReserve(ns);
            if (effectiveReserve < fullReserve)
                log(ns, `INFO: Late-game BN10 hacknet bootstrap is active. Preserving ${formatMoney(fullReserve)} overall, but allowing hacknet to spend down to ${formatMoney(effectiveReserve)}.`);
            else
                log(ns, `INFO: Hacknet upgrade manager is enabled. Current hacknet reserve is ${formatMoney(effectiveReserve)}.`);
        }

        function hasSingularityAccess() {
            return options['singularity-confirmed'] || 4 in dictSourceFiles;
        }

        function isMoneyFocusSpendingLocked() {
            return !!options['money-focus'];
        }

        function isMoneyFocusBlockedHelper(helper) {
            if (!isMoneyFocusSpendingLocked()) return false;
            const helperName = String(helper.name || '').split('/').pop();
            // cashroot-priority keeps work-for-factions running to grind Sector-12 rep
            if (helperName === 'work-for-factions.js' && options['cashroot-priority']) return false;
            return ['work-for-factions.js', 'go.js', 'gangs.js', 'sleeve.js', 'bladeburner.js',
                'graft-manager.js', 'darknet-manager.js', 'faction-manager.js', 'backdoor-all-servers.js']
                .includes(helperName);
        }

        function shouldBypassCorporationHomeRamGate() {
            return bitNodeN == 3;
        }

        function getEffectiveSf4Level() {
            if (bitNodeN == 4) return 3;
            return Math.max(0, dictSourceFiles[4] || (options['singularity-confirmed'] ? 3 : 0));
        }

        async function isPlayerInGang(ns) {
            if (playerInGang) return true;
            if (!(2 in dictSourceFiles)) return false;
            try {
                return playerInGang = await getNsDataThroughFile(ns, 'ns.gang.inGang()');
            } catch {
                return false;
            }
        }

        function shouldPrioritizeFactionWork() {
            return options['bn3-first-install'] || !!options['cashroot-priority'];
        }

        function shouldUseRushGangFactionMode() {
            return !shouldPrioritizeFactionWork() && !options['disable-rush-gangs'] && !playerInGang && 2 in dictSourceFiles;
        }

        async function getAutopilotStockmasterArgs() {
            if (options['force-stock-liquidate'])
                return ["--liquidate"];
            if (Number(options['bn10-sleeve-reserve']) > 0) {
                try {
                    const stockValue = await getStocksValue(ns);
                    const cash = getPlayerMoney(ns);
                    if (cash < options['bn10-sleeve-reserve'] && cash + stockValue >= options['bn10-sleeve-reserve'])
                        return ["--liquidate"];
                } catch { }
            }
            return ["--fracH", options['stock-cash-frac'], "--fracB", options['stock-buy-frac']];
        }

        function getAutopilotSleeveArgs() {
            const args = [];
            if (!options['disable-casino'] && !options['casino-complete'])
                args.push("--training-reserve", 300000);
            if (options['disable-bladeburner'])
                args.push("--disable-bladeburner");
            return args;
        }

        function getAutopilotGangArgs() {
            return bitNodeN == 8 ? ["--money-focus", "--reserve", 0, "--equipment-budget", 0, "--augmentations-budget", 0] : [];
        }

        function appendWorkTailArgs(args) {
            if (Number(options['work-tail-x']) >= 0) args.push("--tail-x", options['work-tail-x']);
            if (Number(options['work-tail-y']) >= 0) args.push("--tail-y", options['work-tail-y']);
            if (Number(options['work-tail-width']) > 0) args.push("--tail-width", options['work-tail-width']);
            if (Number(options['work-tail-height']) > 0) args.push("--tail-height", options['work-tail-height']);
            return args;
        }

        function getAutopilotWorkForFactionsArgs() {
            const args = ["--fast-crimes-only"];
            if (hasSingularityAccess()) args.push("--singularity-confirmed");
            if (!options['late-company-work']) args.push("--no-company-work");
            if (!options['late-netburners']) args.push("--skip", "Netburners");
            if (shouldPrioritizeFactionWork()) args.push("--first", "Sector-12");
            if (options['disable-bladeburner']) args.push("--no-bladeburner-check");
            if (options['cross-city-background-training'] && !options['disable-cross-city-background-training'])
                args.push("--cross-city-background-training");
            else
                args.push("--disable-cross-city-background-training");
            if (options['no-tail-windows']) args.push("--no-tail-windows");
            if (shouldUseRushGangFactionMode()) {
                args.push("--crime-focus", "--training-stat-per-multi-threshold", 200, "--prioritize-invites");
            }
            return appendWorkTailArgs(args);
        }

        function getAutopilotGraftArgs() {
            let graftReserve = Math.max(Number(options['bn10-sleeve-reserve']) || 0, Number(ns.read("reserve.txt") || 0));
            const args = ['--reserve', graftReserve];
            if (bitNodeN == 8) {
                graftReserve = Math.max(graftReserve, 100e9);
                args[1] = graftReserve;
                args.push('--bn8-stock-mode', '--allow-interrupt', '--min-net-worth', 250e9, '--max-spend-frac', 0.10, '--max-time', 60 * 60 * 1000);
            }
            return args;
        }

        async function shouldRunAutopilotGrafting(ns) {
            if (bitNodeN == 3) return false;
            if (bitNodeN == 8 && getPlayerMoney(ns) < 100e9) return false;
            try {
                return (await getCurrentWorkInfo(ns))?.type != "GRAFTING";
            } catch {
                return false;
            }
        }

        async function getCorporationLaunchGateStatus(ns) {
            if (Date.now() - corporationLaunchGateStatusTime < 60000) return corporationLaunchGateStatus;
            corporationLaunchGateStatusTime = Date.now();
            try {
                const hasCorp = await getNsDataThroughFile(ns, 'ns.corporation.hasCorporation()');
                corporationLaunchGateStatus = hasCorp ? 'running'
                    : (bitNodeN == 3 || getPlayerMoney(ns) >= corporationSelfFundingCost) ? 'ready' : 'waiting';
            } catch {
                corporationLaunchGateStatus = 'error';
            }
            return corporationLaunchGateStatus;
        }

        async function shouldRunCorporationAutomation(ns) {
            if (!options['casino-complete'] || options['disable-corporation']) return false;
            if (!(bitNodeN == 3 || (dictSourceFiles[3] ?? 0) >= 3)) return false;
            if (whichServerIsRunning(ns, 'corporation.js', false)[0] != null) return false;
            const launchGate = await getCorporationLaunchGateStatus(ns);
            if (launchGate === 'waiting') return false;
            if (!shouldBypassCorporationHomeRamGate() && !reqRam(corporationMinHomeRam)) return false;
            return hasFreeRamForScript(ns, getFilePath('corporation.js'), shouldBypassCorporationHomeRamGate());
        }

        function getAutopilotSpendHashesArgs() {
            if (!(9 in dictSourceFiles)) return null;
            if (Date.now() - resetInfo.lastAugReset < options['time-before-boosting-best-hack-server']) return null;
            if (0 == bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain) return null;
            const candidates = Object.values(dictServerProfitInfo || {})
                .filter(target => dictServerRequiredHackinglevels[target.hostname] <= playerHackSkill());
            if (candidates.length == 0) return null;
            const best = candidates.reduce((best, target) => target.gainRate > best.gainRate ? target : best, candidates[0]);
            const threshold = Number(options['spend-hashes-on-server-hacking-threshold']);
            if (best.gainRate <= threshold && bitNodeN != 9) return null;
            const args = ["--liquidate", "--spend-on-server", best.hostname, "--spend-on", "Increase_Maximum_Money"];
            if ((dictServerMinSecurityLevels?.[best.hostname] ?? 1) > 2)
                args.push("--spend-on", "Reduce_Minimum_Security");
            return args;
        }

        function hasFreeRamForScript(ns, scriptName, ignoreHomeReserve = false) {
            const scriptRam = ns.getScriptRam(scriptName, "home");
            if (!Number.isFinite(scriptRam) || scriptRam <= 0) return false;
            return getAllServers().some(server => server.hasRoot() &&
                server.ramAvailable(ignoreHomeReserve || server.name != "home") >= scriptRam);
        }

        // ASYNCHRONOUS HELPERS
        // Set up "asynchronous helpers" - standalone scripts to manage certain aspacts of the game. daemon.js launches each of these once when ready (but not again if they are shut down)
        const defaultStockmasterArgs = openTailWindows ? ["--show-market-summary"] : [];
        const defaultWorkForFactionsArgs = ['--fast-crimes-only', '--no-company-work'];
        if (options['cross-city-background-training'] && !options['disable-cross-city-background-training'])
            defaultWorkForFactionsArgs.push('--cross-city-background-training');
        else
            defaultWorkForFactionsArgs.push('--disable-cross-city-background-training');
        if (options['no-tail-windows']) defaultWorkForFactionsArgs.push('--no-tail-windows');
        appendWorkTailArgs(defaultWorkForFactionsArgs);
        refreshHomeReservedRam(ns);
        const isWorkForFactionsDisabled = () => options['disable-script'].some(disabled =>
            disabled == 'work-for-factions.js' || String(disabled).split('/').pop() == 'work-for-factions.js');
        const canRunWorkForFactionsAfterFocus = async () => !isWorkForFactionsDisabled() &&
            (!isMoneyFocusSpendingLocked() || options['cashroot-priority']) &&
            hasSingularityAccess() && (options['autopilot-mode'] ? options['casino-complete'] : true) &&
            reqRam(256 / (2 ** getEffectiveSf4Level()));
        const shouldRunWorkForFactions = async () => await canRunWorkForFactionsAfterFocus() && !studying;
        const isWorkForFactionsPending = async () => {
            const workHelper = asynchronousHelpers?.find(helper => String(helper.name).split('/').pop() == 'work-for-factions.js');
            if (workHelper?.isLaunched || whichServerIsRunning(ns, getFilePath('work-for-factions.js'), false)[0] != null)
                return false;
            return await canRunWorkForFactionsAfterFocus();
        };
        const workForFactionsHelper = {
            name: "work-for-factions.js",
            args: () => options['autopilot-mode'] ? getAutopilotWorkForFactionsArgs() : defaultWorkForFactionsArgs,  // Singularity script to manage how we use our "focus" work.
            shouldRun: shouldRunWorkForFactions,
            restartOnArgsChange: true,
            relaunchIfExited: true,
            cooldownMs: shouldPrioritizeFactionWork() ? 60 * 1000 : 5 * 60 * 1000,
            ignoreReservedRam: shouldPrioritizeFactionWork(),
        };
        asynchronousHelpers = [
            ...(shouldPrioritizeFactionWork() ? [workForFactionsHelper] : []),
            { name: getBatcherToolName(), args: () => getManagedBatcherArgs(ns), shouldTail: false, restartOnArgsChange: true, relaunchIfExited: true, ignoreReservedRam: false }, // Dedicated hacking/prep/targeting runner (puppet.js by default, hack.js with --disable-puppet).
            { name: "stats.js", shouldRun: () => reqRam(64), shouldTail: false }, // Adds stats not usually in the HUD (nice to have)
            ...(!shouldPrioritizeFactionWork() ? [workForFactionsHelper] : []),
            { name: "go.js", shouldRun: async () => !isMoneyFocusSpendingLocked() && !(await isWorkForFactionsPending()) && reqRam(64) && homeServer.ramAvailable(/*ignoreReservedRam:*/true) >= 20, minRamReq: 20.2, shouldTail: options['tail-go'] }, // Play go.js (various multipliers, but large dynamic ram requirements)
            {
                name: "stockmaster.js",
                shouldRun: () => options['autopilot-mode'] ? options['casino-complete'] && reqRam(32) : reqRam(64),
                args: () => options['autopilot-mode'] ? getAutopilotStockmasterArgs() : defaultStockmasterArgs,
                restartOnArgsChange: true,
                relaunchIfExited: true,
                ignoreReservedRam: false,
            }, // Start our stockmaster
            {
                name: "money-infiltration.js",
                shouldRun: () => options['money-focus'] && (options['autopilot-mode'] ? options['casino-complete'] : true) &&
                    whichServerIsRunning(ns, getFilePath('infiltration-runner.js'), false)[0] == null &&
                    reqRam(64),
                restartOnArgsChange: true,
                relaunchIfExited: true,
                cooldownMs: 30 * 1000,
                ignoreReservedRam: false,
            },
            {
                name: "crime.js",
                shouldRun: () => options['money-focus'] && bitNodeN == 3 && !options['cashroot-priority'] && (options['autopilot-mode'] ? options['casino-complete'] : true) && reqRam(64),
                args: () => ["--fast-crimes-only"],
                relaunchIfExited: false,
                ignoreReservedRam: false,
            },
            { name: "hacknet-upgrade-manager.js", shouldRun: () => shouldUpgradeHacknet(), args: () => ["--continuous", "--max-payoff-time", "1h", "--interval", "0", "--reserve", hacknetReserve(ns)], shouldTail: false }, // One-time kickstart of hash income by buying everything with up to 1h payoff time immediately
            {
                name: "spend-hacknet-hashes.js",
                shouldRun: () => options['autopilot-mode'] ? getAutopilotSpendHashesArgs() != null : reqRam(64) && 9 in dictSourceFiles,
                args: () => options['autopilot-mode'] ? getAutopilotSpendHashesArgs() : [],
                restartOnArgsChange: true,
                relaunchIfExited: true,
                shouldTail: false,
            }, // Always have this running to make sure hashes aren't wasted
            {
                name: "sleeve.js",
                shouldRun: () => !isMoneyFocusSpendingLocked() && (options['autopilot-mode'] ? options['casino-complete'] && reqRam(64) && 10 in dictSourceFiles && 2 in dictSourceFiles : reqRam(64) && 10 in dictSourceFiles),
                args: () => options['autopilot-mode'] ? getAutopilotSleeveArgs() : [],
                restartOnArgsChange: true,
                ignoreReservedRam: false,
            }, // Script to create manage our sleeves for us
            {
                name: "gangs.js",
                shouldRun: async () => !isMoneyFocusSpendingLocked() && !(await isWorkForFactionsPending()) &&
                    (options['autopilot-mode'] ? options['casino-complete'] && reqRam(64) && 2 in dictSourceFiles && await isPlayerInGang(ns) : reqRam(64) && 2 in dictSourceFiles),
                args: () => options['autopilot-mode'] ? getAutopilotGangArgs() : [],
                restartOnArgsChange: true,
                shouldTail: false,
                ignoreReservedRam: false,
            }, // Script to create manage our gang for us
            {
                name: "bladeburner.js", // Script to manage bladeburner for us. Run automatically if not disabled and bladeburner API is available
                shouldRun: () => !isMoneyFocusSpendingLocked() && !options['disable-bladeburner'] && !options['disable-script'].includes('bladeburner.js') && reqRam(64)
                    && 7 in dictSourceFiles && bitNodeMults.BladeburnerRank != 0, // Don't run bladeburner in BN's where it can't rank up (currently just BN8)
                shouldTail: true,
                tailLayout: "work",
            },
        ];
        asynchronousHelpers = asynchronousHelpers.filter(helper => !isMoneyFocusBlockedHelper(helper));
        if (options['autopilot-mode']) {
            asynchronousHelpers.push(
                {
                    name: "run-corporation.js",
                    args: () => !openTailWindows ? ['--no-tail-windows'] : [],
                    shouldRun: async () => await shouldRunCorporationAutomation(ns),
                    cooldownMs: 60 * 1000,
                    relaunchIfExited: true,
                    ignoreReservedRam: shouldBypassCorporationHomeRamGate(),
                },
                {
                    name: "Tasks/darknet-manager.js",
                    args: () => !openTailWindows ? ['--no-tail-windows'] : [],
                    shouldRun: () => !isMoneyFocusSpendingLocked() && options['casino-complete'] && !options['disable-darknet'] && reqRam(darknetMinHomeRam),
                    cooldownMs: 60 * 1000,
                    ignoreReservedRam: false,
                },
                {
                    name: "graft-manager.js",
                    args: () => getAutopilotGraftArgs(),
                    shouldRun: async () => !isMoneyFocusSpendingLocked() && options['casino-complete'] && !options['disable-grafting'] &&
                        (bitNodeN == 10 || 10 in dictSourceFiles) && await shouldRunAutopilotGrafting(ns),
                    restartOnArgsChange: true,
                    cooldownMs: 60 * 1000,
                    ignoreReservedRam: false,
                },
            );
            asynchronousHelpers = asynchronousHelpers.filter(helper => !isMoneyFocusBlockedHelper(helper));
        }
        // Add any additional scripts to be run provided by --run-script arguments
        options['run-script'].forEach(s => asynchronousHelpers.push({ name: s }));
        // Set these helper functions to not be marked as "temporary" when they are run (save their execution state)
        asynchronousHelpers.forEach(helper => helper.runOptions = { temporary: false });
        asynchronousHelpers.forEach(helper => helper.isLaunched = false);
        asynchronousHelpers.forEach(helper => helper.ignoreReservedRam ??= false);
        if (openTailWindows) // Tools should be tailed unless they explicitly opted out in the config above
            asynchronousHelpers.forEach(helper => helper.shouldTail ??= true);

        // PERIODIC SCRIPTS
        // These scripts are spawned periodically (at some interval) to do their checks, with an optional condition that limits when they should be spawned
        // Note: Periodic script are generally run every 30 seconds, but intervals are spaced out to ensure they aren't all bursting into temporary RAM at the same time.
        periodicScripts = [
            // Buy tor as soon as we can if we haven't already, and all the port crackers
            { interval: 25000, name: "/Tasks/tor-manager.js", shouldRun: () => 4 in dictSourceFiles && !allHostNames.includes("darkweb") },
            { interval: 26000, name: "/Tasks/program-manager.js", shouldRun: () => 4 in dictSourceFiles && !ns.fileExists("SQLInject.exe", "home") },
            { interval: 27000, name: "/Tasks/contractor.js", minRamReq: 14.2 }, // Periodically look for coding contracts that need solving
            // Buy every hacknet upgrade with up to 4h payoff if it is less than 10% of our current money or 8h if it is less than 1% of our current money.
            { interval: 28000, name: "hacknet-upgrade-manager.js", shouldRun: shouldUpgradeHacknet, args: () => ["--continuous", "--max-payoff-time", "4h", "--max-spend", getPlayerMoney(ns) * 0.1, "--reserve", hacknetReserve(ns)] },
            { interval: 28500, name: "hacknet-upgrade-manager.js", shouldRun: shouldUpgradeHacknet, args: () => ["--continuous", "--max-payoff-time", "8h", "--max-spend", getPlayerMoney(ns) * 0.01, "--reserve", hacknetReserve(ns)] },
            // Buy upgrades regardless of payoff if they cost less than 0.1% of our money
            { interval: 29000, name: "hacknet-upgrade-manager.js", shouldRun: shouldUpgradeHacknet, args: () => ["--continuous", "--max-payoff-time", "1E100h", "--max-spend", getPlayerMoney(ns) * 0.001, "--reserve", hacknetReserve(ns)] },
            {   // Spend about 50% of un-reserved cash on home RAM upgrades (permanent) when they become available
                interval: 30000, name: "/Tasks/ram-manager.js", args: () => {
                    const bn3Bootstrap = bitNodeN == 3;
                    return ['--budget', bn3Bootstrap ? 1 : 0.5, '--reserve', bn3Bootstrap ? 0 : reservedMoney(ns)];
                },
                shouldRun: () => 4 in dictSourceFiles && shouldImproveHacking()
            },
            {   // Periodically check for new faction invites and join if deemed useful to be in that faction. Also determines how many augs we could afford if we installed right now
                interval: 31000, name: "faction-manager.js", args: ['--verbose', 'false'],
                // Don't start auto-joining factions until we're holding 1 billion (so coding contracts returning money is probably less critical) or we've joined one already
                shouldRun: () => !isMoneyFocusSpendingLocked() && 4 in dictSourceFiles && (_cachedPlayerInfo.factions.length > 0 || getPlayerMoney(ns) > 1e9) &&
                    reqRam(128 / (2 ** dictSourceFiles[4])) // Uses singularity functions, and higher SF4 levels result in lower RAM requirements
            },
            {   // Periodically look to purchase new servers, but note that these are often not a great use of our money (hack income isn't everything) so we may hold-back.
                interval: 32000, name: "host-manager.js", minRamReq: 6.55,
                // Restrict spending on new servers (i.e. temporary RAM for the current augmentation only) to be a % of total earned hack income.
                shouldRun: () => false && shouldImproveHacking() && getHostManagerBudget() > 0,
                args: () => ['--budget', getHostManagerBudget(), '--absolute-reserve', reservedMoney(ns),
                    // Mechanic to reserve more of our money the longer we've been in the BN. Starts at 0%, after 24h we should be reserving 92%.
                    '--reserve-by-time', true, '--reserve-by-time-decay-factor', 0.1, '--reserve-percent', 0,
                    '--utilization-trigger', '0'], // Disable utilization-based restrictions on purchasing RAM
            },
            // Check if any new servers can be backdoored. If there are many, this can eat up a lot of RAM, so make this the last script scheduled at startup.
            { interval: 33000, name: "/Tasks/backdoor-all-servers.js", shouldRun: () => !isMoneyFocusSpendingLocked() && 4 in dictSourceFiles && playerHackSkill() > 10 }, // Don't do this until we reach hack level 10. If we backdoor too early, it's very slow and eats up RAM for a long time,
        ];
        periodicScripts.forEach(tool => tool.ignoreReservedRam ??= false);
        if (verbose) // In verbose mode, have periodic sripts persist their logs.
            periodicScripts.forEach(tool => tool.runOptions = { temporary: false });
        await buildToolkit(ns, [...asynchronousHelpers, ...periodicScripts,
            { name: "/Remote/share.js", shortName: "share", threadSpreadingAllowed: true }]); // build launcher toolkit
        await buildServerList(ns, false); // create the exhaustive server list

        // If we ascended less than 10 minutes ago, start with some study and/or XP cycles to quickly restore hack XP
        const timeSinceLastAug = Date.now() - resetInfo.lastAugReset;
        const shouldKickstartHackXp = !usePuppetBatcher() && !options['money-focus'] && (playerHackSkill() < 500 && timeSinceLastAug < 600000 && reqRam(16)); // RamReq ensures we don't attempt this in BN1.1 (puppet.js has no study/XP kickstart)
        studying = shouldKickstartHackXp ? true : false; // Flag will be used to prevent focus-stealing scripts from running until hack.js is done studying.
        if (studying)
            focusReservedUntil = Date.now() + 5000 + 1000 * (options['initial-study-time'] + options['initial-hack-xp-time']);

        if (shouldKickstartHackXp) {
            log(ns, `INFO: ${getFilePath('hack.js')} will handle initial study/hack-XP kickstart.`);
        }

        await doDaemonOrchestrationLoop(ns);
    }

    /** Periodic scripts helper function: In bitnodes with hack income disabled, don't waste money on improving hacking infrastructure */
    function shouldImproveHacking() {
        return 0 != (bitNodeMults.ScriptHackMoneyGain * bitNodeMults.ScriptHackMoney) || // Check for disabled hack-income
            getPlayerMoney(ns) > 1e12 || // If we have sufficient money, we may consider improving hack infrastructure (to earn hack exp more quickly)
            bitNodeN === 8 // The exception is in BN8, we still want lots of hacking to take place to manipulate stocks, which requires this infrastructure (TODO: Strike a balance between spending on this stuff and leaving money for stockmaster.js)
    }

    /** Periodic scripts helper function: Get how much we're willing to spend on new servers (host-manager.js budget) */
    function getHostManagerBudget() {
        const serverSpend = -(moneySources?.sinceInstall?.servers ?? 0); // This is given as a negative number (profit), we invert it to get it as a positive expense amount
        const budget = Math.max(0,
            // Ensure the total amount of money spent on new servers is less than the configured max spend amount
            options['max-purchased-server-spend'] * (moneySources?.sinceInstall?.hacking ?? 0) - serverSpend,
            // Special-case support: In some BNs hack income is severely penalized (or zero) but earning hack exp is still useful.
            // To support these, always allow a small percentage (0.1%) of our total earnings (including other income sources) to be spent on servers
            (moneySources?.sinceInstall?.total ?? 0) * 0.001 - serverSpend);
        //log(ns, `Math.max(0, ${options['max-purchased-server-spend']} * (${formatMoney(moneySources?.sinceInstall?.hacking)} ?? 0) - ${formatMoney(serverSpend)}, ` +
        //    `(${formatMoney(moneySources?.sinceInstall?.total)} ?? 0) * 0.001 - ${formatMoney(serverSpend)}) = ${formatMoney(budget)}`);
        return budget;
    }

    /** Check running status of scripts on servers
     * @param {NS} ns
     * @param {string} scriptName
     * @returns {[string, pid]} */
    function whichServerIsRunning(ns, scriptName, canUseCache = true) {
        for (const server of getAllServers()) {
            const psList = processList(ns, server.name, canUseCache);
            const matches = psList.filter(p => p.filename == scriptName);
            if (matches.length >= 1)
                return [server.name, matches[0].pid];
        }
        return [null, null];
    }

    /** Helper to kick off external scripts
     * @param {NS} ns
     * @returns {Promise<boolean>} true if all scripts have been launched */
    async function runStartupScripts(ns) {
        let launched = 0;
        for (const script of asynchronousHelpers) {
            if (script.relaunchIfExited && whichServerIsRunning(ns, script.name, false)[0] == null)
                script.isLaunched = false;
            if (script.isLaunched) continue;
            if (!(await tryRunTool(ns, getTool(script))))
                continue; // We may have chosen not to run the script for a number of reasons. Proceed to the next one.
            if (++launched > 1) await ns.sleep(1); // If we successfully launch more than 1 script at a time, yeild execution a moment to give them a chance to complete, so many aren't all fighting for temp RAM at the same time.
            script.isLaunched = true;
        }
        // if every helper is launched already return "true" so we can skip doing this each cycle going forward.
        return asynchronousHelpers.reduce((allLaunched, tool) => allLaunched && tool.isLaunched, true);
    }

    /** Checks whether it's time for any scheduled tasks to run
     * @param {NS} ns */
    async function runPeriodicScripts(ns) {
        let launched = 0;
        for (const script of periodicScripts) {
            // Only run this tool if it's been more than <task.interval> milliseconds since it was last run
            const timeSinceLastRun = Date.now() - (script.lastRun || 0);
            if (timeSinceLastRun <= script.interval) continue;
            script.lastRun = Date.now(); // Update the last run date whether we successfully ran it or not           
            if (await tryRunTool(ns, getTool(script))) // Try to run the task
                if (++launched > 1) await ns.sleep(1); // If we successfully launch more than 1 script at a time, yeild execution a moment to give them a chance to complete, so many aren't all fighting for temp RAM at the same time.
        }

        // Hack: this doesn't really belong here, but is essentially a "temp script" we periodically run when needed
        // Super-early aug, if we are poor, spend hashes as soon as we get them for a quick cash injection. (Only applies if we have hacknet servers)
        if (9 in dictSourceFiles && !options['disable-spend-hashes']) { // See if we have a hacknet, and spending hashes for money isn't disabled
            if (homeServer.getMoney() < options['spend-hashes-for-money-when-under'] // Only if money is below the configured threshold
                && homeServer.ramAvailable(/*ignoreReservedRam:*/true) >= 5.6) { // Ensure we have spare RAM to run this temp script
                await runCommand(ns, `0; if(ns.hacknet.spendHashes("Sell for Money")) ns.toast('Sold 4 hashes for \$1M', 'success')`, '/Temp/sell-hashes-for-money.js');
            }
        }
    }

    // Helper that gets the either invokes a function that returns a value, or returns the value as-is if it is not a function.
    const funcResultOrValue = fnOrVal => (fnOrVal instanceof Function ? fnOrVal() : fnOrVal);
        const scriptBaseName = script => String(script || "").split('/').pop();
        const isScriptDisabled = script => options['disable-script'].some(disabled =>
            disabled == script || scriptBaseName(disabled) == scriptBaseName(script));
        const argsEqual = (a = [], b = []) => a.length == b.length && a.every((value, index) => String(value) == String(b[index]));
        const hasHomeRamAfterLaunch = tool => tool.ignoreReservedRam ||
            homeServer.totalRam(true) < 32 ||
            (homeServer.ramAvailable(true) - tool.cost) >= homeReservedRam;

    /** Returns true if the tool is running (including if it was already running), false if it could not be run.
     * @param {NS} ns
     * @param {Tool} tool */
    async function tryRunTool(ns, tool) {
        if (isScriptDisabled(tool.name)) { // Ensure the script hasn't been disabled
            if (verbose) log(ns, `Tool ${tool.name} was not launched as it was specified with --disable-script`);
            return false;
        }
        if (tool.shouldRun != null && !(await tool.shouldRun())) { // Check the script's own conditions for being run
            if (verbose) log(ns, `INFO: Tool ${tool.name} was not launched as its shouldRun() function returned false.`);
            return false;
        }
        if (!(await doesFileExist(ns, tool.name))) { // Ensure the script exists
            log(ns, `ERROR: Tool ${tool.name} was not found on ${daemonHost}`, true, 'error');
            return false;
        }
        const args = await funcResultOrValue(tool.args) || []; // Support either a static args array, or a function returning the args.
        let [runningOnServer, runningPid] = whichServerIsRunning(ns, tool.name, false);
        if (runningOnServer != null) { // Ensure the script isn't already running
            const runningProcess = processList(ns, runningOnServer, false).find(process => process.pid == runningPid);
            if (tool.restartOnArgsChange && runningProcess && !argsEqual(runningProcess.args, args)) {
                log(ns, `INFO: Restarting ${tool.name} with updated args [${args.join(", ")}].`, false, 'info');
                ns.kill(runningPid);
                await ns.sleep(50);
            } else {
                if (verbose) log(ns, `INFO: Tool ${tool.name} is already running on server ${runningOnServer} as pid ${runningPid}.`);
                tailToolIfNeeded(ns, tool, runningPid);
                return true;
            }
        }
        if (tool.cooldownMs && Date.now() - tool.lastLaunchAttempt < tool.cooldownMs) {
            if (verbose) log(ns, `INFO: Tool ${tool.name} was not launched because it is within its ${formatDuration(tool.cooldownMs)} launch cooldown.`);
            return false;
        }
        // If all criteria pass, launch the script on home, or wherever we have space for it.
        tool.lastLaunchAttempt = Date.now();
        const lowHomeRam = homeServer.totalRam(true) < 32; // Special-case. In early BN1.1, when home RAM is <32 GB, allow certain scripts to be run on any host
        if (!lowHomeRam && !hasHomeRamAfterLaunch(tool)) {
            if (verbose)
                log(ns, `INFO: Tool ${tool.name} was not launched because daemon is preserving ${formatRam(homeReservedRam)} home RAM.`);
            return false;
        }
        const runResult = lowHomeRam ?
            (await arbitraryExecution(ns, tool, 1, args, getServerByName(backupServerName).hasRoot() ? backupServerName : daemonHost)) :
            (await exec(ns, tool.name, daemonHost, tool.runOptions, ...args));
        if (runResult) {
            [runningOnServer, runningPid] = whichServerIsRunning(ns, tool.name, false);
            if (verbose)
                log(ns, `INFO: Ran tool: ${tool.name} ` + (args.length > 0 ? `with args ${JSON.stringify(args)} ` : '') +
                    (runningPid ? `on server ${runningOnServer} (pid ${runningPid}).` : 'but it shut down right away.'));
            tailToolIfNeeded(ns, tool, runningPid);
            return true;
        } else {
            const errHost = getServerByName(daemonHost);
            log(ns, `WARN: Tool could not be run on ${lowHomeRam ? "any host" : errHost} at this time (likely due to insufficient RAM. Requires: ${formatRam(tool.cost)} ` +
                (lowHomeRam ? '' : `FREE: ${formatRam(errHost.ramAvailable(/*ignoreReservedRam:*/true))})`) + `: ${tool.name} [${args}]`, false, lowHomeRam ? undefined : 'warning');
        }
        return false;
    }

    /** Wrapper for ns.exec which automatically retries if there is a failure.
     * @param {NS} ns
     * @param {string} script - Filename of script to execute.
     * @param {string?} hostname - Hostname of the target server on which to execute the script.
     * @param {number|RunOptions?} numThreadsOrOptions - Optional thread count or RunOptions. Default is { threads: 1, temporary: true }
     * @param {any} args - Additional arguments to pass into the new script that is being run. Note that if any arguments are being passed into the new script, then the third argument numThreads must be filled in with a value.
     * @returns — Returns the PID of a successfully started script, and 0 otherwise.
     * Workaround a current bitburner bug by yeilding briefly to the game after executing something. **/
    async function exec(ns, script, hostname = null, numThreadsOrOptions = null, ...args) {
        // Defaults
        hostname ??= daemonHost;
        numThreadsOrOptions ??= { threads: 1, temporary: true };
        let fnRunScript = () => ns.exec(script, hostname, numThreadsOrOptions, ...args);
        // Wrap the script execution in an auto-retry to handle e.g. temporary ram issues.
        let p;
        const pid = await autoRetry(ns, async () => {
            p = fnRunScript();
            return p;
        }, p => {
            if (p == 0) log(ns, `WARNING: pid = ${p} after trying to exec ${script} on ${hostname}. Trying again...`, false, "warning");
            return p !== 0;
        }, () => new Error(`Failed to exec ${script} on ${hostname}. ` +
            `This is likely due to having insufficient RAM.\nArgs were: [${args}]`),
            undefined, undefined, undefined, verbose, verbose);
        return pid; // Caller is responsible for handling errors if final pid returned is 0 (indicating failure)
    }

    function applyToolTailLayout(ns, tool, pid) {
        if (tool.tailLayout != "work") return;
        const width = Number(options['work-tail-width']);
        const height = Number(options['work-tail-height']);
        const x = Number(options['work-tail-x']);
        const y = Number(options['work-tail-y']);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
            ns.ui.resizeTail(width, height, pid);
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0)
            ns.ui.moveTail(x, y, pid);
    }

    function tailToolIfNeeded(ns, tool, pid) {
        if (!tool.shouldTail || !pid || pid === tool.lastTailedPid) return;
        tool.lastTailedPid = pid;
        log(ns, `Tailing Tool: ${tool.name} (pid ${pid})`);
        tail(ns, pid);
        if (tool.tailLayout) applyToolTailLayout(ns, tool, pid);
    }

    // Daemon orchestration loop. Hacking/prep/targeting is handled by hack.js.
    /** @param {NS} ns **/
    async function doDaemonOrchestrationLoop(ns) {
        let loops = -1;
        do {
            loops++;
            if (loops > 0) await ns.sleep(loopInterval);
            psCache = {};
            await buildServerList(ns, true);
            await updateCachedServerData(ns);
            refreshHomeReservedRam(ns);
            await getPlayerInfo(ns);
            if (studying && Date.now() >= focusReservedUntil)
                studying = false;
            const hackRunner = asynchronousHelpers.find(tool => scriptBaseName(tool.name) == getBatcherToolName());
            if (hackRunner && !whichServerIsRunning(ns, hackRunner.name, false)[0]) {
                hackRunner.isLaunched = false;
                allHelpersRunning = false;
            }
            if (!allHelpersRunning || loops % 60 == 0)
                allHelpersRunning = await runStartupScripts(ns);
            await runPeriodicScripts(ns);
            // Share unused RAM to boost faction rep gain
            if (!options['no-share'] && (options['share'] === true || getNetworkStats().totalMaxRam > 1024) &&
                    (Date.now() - lastShareTime) > options['share-cooldown']) {
                const network = getNetworkStats();
                const utilizationPercent = network.totalUsedRam / network.totalMaxRam;
                const maxShareUtilization = options['share-max-utilization'];
                if (utilizationPercent < maxShareUtilization) {
                    const shareTool = getTool('share');
                    const maxThreads = shareTool.getMaxThreads();
                    const shareThreads = Math.floor(maxThreads * (maxShareUtilization - utilizationPercent) / (1 - utilizationPercent));
                    if (shareThreads > 0) {
                        if (verbose) log(ns, `Scheduling ${shareThreads.toLocaleString('en')} share threads (utilization ${(100 * utilizationPercent).toFixed(1)}% → ${(100 * maxShareUtilization).toFixed(1)}% target)`);
                        await arbitraryExecution(ns, shareTool, shareThreads, [Date.now()], null, true);
                        lastShareTime = Date.now();
                    }
                }
            }
        } while (!runOnce);
    }

    // Get a dictionary from retrieving the same infromation for every server name
    async function getServersDict(ns, command) {
        return await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(server => [server, ns.${command}(server)]))`,
            `/Temp/${command}-all.txt`, allHostNames);
    }

    let dictServerRequiredHackinglevels = (/**@returns{{[serverName: string]: number;}}*/() => undefined)();
    let dictServerMinSecurityLevels = (/**@returns{{[serverName: string]: number;}}*/() => undefined)();
    let dictServerMaxRam = (/**@returns{{[serverName: string]: number;}}*/() => undefined)();
    let dictServerProfitInfo = (/**@returns{{[serverName: string]: {gainRate: number, expRate: number}}}*/() => undefined)();

    /** Gathers up arrays of server data via external request to have the data written to disk.
     * This data should only need to be gathered once per run, as it never changes
     * @param {NS} ns */
    async function getStaticServerData(ns) {
        if (verbose) log(ns, `getStaticServerData: ${allHostNames}`);
        dictServerRequiredHackinglevels = await getServersDict(ns, 'getServerRequiredHackingLevel');
        // Also immediately retrieve the data which is occasionally updated
        await updateCachedServerData(ns);
        await refreshDynamicServerData(ns);
    }

    /** Refresh information about servers that should be updated once per loop, but doesn't need to be up-to-the-second.
     * @param {NS} ns */
    async function updateCachedServerData(ns) {
        //if (verbose) log(ns, `updateCachedServerData`);
        dictServerMaxRam = await getServersDict(ns, 'getServerMaxRam');
    }

    /** Refresh data that might change rarely over time, but for which having precice up-to-the-minute information isn't critical.
     * @param {NS} ns */
    async function refreshDynamicServerData(ns) {
        if (verbose) log(ns, `refreshDynamicServerData: ${allHostNames}`);
        // Min Security / Max Money can be affected by Hashnet purchases, so we should update this occasionally
        dictServerMinSecurityLevels = await getServersDict(ns, 'getServerMinSecurityLevel');
        // Get relative profitability for hash spending. If RAM is tight, fall back rather than crashing orchestration.
        try {
            const pid = await exec(ns, getFilePath('analyze-hack.js'), null, null, '--all', '--silent');
            await waitForProcessToComplete_Custom(ns, getHomeProcIsAlive(ns), pid);
            const analyzeHackResult = dictServerProfitInfo = ns.read('/Temp/analyze-hack.txt');
            if (!analyzeHackResult)
                log(ns, "WARNING: analyze-hack info unavailable. Will use fallback approach.");
            else
                dictServerProfitInfo = Object.fromEntries(JSON.parse(analyzeHackResult).map(s => [s.hostname, s]));
        } catch (err) {
            dictServerProfitInfo = null;
            log(ns, `WARNING: Could not run analyze-hack.js; hash spending will wait for profitability data. ${getErrorInfo(err)}`, false, 'warning');
        }
        // Hack: Below concerns aren't related to "server data", but are things we also wish to refresh just once in a while
        // Determine whether we have purchased stock API accesses yet (affects reserving and attempts to manipulate stock markets)
        haveTixApi = haveTixApi || await getNsDataThroughFile(ns, `ns.stock.hasTixApiAccess()`);
        have4sApi = have4sApi || await getNsDataThroughFile(ns, `ns.stock.has4SDataTixApi()`);
        // Update our cache of income / expenses by category
        moneySources = await getNsDataThroughFile(ns, 'ns.getMoneySources()');
    }

    class Server {
        /** @param {NS} ns
         * @param {string} node - a.k.a host / server **/
        constructor(ns, node) {
            this.ns = ns; // TODO: This might get us in trouble
            this.name = node;
            this._hasRootCached = null; // Once we get root, we never lose it, so we can stop asking
            this._files = (/**@returns{Set<string>}*/() => null)(); // Unfortunately, can't cache this forever because a "kill-all-scripts.js" or "cleanup.js" run will wipe them.
        }
        resetCaches() {
            this._files = null;
            // Once true - Does not need to be reset, because once rooted, this fact will never change
            if (this._hasRootCached == false) this._hasRootCached = null;
        }
        getMoney() { return this.ns.getServerMoneyAvailable(this.name); }
        /** Does this server have a copy of this file on it last we checked?
         * @param {string} fileName */
        async hasFile(fileName) {
            this._files ??= new Set(await getNsDataThroughFile(ns, 'ns.ls(ns.args[0])', null, [this.name]));
            // The game does not start folder names with a slash, we have to remove this before searching the ls result
            if (fileName.startsWith('/')) fileName = fileName.substring(1);
            return this._files.has(fileName);
        }
        hasRoot() { return this._hasRootCached ??= this.ns.hasRootAccess(this.name); }
        isHost() { return this.name == daemonHost; }
        totalRam(ignoreReservedRam = false) {
            let maxRam = dictServerMaxRam[this.name]; // Use a cached max ram amount to save time.
            if (maxRam == null) throw new Error(`Dictionary of servers' max ram was missing information for ${this.name}`);
            // Complete HACK: but for most planning purposes, we want to pretend home has less ram to leave room for temp scripts to run
            if (!ignoreReservedRam && (this.name == "home" ||
                (this.name == backupServerName && dictServerMaxRam["home"] <= 16))) // Double-hack: When home RAM sucks (start of BN 1.1) reserve a server for helpers.
                maxRam = Math.max(0, maxRam - homeReservedRam);
            return maxRam;
        }
        usedRam() { return this.ns.getServerUsedRam(this.name); }
        ramAvailable(ignoreReservedRam = false) { return this.totalRam(ignoreReservedRam) - this.usedRam(); }
    }

    // Helpers to get slices of info / cumulative stats across all rooted servers
    function getNetworkStats() {
        const rootedServers = getAllServers().filter(server => server.hasRoot());
        const listOfServersFreeRam = rootedServers.map(s => s.ramAvailable()).filter(ram => ram > 1.6); // Servers that can't run a script don't count
        const totalMaxRam = rootedServers.map(s => s.totalRam()).reduce((a, b) => a + b, 0);
        const totalFreeRam = Math.max(0, listOfServersFreeRam.reduce((a, b) => a + b, 0)); // Hack, free ram can be negative due to "pretending" reserved home ram doesn't exist. Clip to 0
        return {
            listOfServersFreeRam: listOfServersFreeRam,
            totalMaxRam: totalMaxRam,
            totalFreeRam: totalFreeRam,
            totalUsedRam: totalMaxRam - totalFreeRam,
            // The money we could make if we took 100% from every currently hackable server, to help us guage how relatively profitable each server is
            //totalMaxMoney: rootedServers.filter(s => s.canHack() && s.shouldHack()).map(s => s.getMaxMoney()).reduce((a, b) => a + b, 0)
        };
    }
    // Intended as a high-powered "figure this out for me" run command.
    // If it can't run all the threads at once, it runs as many as it can across the spectrum of daemons available.
    /** @param {NS} ns
     * @param {Tool} tool - An object representing the script being executed **/
    async function arbitraryExecution(ns, tool, threads, args, preferredServerName = null, useSmallestServerPossible = false, allowThreadSplitting = null) {
        // We will be using the list of servers that is sorted by most available ram
        const igRes = tool.ignoreReservedRam; // Whether this tool ignores "reserved ram"
        const rootedServersByFreeRam = getAllServersByFreeRam().filter(server => server.hasRoot() && server.totalRam(igRes) > 1.6);
        // Sort servers by total ram, and try to fill these before utilizing another server.
        const preferredServerOrder = getAllServersByMaxRam().filter(server => server.hasRoot() && server.totalRam(igRes) > 1.6);
        if (useSmallestServerPossible) // If so-configured, fill up small servers before utilizing larger ones (can be laggy)
            preferredServerOrder.reverse();

        // IDEA: "home" is more effective at grow() and weaken() than other nodes (has multiple cores) (TODO: By how much?)
        //       so if this is one of those tools, put it at the front of the list of preferred candidates, otherwise keep home ram free if possible
        //       TODO: This effort is wasted unless we also scale down the number of threads "needed" when running on home. We will overshoot grow/weaken
        const homeIndex = preferredServerOrder.findIndex(i => i.name == "home");
        if (homeIndex > -1) { // Home server might not be in the server list at all if it has insufficient RAM
            const home = preferredServerOrder.splice(homeIndex, 1)[0];
            if (tool.shortName == "grow" || tool.shortName == "weak" || preferredServerName == "home")
                preferredServerOrder.unshift(home); // Send to front
            else
                preferredServerOrder.push(home); // Otherwise, send it to the back (reserve home for scripts that benefit from cores) and use only if there's no room on any other server.
        }
        // Push all "hacknet servers" to the end of the preferred list, since they will lose productivity if used
        const anyHacknetNodes = [];
        let hnNodeIndex;
        while (-1 !== (hnNodeIndex = preferredServerOrder.indexOf(s => s.name.startsWith('hacknet-server-') || s.name.startsWith('hacknet-node-'))))
            anyHacknetNodes.push(...preferredServerOrder.splice(hnNodeIndex, 1));
        preferredServerOrder.push(...anyHacknetNodes.sort((a, b) => b.totalRam(igRes) != a.totalRam(igRes) ? b.totalRam(igRes) - a.totalRam(igRes) : a.name.localeCompare(b.name)));

        // Allow for an overriding "preferred" server to be used in the arguments, and slot it to the front regardless of the above
        if (preferredServerName && preferredServerName != "home" /*home is handled above*/ && preferredServerOrder[0].name != preferredServerName) {
            const preferredServerIndex = preferredServerOrder.findIndex(i => i.name == preferredServerName);
            if (preferredServerIndex != -1)
                preferredServerOrder.unshift(preferredServerOrder.splice(preferredServerIndex, 1)[0]);
            else
                log(ns, `ERROR: Configured preferred server "${preferredServerName}" for ${tool.name} is not a valid server name`, true, 'error');
        }
        if (verbose) log(ns, `Preferred Server ${preferredServerName ?? "(any)"} for ${threads} threads of ${tool.name} (use small=` + `${useSmallestServerPossible})` +
            ` resulted in preferred order:${preferredServerOrder.map(s => ` ${s.name} (${formatRam(s.ramAvailable(igRes))})`)}`);

        // Helper function to compute the most threads a server can run
        let computeMaxThreads = /** @param {Server} server */ function (server) {
            if (tool.cost == 0) return 1;
            let ramAvailable = server.ramAvailable(igRes);
            // Note: To be conservative, we allow double imprecision to cause this floor() to return one less than should be possible,
            //       because the game likely doesn't account for this imprecision (e.g. let 1.9999999999999998 return 1 rather than 2)
            return Math.floor((ramAvailable / tool.cost)/*.toPrecision(14)*/);
        };

        let targetServer = null;
        let remainingThreads = threads;
        let splitThreads = false;
        for (let i = 0; i < rootedServersByFreeRam.length && remainingThreads > 0; i++) {
            targetServer = rootedServersByFreeRam[i];
            const maxThreadsHere = Math.min(remainingThreads, computeMaxThreads(targetServer));
            if (maxThreadsHere <= 0)
                continue; //break; HACK: We don't break here because there are cases when sort order can change (e.g. we've reserved home RAM)

            // If this server can handle all required threads, see if a server that is more preferred also has room.
            // If so, we prefer to pack that server with more jobs before utilizing another server.
            if (maxThreadsHere == remainingThreads) {
                for (let j = 0; j < preferredServerOrder.length; j++) {
                    const nextMostPreferredServer = preferredServerOrder[j];
                    // If the next largest server is also the current server with the most capacity, then it's the best one to pack
                    if (nextMostPreferredServer == targetServer)
                        break;
                    // If the job can just as easily fit on this server, prefer to put the job there
                    if (remainingThreads <= computeMaxThreads(nextMostPreferredServer)) {
                        //log(ns, 'Opted to exec ' + tool.name + ' on preferred server ' + nextMostPreferredServer.name + ' rather than the one with most ram (' + targetServer.name + ')');
                        targetServer = nextMostPreferredServer;
                        break;
                    }
                }
            }

            // If running on a non-daemon host, do a script copy check before running
            if (targetServer.name != daemonHost && !(await tool.existsOnHost(targetServer))) {
                let missing_scripts = [tool.name];
                if (!(await doesFileExist(ns, getFilePath('helpers.js'), targetServer.name)))
                    missing_scripts.push(getFilePath('helpers.js')); // Some tools require helpers.js. Best to copy it around.
                if (tool.name.includes("/Tasks/contractor.js")) // HACK: When home RAM is low and we're running this tool on another sever, copy its dependencies
                    missing_scripts.push(getFilePath('/Tasks/contractor.js.solver.js'), getFilePath('/Tasks/run-with-delay.js'))
                if (verbose)
                    log(ns, `Copying ${tool.name} and ${missing_scripts.length - 1} dependencies from ${daemonHost} to ${targetServer.name} so that it can be executed remotely.`);
                await getNsDataThroughFile(ns, `ns.scp(ns.args.slice(2), ns.args[0], ns.args[1])`, '/Temp/copy-scripts.txt', [targetServer.name, daemonHost, ...missing_scripts])
                missing_scripts.forEach(s => targetServer._files[s] = true); // Make note that these files now exist on the target server
                //await ns.sleep(5); // Workaround for Bitburner bug https://github.com/danielyxie/bitburner/issues/1714 - newly created/copied files sometimes need a bit more time, even if awaited
            }
            // By default, tools executed in this way will be marked as "temporary" (not to be included in the save file or recent scripts history)
            const pid = await exec(ns, tool.name, targetServer.name, { threads: maxThreadsHere, temporary: (tool.runOptions.temporary ?? true) }, ...(args || []));
            if (pid == 0) {
                log(ns, `ERROR: Failed to exec ${tool.name} on server ${targetServer.name} with ${maxThreadsHere} threads`, false, 'error');
                return false;
            }
            // Decrement the threads that have been successfully scheduled
            remainingThreads -= maxThreadsHere;
            if (remainingThreads > 0) {
                if (!(allowThreadSplitting || tool.isThreadSpreadingAllowed)) break;
                if (verbose) log(ns, `INFO: Had to split ${threads} ${tool.name} threads across multiple servers. ${maxThreadsHere} on ${targetServer.name}`);
                splitThreads = true;
            }
        }
        // The run failed if there were threads left to schedule after we exhausted our pool of servers
        if (remainingThreads > 0 && threads < Number.MAX_SAFE_INTEGER) {
            const keepItQuiet = options['silent-misfires'] || homeServer.ramAvailable(true) <= 16; // Don't confuse new users with transient errors when first getting going
            log(ns, `${keepItQuiet ? 'WARN' : 'ERROR'}: Ran out of RAM to run ${tool.name} on ${splitThreads ? 'all servers (split)' : `${targetServer?.name} `}- ` +
                `${threads - remainingThreads} of ${threads} threads were spawned.`, false, keepItQuiet ? undefined : 'error');
        }
        // if (splitThreads && !tool.isThreadSpreadingAllowed) return false; // TODO: Don't think this is needed anymore. We allow overriding with "allowThreadSplitting" in some cases, doesn't mean this is an error
        return remainingThreads == 0;
    }

    /** @param {NS} ns **/
    // Kills all scripts running the specified tool and targeting one of the specified servers if stock market manipulation is enabled
    /** Helper to kill a list of process ids
     * @param {NS} ns **/
    async function killProcessIds(ns, processIds) {
        return await runCommand(ns, `ns.args.forEach(ns.kill)`, '/Temp/kill-pids.js', processIds);
    }

    /** @param {Server} server **/
    function addServer(ns, server, verbose) {
        if (verbose) log(ns, `Adding a new server to all lists: ${server}`);
        _allServers.push(server);
        if (server.name == daemonHost)
            homeServer = server;
        resetServerSortCache(); // Reset the cached sorted lists of objects
    }

    function removeServerByName(ns, deletedHostName) {
        // Remove from the list of server names
        let findIndex = allHostNames.indexOf(deletedHostName)
        if (findIndex === -1)
            log(ns, `ERROR: Failed to find server with the name "${deletedHostName}" in the allHostNames list.`, true, 'error');
        else
            allHostNames.splice(findIndex, 1);
        // Remove from the list of server objects
        const arrAllServers = getAllServers();
        findIndex = arrAllServers.findIndex(s => s.name === deletedHostName);
        if (findIndex === -1)
            log(ns, `ERROR: Failed to find server by name "${deletedHostName}".`, true, 'error');
        else {
            arrAllServers.splice(findIndex, 1);
            log(ns, `"${deletedHostName}" was found at index ${findIndex} of servers and removed leaving ${arrAllServers.length} items.`);
        }
        resetServerSortCache(); // Reset the cached sorted lists of objects
    }

    // Helper to construct our server lists from a list of all host names
    async function buildServerList(ns, verbose = false) {
        // Get list of servers (i.e. all servers on first scan, or newly purchased servers on subsequent scans)
        let scanResult = await getNsDataThroughFile(ns, 'scanAllServers(ns)');
        // Daemon-managed helpers should not consume hacknet server RAM; it reduces hash production.
        scanResult = scanResult.filter(hostName => !hostName.startsWith('hacknet-server-') && !hostName.startsWith('hacknet-node-'))
        // Remove all servers we currently have added that are no longer being returned by the above query
        for (const hostName of allHostNames.filter(hostName => !scanResult.includes(hostName)))
            removeServerByName(ns, hostName);
        // Check if any of the servers are new to us
        const newServers = scanResult.filter(hostName => !allHostNames.includes(hostName))
        if (newServers.length == 0) return; // If not, we're done
        // Update our list of known hostnames
        allHostNames.push(...newServers);
        // Need to refresh static server info, since there are now new servers to gather information from
        await getStaticServerData(ns);
        // Construct server objects for each new server added
        for (const hostName of newServers)
            addServer(ns, new Server(ns, hostName, verbose));
    }

    /** @returns {Server[]} A list of all server objects */
    function getAllServers() { return _allServers; }

    /** @returns {Server} A list of all server objects */
    function getServerByName(hostname) {
        const findResult = getAllServers().find(s => s.name == hostname)
        // Below can be used for debugging, but generally we allow a failed attempt to find a server (at startup)
        // if (!findResult) throw new Error(`Failed to find server for "${hostname}" in list of servers: ${getAllServers().map(s => s.name)}`);
        return findResult;
    }

    // Note: We maintain copies of the list of servers, in different sort orders, to reduce re-sorting time on each iteration
    let _serverListByFreeRam = (/**@returns{Server[]}*/() => undefined)();
    let _serverListByMaxRam = (/**@returns{Server[]}*/() => undefined)();
    const resetServerSortCache = () => _serverListByFreeRam = _serverListByMaxRam = undefined;

    /** @param {Server[]} toSort
     * @param {(a: Server, b: Server) => number} compareFn
     * @returns {Server[]} List sorted by the specified compare function */
    function _sortServersAndReturn(toSort, compareFn) {
        toSort.sort(compareFn);
        return toSort;
    }

    /** @returns {Server[]} Sorted by most free (available) ram to least */
    function getAllServersByFreeRam() {
        return _sortServersAndReturn(_serverListByFreeRam ??= getAllServers().slice(), function (a, b) {
            const ramDiff = b.ramAvailable() - a.ramAvailable();
            return ramDiff != 0.0 ? ramDiff : sortServerTieBreaker(a, b);
        });
    }

    /** @returns {Server[]} Sorted by most max ram to least */
    function getAllServersByMaxRam() {
        return _sortServersAndReturn(_serverListByMaxRam ??= getAllServers().slice(), function (a, b) {
            const ramDiff = b.totalRam() - a.totalRam();
            return ramDiff != 0.0 ? ramDiff : sortServerTieBreaker(a, b);
        });
    }

    /** Comparison function that breaks ties when sorting two servers
     * @param {Server} a
     * @param {Server} b
     * @returns {0|1|-1} */
    function sortServerTieBreaker(a, b) {
        // Sort servers by name, except daemon servers are sorted by their prefix
        return (a.name.startsWith(purchasedServersName) && b.name.startsWith(purchasedServersName)) ?
            (Number("1" + a.name.substring(purchasedServersName.length + 1)) - Number("1" + b.name.substring(purchasedServersName.length + 1))) :
            a.name.localeCompare(b.name); // Other servers, basic sort by name
    }

    async function runCommand(ns, ...args) {
        return await runCommand_Custom(ns, getFnRunViaNsExec(ns, daemonHost), ...args);
    }
    /** A custom daemon.js wrapper around the helpers.js ram-dodging function which uses exec rather than run
     * @param {NS} ns The nestcript instance passed to your script's main entry point
     * @param {string} command The ns command that should be invoked to get the desired data (e.g. "ns.getServer('home')" )
     * @param {string?} fName (default "/Temp/{command-name}.txt") The name of the file to which data will be written to disk by a temporary process
     * @param {any[]?} args args to be passed in as arguments to command being run as a new script.
     * @param {boolean?} verbose (default false) If set to true, pid and result of command are logged. */
    async function getNsDataThroughFile(ns, command, fName, args = [], verbose, maxRetries, retryDelayMs, silent) {
        return await getNsDataThroughFile_Custom(ns, getFnRunViaNsExec(ns, daemonHost), command, fName, args, verbose, maxRetries, retryDelayMs, silent);
    }
    function getHomeProcIsAlive(ns) {
        return (pid) => processList(ns, daemonHost, false).some(p => p.pid === pid);
    }

    async function establishMultipliers(ns) {
        if (verbose) log(ns, "establishMultipliers");
        bitNodeMults = await tryGetBitNodeMultipliers_Custom(ns, getNsDataThroughFile);
        if (verbose)
            log(ns, `Bitnode mults:\n  ${Object.keys(bitNodeMults)
                //.filter(k => bitNodeMults[k] != 1.0)
                .map(k => `${k}: ${bitNodeMults[k]}`).join('\n  ')}`);
    }

    class Tool {
        /** @param {({name: string; shortName: string; shouldRun: () => Promise<boolean>; args: string[]; shouldTail: boolean; threadSpreadingAllowed: boolean; ignoreReservedRam: boolean; minRamReq: number, runOptions: RunOptions; })} toolConfig
         * @param {Number} toolCost **/
        constructor(toolConfig, toolCost) {
            this.name = toolConfig.name;
            this.shortName = toolConfig.shortName;
            this.shouldTail = toolConfig.shouldTail ?? false;
            this.args = toolConfig.args || [];
            this.shouldRun = toolConfig.shouldRun;
            // If tools use ram-dodging, they can specify their "real" minimum ram requirement to run without errors on some host
            this.cost = toolConfig.minRamReq ?? toolCost;
            // "Reserved ram" is reserved for helper scripts and ram-dodging. Tools can specify whether or not they ignore reserved ram during execution.
            this.ignoreReservedRam = toolConfig.ignoreReservedRam ?? false;
            // Whether, in general, it's save to spread threads for this tool around to different servers (overridden in some cases)
            this.isThreadSpreadingAllowed = toolConfig.threadSpreadingAllowed === true;
            // New option to control script RunOptions. By default, they are marked as temporary.
            this.runOptions = toolConfig.runOptions ?? { temporary: true };
            this.restartOnArgsChange = toolConfig.restartOnArgsChange === true;
            this.relaunchIfExited = toolConfig.relaunchIfExited === true;
            this.cooldownMs = toolConfig.cooldownMs ?? 0;
            this.lastLaunchAttempt = 0;
            this.tailLayout = toolConfig.tailLayout ?? null;
            this.lastTailedPid = 0;
        }
        /** @param {Server} server
         * @returns {Promise<boolean>} true if the server has a copy of this tool. */
        async existsOnHost(server) {
            return await server.hasFile(this.name);
        }
        /** @param {Server} server
         * @returns {Promise<boolean>} true if the server has this tool and enough ram to run it. */
        async canRun(server) {
            return await server.hasFile(this.name) && server.ramAvailable(this.ignoreReservedRam) >= this.cost;
        };
        /** @param {boolean} allowSplitting - Whether max threads is computed across the largest server, or all servers (defaults to this.isThreadSpreadingAllowed)
         * @returns {number} The maximum number of threads we can run this tool with given the ram present. */
        getMaxThreads(allowSplitting = undefined) {
            if (allowSplitting === undefined)
                allowSplitting = this.isThreadSpreadingAllowed;
            // analyzes the servers array and figures about how many threads can be spooled up across all of them.
            let maxThreads = 0;
            for (const server of getAllServersByFreeRam().filter(s => s.hasRoot())) {
                // Note: To be conservative, we allow double imprecision to cause this floor() to return one less than should be possible,
                //       because the game likely doesn't account for this imprecision (e.g. let 1.9999999999999998 return 1 rather than 2)
                let serverRamAvailable = server.ramAvailable(this.ignoreReservedRam);
                // HACK: Temp script firing before the script gets scheduled can cause further available home ram reduction, don't promise as much from home
                // TODO: Revise this hack, it is technically messing further with the "servers by free ram" sort order. Perhaps an alternative to this approach
                //       is that the scheduler should not be so strict about home reserved ram enforcement if we use thread spreading and save scheduling on home for last?
                if (server.name == "home" && !this.ignoreReservedRam)
                    serverRamAvailable -= homeReservedRam; // Note: Effectively doubles home reserved RAM in cases where we plan to consume all available RAM            
                const threadsHere = Math.max(0, Math.floor(serverRamAvailable / this.cost));
                //log(server.ns, `INFO: Can fit ${threadsHere} threads of ${this.shortName} on ${server.name} (ignoreReserve: ${this.ignoreReservedRam})`)
                if (!allowSplitting)
                    return threadsHere;
                maxThreads += threadsHere;
            }
            return maxThreads;
        }
    }

    /** @param {NS} ns
     * @param {({name: string; shortName: string; shouldRun: () => Promise<boolean>; args: string[]; shouldTail: boolean; threadSpreadingAllowed: boolean; ignoreReservedRam: boolean; minRamReq: number, runOptions: RunOptions; })[]} allTools **/
    async function buildToolkit(ns, allTools) {
        if (verbose) log(ns, "buildToolkit");
        // Fix the file path for each tool if this script was cloned to a sub-directory
        allTools.forEach(script => script.name = getFilePath(script.name));
        // Get the cost (RAM) of each tool from the API
        let toolCosts = await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(s => [s, ns.getScriptRam(s, 'home')]))`,
            '/Temp/script-costs.txt', allTools.map(t => t.name));
        // Construct a Tool class instance for each configured item
        const toolsTyped = allTools.map(toolConfig => new Tool(toolConfig, toolCosts[toolConfig.name]));
        toolsByShortName = Object.fromEntries(toolsTyped.map(tool => [tool.shortName || hashToolDefinition(tool), tool]));
        return toolsTyped;
    }

    /** @returns {string} */
    const hashToolDefinition = s => hashCode(s.name + (s.args?.toString() || ''));

    /** @returns {Tool} */
    function getTool(s) {
        //return tools.find(t => t.shortName == (s.shortName || s) || hashToolDefinition(t) == hashToolDefinition(s))
        return toolsByShortName[s] || toolsByShortName[s.shortName || hashToolDefinition(s)];
    }

    // script entry point
    /** @param {NS} ns **/
    async function startup_withRetries(ns) {
        let startupAttempts = 0;
        while (startupAttempts++ <= 5) {
            try {
                await startup(ns);
                return;
            } catch (err) {
                if (startupAttempts == 5)
                    log(ns, `ERROR: daemon.js Keeps catching a fatal error during startup: ${getErrorInfo(err)}`, true, 'error');
                else {
                    log(ns, `WARN: daemon.js Caught an error during startup: ${getErrorInfo(err)}` +
                        `\nWill try again (attempt ${startupAttempts} of 5)`, false, 'warning');
                    await ns.sleep(5000);
                }
            }
        }
    }

    // Start daemon.js
    await startup_withRetries(ns);
}
