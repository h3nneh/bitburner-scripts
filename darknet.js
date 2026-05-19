/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["worker", "darknet-worker.js"],
        ["interval", 30000],
        ["no-tail-windows", false],
        ["verbose-terminal", false],
        ["help", false],
    ]);

    if (options.help) {
        ns.tprint([
            "Automates initial Bitburner 3.0 darknet exploration.",
            `Usage: run ${ns.getScriptName()} [--worker darknet-worker.js] [--interval 30000] [--verbose-terminal]`,
            "Requires DarkscapeNavigator.exe / ns.dnet access.",
        ].join("\n"));
        return;
    }

    if (options["no-tail-windows"]) ns.disableLog("ALL");
    if (!ns.dnet) {
        terminalLog(ns, options, "INFO: ns.dnet is unavailable. Buy TOR + DarkscapeNavigator.exe before running darknet automation.");
        return;
    }
    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        terminalLog(ns, options, "INFO: Darknet is not unlocked yet. Buy TOR + DarkscapeNavigator.exe before running darknet automation.");
        return;
    }

    const worker = String(options.worker);
    const interval = Math.max(1000, Number(options.interval) || 30000);
    const darkweb = "darkweb";

    while (true) {
        try {
            if (!ns.dnet.isDarknetServer(darkweb)) {
                terminalLog(ns, options, "INFO: Darknet is not unlocked yet. Buy DarkscapeNavigator.exe and rerun.");
                return;
            }

            const auth = await ns.dnet.authenticate(darkweb, "", 0);
            if (!auth.success) {
                ns.print(`WARN: Could not authenticate to darkweb: ${auth.message} (${auth.code})`);
                await ns.sleep(interval);
                continue;
            }

            await ns.scp(worker, darkweb, "home");
            const workerArgs = ["--origin", "home"];
            if (options["verbose-terminal"]) workerArgs.push("--verbose-terminal");
            const pid = ns.exec(worker, darkweb, { threads: 1, preventDuplicates: true }, ...workerArgs);
            if (pid > 0) terminalLog(ns, options, `INFO: Started ${worker} on ${darkweb} (pid ${pid}).`);
            else ns.print(`INFO: ${worker} is already running on ${darkweb}, or there is not enough RAM.`);
        } catch (error) {
            ns.print(`WARN: Darknet launcher failed: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

function terminalLog(ns, options, message) {
    if (options["verbose-terminal"]) ns.tprint(message);
    else ns.print(message);
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
