// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/run-corporation.js
import { argsSchema } from './corporation-options.js';
import { disableLogs, formatMoney, formatRam, scanAllServers } from './helpers.js';

/** @typedef {import('./index.js').NS} NS*/

/**
 * Try to find a place to run our corporation script, copy it out there, and start it up.
 * @param {NS} ns
 */
export async function main(ns) {
    const version = '2026-05-30-sphyxos-corp.1';
    ns.print(`run-corporation.js version ${version}`);
    disableLogs(ns, ['getServerMaxRam', 'getServerUsedRam', 'scp', 'exec', 'write', 'read', 'sleep', 'ps']);
	const scriptName = 'corporation.js';
	const scriptDependencies = ['helpers.js', 'corporation-options.js'];
    const scriptSize = ns.getScriptRam(scriptName, 'home');

    // Get a list of all the servers, and see if any of them can handle our script.
    let servers = scanAllServers(ns);
    servers = servers.filter((hostname) => !isFlaggedForDeletion(ns, hostname));
    servers = servers.filter((hostname) => ns.getServerMaxRam(hostname) >= scriptSize)
        .sort((a, b) => getFreeRam(ns, b) - getFreeRam(ns, a));

    if (servers.length > 0) {
        for (const hostname of servers) {
			let freeRam = getFreeRam(ns, hostname);
			if (freeRam > scriptSize) {
                const status = await getCorporationStartupStatus(ns, hostname);
                if (status && !status.hasCorporation && status.currentNode !== 3 && status.playerMoney + status.stockValue < 150e9) {
                    ns.tprint(`No corporation exists and self-funding is not affordable. Need ${formatMoney(150e9)}, ` +
                        `have cash ${formatMoney(status.playerMoney)}, stocks ${formatMoney(status.stockValue)}, net ${formatMoney(status.playerMoney + status.stockValue)}.`);
                    ns.tprint(`Exiting before launching '${scriptName}' (${formatRam(scriptSize)}) to free RAM.`);
                    ns.exit();
                }
                if (hostname != 'home') {
                    await ns.scp(scriptName, hostname);
                    await ns.scp(scriptDependencies, hostname);
                }
				let pid = ns.exec(scriptName, hostname, 1, ...ns.args);
                if (!pid) {
                    ns.tprint(`ERROR: Failed to launch '${scriptName}' on '${hostname}' despite ${formatRam(freeRam)} free RAM.`);
                    continue;
                }
				if (!ns.args.includes("--no-tail-windows"))
					ns.ui.openTail(pid);
				ns.exit();
			}
		}
    } else {
        ns.tprint(`No servers that can possibly run '${scriptName}' (${formatRam(scriptSize)}).`);
    }
}

async function getCorporationStartupStatus(ns, hostname) {
    const statusFile = `/Temp/corporation-startup-status-${ns.pid}.txt`;
    const helperFile = `${statusFile}.js`;
    const helperScript = `export async function main(ns) {
        let corporation = null;
        let error = null;
        try { corporation = ns.corporation.getCorporation(); }
        catch (e) { error = typeof e == "string" ? e : e?.message ?? JSON.stringify(e); }
        const player = ns.getPlayer();
        const resetInfo = ns.getResetInfo();
        let stockValue = 0;
        try {
            for (const sym of ns.stock.getSymbols()) {
                const [sharesLong, , sharesShort, avgShortCost] = ns.stock.getPosition(sym);
                if (sharesLong > 0) stockValue += sharesLong * ns.stock.getBidPrice(sym) - 100000;
                if (sharesShort > 0) stockValue += sharesShort * (2 * avgShortCost - ns.stock.getAskPrice(sym)) - 100000;
            }
        } catch { stockValue = 0; }
        ns.write(ns.args[0], JSON.stringify({
            hasCorporation: !!corporation,
            error,
            playerMoney: player.money,
            stockValue,
            currentNode: resetInfo.currentNode,
        }), "w");
    }`;
    if (ns.read(helperFile) !== helperScript)
        ns.write(helperFile, helperScript, 'w');
    if (hostname != 'home')
        await ns.scp(helperFile, hostname);
    ns.write(statusFile, '<pending>', 'w');
    const pid = ns.exec(helperFile, hostname, { temporary: true }, statusFile);
    if (!pid) {
        ns.print(`WARNING: Could not run corporation startup preflight on '${hostname}'. Falling back to 'corporation.js' startup checks.`);
        return null;
    }
    for (let i = 0; i < 50; i++) {
        if (!ns.ps(hostname).some(process => process.pid === pid))
            break;
        await ns.sleep(100);
    }
    if (hostname != 'home')
        await ns.scp(statusFile, 'home', hostname);
    const raw = ns.read(statusFile);
    if (raw && raw !== '<pending>') {
        try { return JSON.parse(raw); }
        catch (e) {
            ns.print(`WARNING: Could not parse corporation startup preflight result: ${raw}`);
            return null;
        }
    }
    ns.print(`WARNING: Corporation startup preflight timed out on '${hostname}'. Falling back to 'corporation.js' startup checks.`);
    return null;
}

function getFreeRam(ns, hostname) {
    return ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
}

function isFlaggedForDeletion(ns, hostname) {
    return hostname != 'home' && ns.fileExists('/Flags/deleting.txt', hostname);
}

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}
