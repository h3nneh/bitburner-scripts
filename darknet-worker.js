// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/darknet-worker.js
const SUCCESS = 200;
const AUTH_FAILURE = 401;
const SERVICE_UNAVAILABLE = 503;
const STATE_FILE = "/Temp/darknet-passwords.txt";

const COMMON_PASSWORDS = [
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567",
    "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow",
    "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321",
    "superman", "1qaz2wsx", "7777777", "121212", "0", "qazwsx", "123qwe", "trustno1", "jordan",
    "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster", "soccer", "harley", "batman", "andrew",
    "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert", "thomas", "hockey", "ranger",
    "daniel", "starwars", "112233", "george", "computer", "michelle", "jessica", "pepper", "1111",
    "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
    "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love", "ashley",
    "6969", "nicole", "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas",
    "austin", "thunder", "taylor", "matrix",
];
const EU_COUNTRIES = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark",
    "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
    "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
    "Slovenia", "Spain", "Sweden",
];
const LARGE_PRIMES = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503,
    2539, 2693, 2741, 2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289,
    4547, 4729, 4789, 4877, 4943, 4951, 4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881,
    6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719, 6841, 7103, 7549, 7559, 7573, 7691, 7753,
    7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199, 9343, 9467, 9551, 9601,
    9739, 9749, 9859,
];

