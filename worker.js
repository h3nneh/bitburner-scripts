import { getNsDataThroughFile } from './helpers.js';

export async function main(ns) {
  const host = ns.getHostname();

  while (await getNsDataThroughFile(ns, `ns.dnet.getBlockedRam(ns.args[0])`, null, [host]) > 0) {
    await getNsDataThroughFile(ns, `ns.dnet.memoryReallocation(ns.args[0])`, null, [host]);
  }

  for (const f of await getNsDataThroughFile(ns, `ns.ls(ns.args[0], ".cache")`, null, [host])) {
    await getNsDataThroughFile(ns, `ns.dnet.openCache(ns.args[0])`, null, [f]);
  }

  while (true) {
    await getNsDataThroughFile(ns, `ns.dnet.phishingAttack()`);
  }
}