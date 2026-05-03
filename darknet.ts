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
    case "alphabetic": return "password";
    case "alphanumeric": return "a".repeat(length);
    default: return "";
  }
};

const bruteForce = async (ns, hostname, length) => {
  for (let i = 0; i < 1000; i++) {
    let pw = "";
    if (i < 10) pw = "00" + i.toString();
    else if (i >= 10 && i < 100) pw = "0" + i.toString();
    else pw = i.toString();
    if (await tryPassword(ns, hostname, pw)) return pw;
  }
  return "";
};

function romanToInt(s: string): number {
  const roman = new Map<string, number>([
    ['I', 1], ['V', 5], ['X', 10], ['L', 50],
    ['C', 100], ['D', 500], ['M', 1000]
  ]);
  
  let sum = 0;  // Initialize the total sum
  let prevValue = roman.get(s[0])!;  // Initialize the value of the first Roman numeral
  for (let i = 1; i < s.length; i++) {
    const currentValue = roman.get(s[i])!;
    // If the current value is greater than the previous value, subtract the previous value
    // Otherwise, add the previous value
    sum += currentValue > prevValue ? -prevValue : prevValue;
    prevValue = currentValue;  // Update the previous value for the next iteration
  }
  sum += prevValue;  // Add the last value to sum
  return sum;  // Return the computed total
}

const tryPassword = async (ns, hostname, password) => {
  if (typeof password !== 'string') return false;
  const result = await ns.dnet.authenticate(hostname, password);
  if (result.success) {
    savePassword(ns, hostname, password);
  }
  return result.success;
};

export async function main(ns) {
  const promoteRam = ns.getScriptRam("promote.js", "home");
  const workerRam = ns.getScriptRam("worker.js", "home");
  const stasisRam = ns.getScriptRam("stasisLink.js", "home");
  const migrationRam = ns.getScriptRam("induceServerMigration.js", "home");

  while (true) {
    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (!(await serverSolver(ns, hostname))) continue;

      ns.scp([ns.getScriptName(), "worker.js", "promote.js", "helpers.js", "stasisLink.js", "induceServerMigration.js"], hostname);
      ns.kill(ns.getScriptName(), hostname);
      ns.exec(ns.getScriptName(), hostname, { preventDuplicates: true });

      const totalFree = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
      const hasStocks = ns.stock.hasTixApiAccess() && ns.read("/dnet/promote-target.txt").trim() !== "";

      let remaining = totalFree;
      if (remaining > stasisRam) {
        const t = Math.floor(remaining / stasisRam);
        if (t > 0) ns.exec("stasisLink.js", hostname, { threads: t, preventDuplicates: true });
        await ns.sleep(5)
      }
      if (remaining > migrationRam) {
        const t = Math.floor(remaining / migrationRam);
        if (t > 0) ns.exec("induceServerMigration.js", hostname, { threads: t, preventDuplicates: true });
        await ns.sleep(5)
      }
      if (hasStocks && promoteRam > 0) {
        const t = Math.floor((totalFree * 0.7) / promoteRam);
        if (t > 0) {
          ns.exec("promote.js", hostname, { threads: t, preventDuplicates: true });
          remaining -= t * promoteRam;
        }
      }
      if (workerRam > 0) {
        const t = Math.floor(remaining / workerRam);
        if (t > 0) ns.exec("worker.js", hostname, { threads: t, preventDuplicates: true });
      }
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
      pw = details.data?.match(/\d/g)?.join("") ?? "";
      break;
    case "DeskMemo_3.1":
      pw = details.passwordHint?.match(/\d/g)?.join("") ?? "";
      break;
    case "DeepGreen":
      pw = await bruteForce(ns, hostname, details.passwordLength);
      break;
    case "OctantVoxel":
      var str_array = details.data.split(',');
      pw = parseInt(str_array[1], parseInt(str_array[0])).toString();
      break;
    case "BellaCuore":
      pw = romanToInt(details.data).toString();
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