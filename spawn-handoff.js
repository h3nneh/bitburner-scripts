// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/spawn-handoff.js
/** @param {NS} ns */
export async function main(ns) {
    ns.ramOverride(3.6);
    const [targetScript, rawArgs = "[]"] = ns.args;
    const args = JSON.parse(String(rawArgs));
    await ns.sleep(100);
    ns.spawn(String(targetScript), {
        threads: 1,
        spawnDelay: 100,
    }, ...args);
}
