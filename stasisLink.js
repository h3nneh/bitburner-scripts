export async function main(ns) {
  // Stasis-link valuable current server if we have capacity
  const here = await ns.getHostname();
  const linked = await ns.dnet.getStasisLinkedServers();
  const limit = await ns.dnet.getStasisLinkLimit();
  const maxRam = await ns.getServerMaxRam(here);
  if (here !== "home" && !linked.includes(here) && linked.length < limit && maxRam >= 256) {
      await ns.dnet.setStasisLink(true);
  }
}