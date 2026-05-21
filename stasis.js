/** @param {NS} ns */
export async function main(ns) {
    const active = ns.args[0] ?? true;
    await ns.dnet.setStasisLink(active);
}
