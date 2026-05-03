export async function main(ns) {
  while (true) {
    const target = ns.read("/dnet/promote-target.txt").trim();
    if (target) await ns.dnet.promoteStock(target);
    else await ns.sleep(5000);
  }
}