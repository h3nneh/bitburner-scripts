/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["interval", 30000],
        ["no-tail-windows", false],
        ["verbose-terminal", false],
        ["enable-stock", false], // Promote long-held stocks with idle darkweb RAM (see stockmaster coordination).
        ["enable-share", false], // Spend idle darkweb RAM on share (faction rep boost).
        ["enable-induce", false], // Induce migration on the busiest connected neighbor.
        ["help", false],
    ]);

    if (options.help) {
        ns.tprint([
            "Keeps Bitburner 3.0 darknet automation unlocked and running.",
            `Usage: run ${ns.getScriptName()} [--interval 30000] [--no-tail-windows] [--verbose-terminal]`,
            "This manager is intentionally quiet by default so autopilot logs stay readable.",
        ].join("\n"));
        return;
    }

    if (options["no-tail-windows"]) ns.disableLog("ALL");
    const interval = Math.max(1000, Number(options.interval) || 30000);

    while (true) {
        try {
            await ensureDarknetAutomation(ns, options);
        } catch (error) {
            ns.print(`WARN: Darknet manager failed: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

async function ensureDarknetAutomation(ns, options) {
    if (!ns.fileExists("darknet.js", "home") || !ns.fileExists("darknet-worker.js", "home")) {
        ns.print("INFO: Waiting for darknet.js and darknet-worker.js to exist on home.");
        return;
    }

    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        if (!ns.scan("home").includes("darkweb"))
            runOnce(ns, "Tasks/tor-manager.js", ["-c"]);
        else
            runOnce(ns, "Tasks/program-manager.js", ["-c"]);
        return;
    }

    if (isRunning(ns, "darknet.js")) return;
    const args = [];
    if (options["no-tail-windows"]) args.push("--no-tail-windows");
    if (options["verbose-terminal"]) args.push("--verbose-terminal");
    if (options["enable-stock"]) args.push("--enable-stock");
    if (options["enable-share"]) args.push("--enable-share");
    if (options["enable-induce"]) args.push("--enable-induce");
    runOnce(ns, "darknet.js", args);
}

function runOnce(ns, script, args = []) {
    if (isRunning(ns, script)) return 0;
    const pid = ns.run(script, 1, ...args);
    if (pid > 0) ns.print(`INFO: Launched ${script} (pid ${pid}) with args: [${args.join(", ")}].`);
    else ns.print(`WARN: Failed to launch ${script} with args: [${args.join(", ")}].`);
    return pid;
}

function isRunning(ns, script) {
    return ns.ps("home").some(process => process.filename === script || process.filename.endsWith(`/${script}`));
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
