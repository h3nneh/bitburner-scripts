// Based on: https://github.com/66Ton99/bitburner-scripts/blob/main/cleanup.js
/** @param {NS} ns **/
export async function main(ns) {
    for (let file of ns.ls('home', 'Temp/'))
        ns.print((ns.rm(file) ? "Removed " : "Failed to remove ") + file);
}