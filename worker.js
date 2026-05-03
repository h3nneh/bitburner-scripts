export async function main(ns) {
  const host = ns.getHostname();

  while (await ns.dnet.getBlockedRam(host) > 0) {
    await ns.dnet.memoryReallocation(host);
  }

  for (const f of await ns.ls(host, ".cache")) {
    await ns.dnet.openCache(f);
  }

  while (host != "darkweb") {
    await ns.dnet.phishingAttack();
  }
}