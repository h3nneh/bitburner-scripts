import { getNsDataThroughFile } from './helpers.js';

const PW_DB = "/dnet/passwords.txt";

const loadPasswords = (ns) => {
  try { return JSON.parse(ns.read(PW_DB) || "{}"); }
  catch { return {}; }
};

const savePassword = (ns, host, pw) => {
  const db = loadPasswords(ns);
  db[host] = pw;
  ns.write(PW_DB, JSON.stringify(db), "w");
};

const guessFromFormat = (format, length) => {
  switch (format) {
    case "numeric": return "0".repeat(length);
    case "alphabetic":
    case "alphanumeric": return "a".repeat(length);
    default: return "";
  }
};

const tryPassword = async (ns, hostname, password) => {
  const result = await ns.dnet.authenticate(hostname, password);
  if (result.success) {
    savePassword(ns, hostname, password);
  }
  return result.success;
};

export async function main(ns) {
  const promoteRam = ns.getScriptRam("Activities/promote.js", "home");
  const workerRam = ns.getScriptRam("Activities/worker.js", "home");

  while (true) {
    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (!(await serverSolver(ns, hostname))) continue;

      ns.scp([ns.getScriptName(), "Activities/worker.js", "Activities/promote.js", "helpers.js"], hostname);
      ns.kill(ns.getScriptName(), hostname);
      ns.exec(ns.getScriptName(), hostname, { preventDuplicates: true });

      const totalFree = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
      const hasStocks = ns.stock.hasTixApiAccess() && ns.read("/dnet/promote-target.txt").trim() !== "";

      let remaining = totalFree;
      if (hasStocks && promoteRam > 0) {
        const t = Math.floor((totalFree * 0.7) / promoteRam);
        if (t > 0) {
          ns.exec("Activities/promote.js", hostname, { threads: t, preventDuplicates: true });
          remaining -= t * promoteRam;
        }
      }
      if (workerRam > 0) {
        const t = Math.floor(remaining / workerRam);
        if (t > 0) ns.exec("Activities/worker.js", hostname, { threads: t, preventDuplicates: true });
      }
    }

    // Nudge a neighbor to migrate, opens new parts of the net
    if (Math.random() < 0.2 && nearbyServers.length > 0) {
      const target = nearbyServers[Math.floor(Math.random() * nearbyServers.length)];
      await getNsDataThroughFile(ns, 'ns.dnet.induceServerMigration(ns.args[0])', null, [target]);
    }

    // Stasis-link valuable current server if we have capacity
    const here = await getNsDataThroughFile(ns, 'ns.getHostname()');
    const linked = await getNsDataThroughFile(ns, 'ns.dnet.getStasisLinkedServers()');
    const limit = await getNsDataThroughFile(ns, 'ns.dnet.getStasisLinkLimit()');
    const maxRam = await getNsDataThroughFile(ns, 'ns.getServerMaxRam(ns.args[0])', null, [here]);
    if (here !== "home" && !linked.includes(here) && linked.length < limit && maxRam >= 256) {
      await getNsDataThroughFile(ns, 'ns.dnet.setStasisLink(ns.args[0])', null, [true]);
    }

    await ns.sleep(5000);
  }
}

export const serverSolver = async (ns, hostname) => {
  const details = ns.dnet.getServerAuthDetails(hostname);
  if (!details.isConnectedToCurrentServer || !details.isOnline) return false;
  if (details.hasSession) return true;

  // 1. Try persisted password first
  const saved = loadPasswords(ns)[hostname];
  if (saved !== undefined && (await tryPassword(ns, hostname, saved))) return true;

  // 2. Model-specific guess
  let pw;
  switch (details.modelId) {
    case "ZeroLogon":
      pw = "";
      break;
    case "CloudBlare(tm)":
    case "DeskMemo_3.1":
      pw = details.data.match(/\d/g)?.join("") ?? "";
      break;
    case "FreshInstall_1.0":
    default:
      pw = guessFromFormat(details.passwordFormat, details.passwordLength);
  }

  if (await tryPassword(ns, hostname, pw)) return true;

  // 3. Failed — peek logs for hints
  try {
    const logs = await ns.dnet.heartbleed(hostname, { peek: true });
    ns.print(`[${hostname}] ${details.modelId} failed. Hint: ${details.passwordHint} | Logs: ${logs.logs}`);
  } catch {
    ns.print(`[${hostname}] ${details.modelId} failed (charisma too low for heartbleed)`);
  }
  return false;
};

export function autocomplete(data: AutocompleteData) {
  return ["--tail"];
}