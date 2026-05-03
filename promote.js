// promote.js
import { getNsDataThroughFile } from './helpers.js';

export async function main(ns) {
  while (true) {
    const target = ns.read("/dnet/promote-target.txt").trim();
    if (target) await getNsDataThroughFile(ns, `ns.dnet.promoteStock(ns.args[0])`, null, [target]);
    else await ns.sleep(5000);
  }
}