/** @param {NS} ns */
export async function main(ns) {
    const options = parseOptions(ns.args);
    if (options.help) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [--origin home] [--interval 15000] [--disable-phishing] [--verbose-terminal] [--self-test]`);
        return;
    }
    if (options["self-test"]) {
        const result = runSelfTest();
        ns.tprint(`Darknet worker self-test: ${result.passed}/${result.total} passed.`);
        for (const failure of result.failures) ns.tprint(`FAIL: ${failure}`);
        if (result.failures.length) ns.exit();
        return;
    }

    ns.disableLog("sleep");
    const script = ns.getScriptName();
    const interval = Math.max(1000, Number(options.interval) || 15000);
    const maxAttempts = Math.max(1, Number(options["max-attempts-per-host"]) || 160);

    while (true) {
        try {
            await openLocalCaches(ns);
            await freeLocalBlockedRam(ns);
            if (!options["disable-phishing"]) await tryPhishing(ns);
            await crawlNeighbors(ns, script, String(options.origin), interval, maxAttempts, options["verbose-terminal"]);
        } catch (error) {
            ns.print(`WARN: Darknet worker cycle failed on ${ns.getHostname()}: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

function parseOptions(args) {
    const options = {
        origin: "home",
        interval: 15000,
        "max-attempts-per-host": 160,
        "disable-phishing": false,
        "verbose-terminal": false,
        "self-test": false,
        help: false,
    };
    const valueOptions = new Set(["origin", "interval", "max-attempts-per-host"]);
    for (let i = 0; i < args.length; i++) {
        const rawArg = args[i];
        if (typeof rawArg !== "string" || !rawArg.startsWith("--")) continue;
        const name = rawArg.slice(2);
        if (!(name in options)) continue;
        if (!valueOptions.has(name)) {
            options[name] = true;
            continue;
        }
        const next = args[i + 1];
        if (next == null || typeof next === "string" && next.startsWith("--")) continue;
        options[name] = next;
        i++;
    }
    return options;
}

async function crawlNeighbors(ns, script, origin, interval, maxAttempts, verboseTerminal) {
    const host = ns.getHostname();
    const knownPasswords = readKnownPasswords(ns);
    const neighbors = ns.dnet.probe(false).filter(server => server !== origin && server !== host);

    for (const target of neighbors) {
        let details;
        try {
            details = ns.dnet.getServerDetails(target);
        } catch (error) {
            ns.print(`WARN: Cannot inspect ${target}: ${formatError(error)}`);
            continue;
        }
        if (!details.isOnline) continue;

        let password = knownPasswords[target];
        if (password != null) {
            const session = ns.dnet.connectToSession(target, password);
            if (!session.success) password = null;
        }

        if (password == null) {
            password = await solveAndAuthenticate(ns, target, details, maxAttempts, verboseTerminal);
            if (password == null) continue;
            knownPasswords[target] = password;
            writeKnownPasswords(ns, knownPasswords);
        }

        await spreadToNeighbor(ns, script, target, password, interval, verboseTerminal);
    }
}

async function solveAndAuthenticate(ns, target, details, maxAttempts, verboseTerminal) {
    const candidates = buildCandidates(details).slice(0, maxAttempts);
    if (candidates.length === 0) {
        ns.print(`INFO: No solver yet for ${target} model=${details.modelId}`);
        return null;
    }

    for (const candidate of unique(candidates)) {
        const result = await ns.dnet.authenticate(target, candidate, 0);
        if (result.code === SUCCESS) {
            terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (${details.modelId}).`);
            return candidate;
        }
        if (result.code === SERVICE_UNAVAILABLE) return null;
        if (result.code !== AUTH_FAILURE) ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
    }
    ns.print(`INFO: Solver failed for ${target} model=${details.modelId} after ${candidates.length} attempts.`);
    return null;
}

async function spreadToNeighbor(ns, script, target, password, interval, verboseTerminal) {
    try {
        const session = ns.dnet.connectToSession(target, password);
        if (!session.success) return;
        await ns.scp(script, target, ns.getHostname());
        if (ns.fileExists(STATE_FILE, ns.getHostname())) await ns.scp(STATE_FILE, target, ns.getHostname());
        const args = ["--origin", ns.getHostname(), "--interval", interval];
        if (verboseTerminal) args.push("--verbose-terminal");
        const pid = ns.exec(script, target, { threads: 1, preventDuplicates: true }, ...args);
        if (pid > 0) ns.print(`INFO: Spread ${script} to ${target} (pid ${pid}).`);
    } catch (error) {
        ns.print(`WARN: Could not spread to ${target}: ${formatError(error)}`);
    }
}

function buildCandidates(details) {
    const model = details.modelId;
    const data = String(details.data ?? "");
    const hint = String(details.passwordHint ?? "");
    if (model === "ZeroLogon") return [""];
    if (model === "DeskMemo_3.1") return [lastHintToken(hint)];
    if (model === "FreshInstall_1.0") return ["admin", "password", "0000", "12345"];
    if (model === "CloudBlare(tm)") return [data.replace(/\D/g, "")];
    if (model === "Laika4") return ["fido", "spot", "rover", "max"];
    if (model === "TopPass") return COMMON_PASSWORDS;
    if (model === "EuroZone Free") return EU_COUNTRIES;
    if (model === "BellaCuore") return solveRoman(data);
    if (model === "PrimeTime 2") return [String(largestKnownPrimeFactor(Number(data)))];
    if (model === "110100100") return [data.split(/\s+/).map(bits => String.fromCharCode(parseInt(bits, 2))).join("")];
    if (model === "OrdoXenos") return [xorDecode(data)];
    if (model === "OctantVoxel") return [String(Math.round(parseBaseN(data)))];
    if (model === "MathML") return [String(parseArithmeticExpression(data))];
    if (model === "Pr0verFl0") return ["A".repeat(Math.max(1, details.passwordLength * 2))];
    return [];
}

export function __testBuildCandidates(details) {
    return buildCandidates(details);
}

export function __testRunSelfTest() {
    return runSelfTest();
}

function runSelfTest() {
    const tests = [
        ["ZeroLogon", { modelId: "ZeroLogon" }, [""]],
        ["DeskMemo_3.1", { modelId: "DeskMemo_3.1", passwordHint: "The password is 123" }, ["123"]],
        ["FreshInstall_1.0", { modelId: "FreshInstall_1.0" }, ["admin", "password", "0000", "12345"]],
        ["CloudBlare(tm)", { modelId: "CloudBlare(tm)", data: "1[]2╬3" }, ["123"]],
        ["Laika4", { modelId: "Laika4" }, ["fido", "spot", "rover", "max"]],
        ["BellaCuore single", { modelId: "BellaCuore", data: "XLII" }, ["42"]],
        ["BellaCuore range", { modelId: "BellaCuore", data: "IX,XI" }, ["9", "10", "11"]],
        ["PrimeTime 2", { modelId: "PrimeTime 2", data: String(9739 * 97) }, ["9739"]],
        ["110100100", { modelId: "110100100", data: "01101000 01101001" }, ["hi"]],
        ["OrdoXenos", { modelId: "OrdoXenos", data: "aaa;00000001 00000010 00000011" }, ["`cb"]],
        ["OctantVoxel", { modelId: "OctantVoxel", data: "16,2A" }, ["42"]],
        ["MathML", { modelId: "MathML", data: "6 * (7 + 1)" }, ["48"]],
        ["Pr0verFl0", { modelId: "Pr0verFl0", passwordLength: 4 }, ["AAAAAAAA"]],
    ];
    const failures = [];
    for (const [name, details, expectedPrefix] of tests) {
        const actual = buildCandidates(details);
        for (let i = 0; i < expectedPrefix.length; i++) {
            if (actual[i] !== expectedPrefix[i]) failures.push(`${name}: expected candidate[${i}]=${expectedPrefix[i]}, got ${actual[i]}`);
        }
    }
    return { total: tests.length, passed: tests.length - failures.length, failures };
}

function lastHintToken(hint) {
    return hint.trim().split(/\s+/).at(-1) ?? "";
}

function solveRoman(data) {
    const parts = data.split(",");
    if (parts.length === 1) return [String(romanToNumber(parts[0]))];
    const min = romanToNumber(parts[0]);
    const max = romanToNumber(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || max - min > 120) return [];
    return Array.from({ length: max - min + 1 }, (_, offset) => String(min + offset));
}

function romanToNumber(input) {
    if (input.toLowerCase() === "nulla") return 0;
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    let previous = 0;
    for (let i = input.length - 1; i >= 0; i--) {
        const value = values[input[i]] ?? NaN;
        if (!Number.isFinite(value)) return NaN;
        total += value < previous ? -value : value;
        previous = value;
    }
    return total;
}

function largestKnownPrimeFactor(value) {
    for (const prime of [...LARGE_PRIMES].reverse()) {
        if (value % prime === 0) return prime;
    }
    return NaN;
}

function xorDecode(data) {
    const [masked, maskText] = data.split(";");
    if (!masked || !maskText) return "";
    return masked.split("").map((char, index) => {
        const mask = parseInt(maskText.split(/\s+/)[index], 2);
        return String.fromCharCode(char.charCodeAt(0) ^ mask);
    }).join("");
}

function parseBaseN(data) {
    const [baseText, encoded] = data.split(",");
    const base = Number(baseText);
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = 0;
    let digit = encoded.split(".")[0].length - 1;
    for (const char of encoded) {
        if (char === ".") continue;
        result += chars.indexOf(char) * base ** digit;
        digit -= 1;
    }
    return result;
}

function parseArithmeticExpression(expression) {
    const cleaned = expression
        .replaceAll("ҳ", "*")
        .replaceAll("÷", "/")
        .replaceAll("➕", "+")
        .replaceAll("➖", "-")
        .replaceAll("ns.exit(),", "")
        .split(",")[0]
        .replace(/[^0-9+\-*/().\s]/g, "");
    return parseExpression(cleaned.replace(/\s+/g, ""));
}

function parseExpression(input) {
    let index = 0;
    const parseNumber = () => {
        if (input[index] === "(") {
            index += 1;
            const value = parseAddSub();
            if (input[index] === ")") index += 1;
            return value;
        }
        const match = input.slice(index).match(/^-?\d+(?:\.\d+)?/);
        if (!match) return 0;
        index += match[0].length;
        return Number(match[0]);
    };
    const parseMulDiv = () => {
        let value = parseNumber();
        while (input[index] === "*" || input[index] === "/") {
            const op = input[index++];
            const right = parseNumber();
            value = op === "*" ? value * right : value / right;
        }
        return value;
    };
    const parseAddSub = () => {
        let value = parseMulDiv();
        while (input[index] === "+" || input[index] === "-") {
            const op = input[index++];
            const right = parseMulDiv();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    };
    return parseAddSub();
}

async function openLocalCaches(ns) {
    const host = ns.getHostname();
    for (const file of ns.ls(host, ".cache")) {
        try {
            const result = ns.dnet.openCache(file, true);
            if (result.success) ns.print(`SUCCESS: Opened darknet cache ${file} on ${host}: ${result.message}`);
        } catch (error) {
            ns.print(`WARN: Could not open cache ${file}: ${formatError(error)}`);
        }
    }
}

async function freeLocalBlockedRam(ns) {
    for (let i = 0; i < 3; i++) {
        let blocked = 0;
        try {
            blocked = ns.dnet.getBlockedRam();
        } catch {
            return;
        }
        if (blocked <= 0) return;
        const result = await ns.dnet.memoryReallocation();
        if (!result.success) return;
    }
}

async function tryPhishing(ns) {
    const host = ns.getHostname();
    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (freeRam < 2.5) return;
    try {
        const result = await ns.dnet.phishingAttack();
        if (result.success) ns.print(`SUCCESS: ${result.message}`);
    } catch (error) {
        ns.print(`WARN: Phishing failed: ${formatError(error)}`);
    }
}

function readKnownPasswords(ns) {
    try {
        const text = ns.read(STATE_FILE);
        if (!text) return {};
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function writeKnownPasswords(ns, passwords) {
    try {
        ns.write(STATE_FILE, JSON.stringify(passwords), "w");
    } catch {
        // State persistence is best-effort. The crawler can still rediscover passwords.
    }
}

function unique(values) {
    return [...new Set(values.filter(value => value != null).map(value => String(value)))];
}

function terminalLog(ns, verboseTerminal, message) {
    if (verboseTerminal) ns.tprint(message);
    else ns.print(message);
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
