// SphyxOS-style RAM-dodge proxy for ns.dnet (and other ns) calls.
//
// Each proxied call runs the target ns function inside a disposable temp script on the CURRENT
// server (ns.getHostname()), reserving exactly `getFunctionRamCost(func) + overhead` via ramOverride,
// and returns the result through a pid-keyed port. This lets darknet-worker.js avoid statically
// referencing most of the (RAM-expensive) ns.dnet.* family.
//
// SESSION MODEL (important): server *authentication* is per-server and persists (set by cracking /
// authenticate). The *session pointer* ("currently connected to") is per-SCRIPT and dies when the
// script exits. So:
//   - proxyLocal: for STATELESS queries (probe, getServerDetails, authenticate, getBlockedRam) — no
//     session pointer needed.
//   - proxyAuth: for session-bound ops — the temp worker sets its OWN pointer via connectToSession
//     (instant, since the server is already authed) and runs the op atomically before it exits.
//   - connectToSession that a LONG-LIVED parent relies on afterward (before its own scp/exec) must
//     stay a DIRECT ns.dnet.connectToSession call in that parent — NOT proxied (a temp child's
//     pointer dies with it).

const PROXY_WORKER = "dnet-proxy.js";
const PROXY_AUTH_WORKER = "dnet-proxy-auth.js";
const PROXY_OVERHEAD = 1.6; // Base temp-script RAM overhead added on top of the called function's cost.
const AUTH_EXTRA = 0.05;    // Extra headroom for the connectToSession the auth worker performs.

let workersWritten = false;

/** Generate a proxy worker's source. The auth variant connects a session to `server` first.
 * Resolves `ns.a.b.c` from a dotted function name, awaits Promises, strips Promise-valued object
 * fields (they cannot survive a port write), and returns the result via a pid-keyed port. */
function proxyWorkerSource(auth) {
    return `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  ${auth ? "let [server, password, func, ...args] = ns.args" : "let [func, ...args] = ns.args"}
  let fn = ns
  for (const prop of String(func).split(".")) fn = fn[prop]
  ${auth ? "try { ns.dnet.connectToSession(server, password) } catch {}" : ""}
  let result
  try {
    const r = fn(...args)
    if (r instanceof Promise) result = await r
    else if (r instanceof Object) { promiseRemoval(r); result = r }
    else result = r
  } catch {}
  ns.atExit(() => { try { ns.writePort(ns.pid, result === undefined ? null : result) } catch {} })
}
function promiseRemoval(o) {
  for (const k in o)
    if (o[k] instanceof Promise) delete o[k]
    else if (o[k] instanceof Object) promiseRemoval(o[k])
}`;
}

/** Write the two proxy worker scripts to the current server (idempotent). Must be present on every
 * server a darknet script runs on; callers also scp this module on spread. */
export function ensureProxyWorkers(ns) {
    if (workersWritten && ns.fileExists(PROXY_WORKER) && ns.fileExists(PROXY_AUTH_WORKER)) return;
    ns.write(PROXY_WORKER, proxyWorkerSource(false), "w");
    ns.write(PROXY_AUTH_WORKER, proxyWorkerSource(true), "w");
    workersWritten = true;
}

/** The worker filenames, so launchers can scp them alongside darknet-worker.js if desired. */
export const PROXY_WORKER_FILES = [PROXY_WORKER, PROXY_AUTH_WORKER];

/** RAM-dodged STATELESS ns call on the current server. `func` is a dotted name e.g. "dnet.probe".
 * @returns {Promise<any>} the function's result (null if it threw or returned undefined). */
export async function proxyLocal(ns, func, ...args) {
    return await runProxy(ns, PROXY_WORKER, func, [func, ...args], 0);
}

/** RAM-dodged session-bound ns call: the temp worker sets its session pointer to `server` (instant
 * if the server is already authed) and runs `func` atomically before exiting. */
export async function proxyAuth(ns, server, password, func, ...args) {
    return await runProxy(ns, PROXY_AUTH_WORKER, func, [server, password, func, ...args], AUTH_EXTRA);
}

async function runProxy(ns, worker, func, execArgs, extra) {
    ensureProxyWorkers(ns);
    let ramOverride;
    try { ramOverride = ns.getFunctionRamCost(func) + PROXY_OVERHEAD + extra; }
    catch { ramOverride = PROXY_OVERHEAD + extra; } // Unknown function cost: reserve the base overhead only.
    const host = ns.getHostname();
    const pid = ns.exec(worker, host, { threads: 1, temporary: true, ramOverride }, ...execArgs);
    if (pid === 0) throw new Error(`darknet proxy failed to exec ${worker} for ${func} on ${host} (need ${ramOverride}GB).`);
    return await readProxyResult(ns, pid);
}

/** Wait for the temp script to write its result to the pid-keyed port, then read it. */
async function readProxyResult(ns, pid) {
    const port = ns.getPortHandle(pid);
    while (port.empty()) {
        if (!ns.isRunning(pid)) {
            if (port.empty()) return undefined; // Exited without writing → treat as undefined.
            break;
        }
        await port.nextWrite();
    }
    const value = port.read();
    return value === "NULL PORT DATA" ? undefined : value;
}
