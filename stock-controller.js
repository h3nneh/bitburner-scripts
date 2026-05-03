// stock-controller.js
import { getNsDataThroughFile } from './helpers.js';

const TARGET_FILE = "/dnet/promote-target.txt";

export async function main(ns) {
  if (!await getNsDataThroughFile(ns, 'ns.stock.hasTIXAPIAccess()')) return;
  while (true) {
    const stocks = await getNsDataThroughFile(ns,
      `ns.stock.getSymbols().map(s => [s, ns.stock.getPosition(s), ns.stock.getPrice(s), ns.stock.getForecast(s)])`
    );
    let best = null, bestScore = 0;
    for (const [sym, [shares, , short], price, forecast] of stocks) {
      const score = (shares + short) * price * Math.abs(forecast - 0.5);
      if (score > bestScore) { bestScore = score; best = sym; }
    }
    if (best) ns.write(TARGET_FILE, best, "w");
    await ns.sleep(10000);
  }
}