import { getNsDataThroughFile, scanAllServers } from './helpers.js'

// Shared coordination files between stockmaster.js (writer) and the manipulation
// consumers (puppet.js, darknet-worker.js). stockmaster is the only script that
// pays ns.stock.* RAM; consumers only ns.read() these files.
export const STOCK_POSITIONS_FILE = '/Temp/stock-positions.txt';
const STOCK_SERVER_MAP_FILE = '/Temp/stock-symbol-servers.txt';
// Consumers ignore the positions file if it hasn't been updated within this window.
export const STOCK_POSITIONS_MAX_AGE_MS = 30000;

/** Build a map of stock symbol -> the server hostname owned by that symbol's organization.
 * Built once via RAM-dodged temp scripts and cached to a file for reuse across restarts.
 * @param {NS} ns
 * @param {string[]} symbols All stock symbols (from ns.stock.getSymbols()).
 * @returns {Promise<Object<string,string>>} symbol -> hostname (may omit symbols with no matching server) */
export async function buildStockServerMap(ns, symbols) {
    if (!symbols || symbols.length === 0) return {};
    const cached = ns.read(STOCK_SERVER_MAP_FILE);
    if (cached) {
        try {
            const map = JSON.parse(cached);
            if (map && Object.keys(map).length > 0) return map;
        } catch { /* fall through and rebuild */ }
    }
    const servers = scanAllServers(ns);
    // ns.stock.getOrganization may be unavailable in older API versions; guard per-symbol.
    const symToOrg = await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(s => { try { return [s, ns.stock.getOrganization(s)]; } catch { return [s, null]; } }))`,
        '/Temp/stock-sym-org.txt', symbols);
    const serverToOrg = await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(s => [s, ns.getServer(s).organizationName]))`,
        '/Temp/server-org.txt', servers);
    if (!symToOrg || !serverToOrg) return {};
    const orgToServer = {};
    for (const [server, org] of Object.entries(serverToOrg))
        if (org) orgToServer[org] = server;
    const map = {};
    for (const [sym, org] of Object.entries(symToOrg)) {
        const server = org ? orgToServer[org] : null;
        if (server) map[sym] = server;
    }
    await ns.write(STOCK_SERVER_MAP_FILE, JSON.stringify(map), 'w');
    return map;
}

/** Serialize the current stock positions so manipulation consumers know which
 * symbols (and their servers) we hold long vs short.
 * @param {NS} ns
 * @param {Array} allStocks stockmaster stock objects (with sym, sharesLong, sharesShort, prob).
 * @param {Object<string,string>} serverMap symbol -> server hostname. */
export async function writeStockPositions(ns, allStocks, serverMap) {
    const positions = {};
    for (const stk of allStocks) {
        const server = serverMap[stk.sym];
        if (!server) continue;
        const position = stk.sharesLong > 0 ? 'long' : stk.sharesShort > 0 ? 'short' : 'none';
        positions[stk.sym] = {
            server,
            position,
            shares: position === 'long' ? stk.sharesLong : position === 'short' ? stk.sharesShort : 0,
            forecast: stk.prob,
        };
    }
    await ns.write(STOCK_POSITIONS_FILE, JSON.stringify({ lastUpdate: Date.now(), positions }), 'w');
}

/** Write an empty positions snapshot so consumers immediately stop manipulating
 * (e.g. right after a liquidation).
 * @param {NS} ns */
export async function clearStockPositions(ns) {
    await ns.write(STOCK_POSITIONS_FILE, JSON.stringify({ lastUpdate: Date.now(), positions: {} }), 'w');
}
