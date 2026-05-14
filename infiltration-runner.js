// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/infiltration-runner.js
const argsSchema = [
    ['company', ''],
    ['city', ''],
    ['faction', ''],
    ['cash', false],
    ['allow-travel', false],
    ['result-file', '/Temp/infiltration-runner-result.txt'],
    ['on-completion-script', ''],
    ['on-completion-script-args', ''],
    ['location-ready', false],
    ['debug', false],
];

const infiltrationStartLockFile = "/Temp/work-for-factions-infiltration-lock.txt";
const infiltrationActiveLockFile = "/Temp/work-for-factions-infiltration-active.txt";
const infiltrationPendingTimeout = 120000;
const infiltrationTeardownTimeout = 5000;
const hospitalizationRetryDelay = 500;

/** @param {NS} ns **/
export async function main(ns) {
    ns.ramOverride(4.6);
    const options = ns.flags(argsSchema);
    ns.disableLog('sleep');
    ns.write(options['result-file'], JSON.stringify({ success: false, reason: 'started' }), 'w');
    let finalResult;
    try {
        if (!options.city || !options.company || (!options.cash && !options.faction))
            finalResult = { success: false, reason: 'missing-args' };

        let hospitalizationRetries = 0;
        while (!finalResult) {
            const result = await runInfiltrationAttempt(ns, options);
            if (result.reason == 'hospitalized' && shouldRetryHospitalized(options)) {
                hospitalizationRetries++;
                ns.write(options['result-file'], JSON.stringify({
                    success: false,
                    reason: 'hospitalized-retrying',
                    retries: hospitalizationRetries,
                }), 'w');
                log(ns, `WARNING: Hospitalized during ${options.company}. Restarting infiltration attempt ${hospitalizationRetries + 1}.`);
                await ns.sleep(hospitalizationRetryDelay);
                continue;
            }
            finalResult = result;
        }
    } catch (error) {
        finalResult = { success: false, reason: `exception: ${String(error)}` };
    } finally {
        await ensureInfiltrationAutomationStopped(ns);
    }
    if (finalResult?.success)
        await dismissFactionInvitationModal(ns);
    return finish(ns, options['result-file'], finalResult || { success: false, reason: 'unknown' },
        options['on-completion-script'], parseCompletionArgs(options['on-completion-script-args']));
}

function log(ns, message) {
    ns.print(message);
}

async function runInfiltrationAttempt(ns, options) {
    if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
        log(ns, `WARNING: Previous infiltration UI did not fully clear before starting ${options.company}.`);
    if (!await goToCity(ns, options.city, options['allow-travel'])) {
        return { success: false, reason: 'travel-failed' };
    }
    if (!options['location-ready'] && !await goToLocation(ns, options.company)) {
        return { success: false, reason: 'go-to-location-failed' };
    }

    const startTs = Date.now();
    ns.write(infiltrationStartLockFile, `${startTs}`, 'w');
    ns.write(infiltrationActiveLockFile, `${startTs}`, 'w');
    let automationStarted = false;
    automationStarted = await ensureInfiltrationAutomationStarted(ns);
    if (!automationStarted) {
        clearInfiltrationActiveLock(ns);
        return { success: false, reason: 'infiltrate.js-start-failed' };
    }

    if (!await startInfiltrationFromCompanyPage(ns, options)) {
        clearInfiltrationActiveLock(ns);
        return { success: false, reason: 'start-failed' };
    }
    while (true) {
        const state = await getInfiltrationUiState(ns);
        if (state == "running") {
            await ns.sleep(100);
            continue;
        }
        if (state == "start") {
            await ns.sleep(100);
            continue;
        }
        if (state == "success") {
            const clicked = await clickInfiltrationRewardButton(ns, options.faction, options.cash, 5000, options.debug);
            clearInfiltrationActiveLock(ns);
            if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
                log(ns, `WARNING: Infiltration UI did not fully clear after success at ${options.company}.`);
            log(ns, clicked ?
                `SUCCESS: Claimed infiltration reward from ${options.company} for ${options.cash ? 'cash' : `faction rep with "${options.faction}"`}.` :
                `WARNING: Failed to claim infiltration reward from ${options.company} for ${options.cash ? 'cash' : `faction rep with "${options.faction}"`}.`);
            return { success: clicked, reason: clicked ? 'success' : 'reward-click-failed' };
        }
        if (state == "hospitalized") {
            clearInfiltrationActiveLock(ns);
            await dismissHospitalizedDialog(ns);
            if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
                log(ns, `WARNING: Infiltration UI did not fully clear after hospitalization at ${options.company}.`);
            return { success: false, reason: 'hospitalized' };
        }
        const activeSince = Number(ns.read(infiltrationActiveLockFile) || 0);
        if (activeSince > 0 && Date.now() - activeSince > infiltrationPendingTimeout) {
            clearInfiltrationActiveLock(ns);
            return { success: false, reason: 'timeout' };
        }
        await ns.sleep(100);
    }
}

function shouldRetryHospitalized(options) {
    return options.cash && options.city == 'Sector-12' && options.company == "Joe's Guns";
}

function parseCompletionArgs(rawArgs) {
    if (!rawArgs) return [];
    if (Array.isArray(rawArgs)) return rawArgs;
    try {
        const parsed = JSON.parse(rawArgs);
        return Array.isArray(parsed) ? parsed : [rawArgs];
    } catch {
        return [rawArgs];
    }
}

function finish(ns, resultFile, result, onCompletionScript = '', onCompletionScriptArgs = []) {
    ns.write(resultFile, JSON.stringify(result), 'w');
    if (result.success && onCompletionScript) {
        log(ns, `INFO: Spawning completion script ${onCompletionScript}.`);
        ns.spawn(onCompletionScript, {
            threads: 1,
            spawnDelay: 100,
        }, ...onCompletionScriptArgs);
    }
    return result.success;
}

function getDocument() {
    return eval("document");
}

function getWindow() {
    return eval("window");
}

function getText(element) {
    return element?.textContent?.trim()?.replace(/\s+/g, " ") || "";
}

function clickElement(element) {
    if (!element) return false;
    const wnd = getWindow();
    if (typeof element.click === "function") element.click();
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: wnd }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: wnd }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: wnd }));
    return true;
}

function findElementByXPath(xpath) {
    const doc = getDocument();
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

async function waitForElementByXPath(ns, xpath, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const element = findElementByXPath(xpath);
        if (element) return element;
        await ns.sleep(50);
    }
    return null;
}

function getInfiltrationUiStateDirect() {
    const doc = getDocument();
    const bodyText = doc.body?.innerText || "";
    const h4Text = Array.from(doc.querySelectorAll("h4")).map(el => el.textContent?.trim() || "");
    if (bodyText.includes("Infiltration was cancelled because you were hospitalized")) return "hospitalized";
    if (h4Text.some(text => text.toLowerCase() === "infiltration successful!")) return "success";
    if (h4Text.some(text => text.startsWith("Infiltrating ")) &&
        Array.from(doc.querySelectorAll("button")).some(btn => btn.textContent?.trim() === "Start")) return "start";
    if (bodyText.includes("Type it backward")) return "running";
    if (bodyText.includes("Enter the Code!")) return "running";
    if (bodyText.includes("Close the brackets.")) return "running";
    if (bodyText.includes("Slash when his guard is down!")) return "running";
    if (bodyText.includes("Remember all the mines!")) return "running";
    if (bodyText.includes("Mark all the mines!")) return "running";
    if (bodyText.includes("Say something nice about the guard.")) return "running";
    if (bodyText.includes("Match the symbols!")) return "running";
    if (bodyText.includes("Cut the wires with the following properties!")) return "running";
    if (bodyText.includes("Enter the Code")) return "running";
    if (bodyText.includes("Maximum clearance level:")) return "running";
    return "other";
}

function clickCashRewardButton() {
    const doc = getDocument();
    const wnd = getWindow();
    const button = Array.from(doc.querySelectorAll("button"))
        .find(btn => btn.textContent?.trim()?.includes("Sell for"));
    if (!button || button.disabled) {
        return {
            clicked: false,
            found: !!button,
            disabled: !!button?.disabled,
            text: button?.textContent?.trim() || null,
        };
    }
    const reactHandlerKey = Object.keys(button).find(key => key.startsWith("__reactProps"));
    if (reactHandlerKey && typeof button[reactHandlerKey]?.onClick === "function") {
        button[reactHandlerKey].onClick({
            isTrusted: true,
            currentTarget: button,
            target: button,
            preventDefault: () => { },
            stopPropagation: () => { },
        });
    }
    if (typeof button.click === "function") button.click();
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: wnd }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: wnd }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: wnd }));
    return {
        clicked: true,
        found: true,
        disabled: false,
        text: button.textContent?.trim() || null,
    };
}

async function goToCity(ns, cityName, allowTravel = false) {
    if (!allowTravel) return true;
    if (await travelToCityByUi(ns, cityName)) return true;
    log(ns, `WARN: Failed to travel to ${cityName} for infiltration-runner using UI navigation.`);
    return false;
}

async function travelToCityByUi(ns, cityName) {
    const cityLetterByName = {
        "Aevum": "A",
        "Chongqing": "C",
        "Ishima": "I",
        "New Tokyo": "N",
        "Sector-12": "S",
        "Volhaven": "V",
    };
    const travelLetter = cityLetterByName[cityName];
    if (!travelLetter) return false;

    const travelMenu = await waitForElementByXPath(ns, "//div[@role='button' and ./div/p/text()='Travel']", 1500);
    if (!clickElement(travelMenu)) return false;
    await ns.sleep(50);
    const cityButton = await waitForElementByXPath(ns, `//span[contains(@class,'travel') and ./text()='${travelLetter}']`, 1500);
    if (!clickElement(cityButton)) return false;
    await ns.sleep(50);
    const confirm = await waitForElementByXPath(ns, "//button[p/text()='Travel']", 500);
    if (confirm) clickElement(confirm);

    await ns.sleep(250);
    return true;
}

async function goToLocation(ns, locationName) {
    if (isOnLocationPage(locationName)) return true;
    const cityMenu = await waitForElementByXPath(ns, "//div[(@role = 'button') and (contains(., 'City'))]", 3000);
    if (!clickElement(cityMenu)) return false;
    await ns.sleep(50);

    const locationButton = await waitForLocationElement(ns, locationName, 3000);
    if (!locationButton) return false;
    const clickable = locationButton.closest?.("button,[role='button']") || locationButton;
    if (!clickElement(clickable)) return false;
    return true;
}

function isOnLocationPage(locationName) {
    const doc = getDocument();
    const titleMatches = Array.from(doc.querySelectorAll("h4"))
        .some(element => getText(element) == locationName);
    const canInfiltrate = Array.from(doc.querySelectorAll("button"))
        .some(button => getText(button).includes("Infiltrate Company"));
    return titleMatches && canInfiltrate;
}

async function waitForLocationElement(ns, locationName, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const element = findLocationElement(locationName);
        if (element) return element;
        await ns.sleep(50);
    }
    return null;
}

function findLocationElement(locationName) {
    const doc = getDocument();
    const exactAria = findElementByXPath(`//span[@aria-label = ${xpathString(locationName)}]`);
    if (exactAria) return exactAria;
    return Array.from(doc.querySelectorAll("button,[role='button'],span,p"))
        .find(element => getText(element) == locationName || element.getAttribute?.("aria-label") == locationName);
}

function xpathString(value) {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

async function isInfiltrationAutomationActive(ns) {
    return !!getWindow().tmrAutoInf;
}

async function ensureInfiltrationAutomationStarted(ns) {
    await ensureInfiltrationAutomationStopped(ns);
    await ns.sleep(50);
    const pid = ns.run('infiltrate.js', 1, "--quiet");
    if (!pid) return false;
    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (await isInfiltrationAutomationActive(ns))
            return true;
        await ns.sleep(50);
    }
    return false;
}

async function ensureInfiltrationAutomationStopped(ns) {
    ns.run('infiltrate.js', 1, "--stop", "--quiet");
    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (!await isInfiltrationAutomationActive(ns))
            return true;
        await ns.sleep(50);
    }
    return !await isInfiltrationAutomationActive(ns);
}

function debugConsole(options, message) {
    if (options.debug)
        console.log(`[infiltration-runner] ${message}`);
}

async function clickInfiltrateCompanyButton(ns, options) {
    const doc = getDocument();
    const buttons = Array.from(doc.querySelectorAll("button"));
    const button = buttons.find(btn => btn.textContent?.trim()?.includes("Infiltrate Company"));
    debugConsole(options, `Infiltrate button scan: found=${!!button}, buttons=${JSON.stringify(buttons.map(btn => btn.textContent?.trim()).filter(Boolean))}`);
    if (!button) return false;

    button.scrollIntoView?.({ block: "center", inline: "center" });
    button.focus?.();
    const reactElement = findElementWithReactHandler(button);
    const reactHandlerKey = reactElement ? Object.keys(reactElement).find(key => key.startsWith("__reactProps")) : null;
    debugConsole(options, `Infiltrate button React handler: element=${reactElement?.tagName ?? null}, key=${reactHandlerKey ?? null}, hasOnClick=${!!reactElement?.[reactHandlerKey]?.onClick}`);
    if (reactHandlerKey && typeof reactElement[reactHandlerKey]?.onClick === "function") {
        reactElement[reactHandlerKey].onClick({
            isTrusted: true,
            currentTarget: reactElement,
            target: reactElement,
            preventDefault: () => { },
            stopPropagation: () => { },
        });
        debugConsole(options, `Infiltrate button React onClick invoked with trusted event shim.`);
        return true;
    }
    const clicked = clickElement(button);
    debugConsole(options, `Infiltrate button DOM click fallback result=${clicked}.`);
    return clicked;
}

async function startInfiltrationFromCompanyPage(ns, options) {
    if (!await waitForInfiltrateCompanyButton(ns))
        return false;
    const attemptedStart = await clickInfiltrateCompanyButton(ns, options);
    return attemptedStart && await waitForInfiltrationToStart(ns, 3000);
}

function findElementWithReactHandler(element) {
    const queue = [element, ...Array.from(element.querySelectorAll?.("*") || [])];
    for (const candidate of queue) {
        const propsKey = Object.keys(candidate).find(key => key.startsWith("__reactProps"));
        if (propsKey && typeof candidate[propsKey]?.onClick === "function")
            return candidate;
    }
    return null;
}

async function waitForInfiltrateCompanyButton(ns, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const buttonExists = Array.from(getDocument().querySelectorAll("button"))
            .some(btn => btn.textContent?.trim()?.includes("Infiltrate Company"));
        if (buttonExists) return true;
        await ns.sleep(50);
    }
    return false;
}

async function waitForInfiltrationToStart(ns, timeout = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const state = await getInfiltrationUiState(ns);
        if (state == "running" || state == "start")
            return true;
        await ns.sleep(50);
    }
    return false;
}

async function clickInfiltrationStartButton(ns) {
    const wnd = getWindow();
    const button = Array.from(getDocument().querySelectorAll("button"))
        .find(btn => btn.textContent?.trim() === "Start");
    if (!button || button.disabled) return false;
    if (typeof button.click === "function") button.click();
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: wnd }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: wnd }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: wnd }));
    return true;
}

async function clickInfiltrationRewardButton(ns, factionName, takeCash = false, timeout = 5000, debug = false) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (takeCash) {
            const result = clickCashRewardButton();
            if (result?.clicked) return true;
            if (debug)
                ns.write('/Temp/infiltration-cash-reward-debug.txt', JSON.stringify(result), 'w');
            await ns.sleep(50);
            continue;
        }

        const doc = getDocument();
        const rewardButton = () => Array.from(doc.querySelectorAll("button")).find(btn => {
            const text = getText(btn);
            return text.includes("Trade for");
        });
        const combo = () => doc.querySelector('[role="combobox"]') || doc.querySelector('[aria-haspopup="listbox"]');
        const selectedFaction = () => getText(combo());
        const isTargetFactionSelected = () => {
            const selected = selectedFaction();
            return !!selected && (selected === factionName || selected.includes(factionName) || factionName.includes(selected));
        };

        if (!takeCash && !isTargetFactionSelected()) {
            const comboElement = combo();
            if (comboElement) {
                clickElement(comboElement);
                await ns.sleep(50);
                const option = Array.from(doc.querySelectorAll('[role="option"]')).find(el => getText(el) === factionName);
                if (option) {
                    clickElement(option);
                    await ns.sleep(50);
                }
            }
        }

        const button = rewardButton();
        if (button && !button.disabled && isTargetFactionSelected())
            return clickElement(button);
        await ns.sleep(50);
    }
    return false;
}

async function dismissHospitalizedDialog(ns) {
    const doc = getDocument();
    const bodyText = doc.body?.innerText || "";
    if (!bodyText.includes("Infiltration was cancelled because you were hospitalized")) return false;
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    return true;
}

async function dismissFactionInvitationModal(ns, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const button = Array.from(getDocument().querySelectorAll("button"))
            .find(btn => btn.textContent?.trim() == "Decide later");
        if (button) {
            clickElement(button);
            await ns.sleep(100);
            continue;
        }
        if ((getDocument().body?.innerText || "").includes("You received a faction invitation"))
            getDocument().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        await ns.sleep(50);
    }
    return !(getDocument().body?.innerText || "").includes("You received a faction invitation");
}

async function getInfiltrationUiState(ns) {
    return getInfiltrationUiStateDirect();
}

async function getInfiltrationRuntimeState(ns) {
    const wnd = getWindow();
    let playerHasInfiltration = null;
    try {
        let req = wnd.__bbWebpackRequire;
        if (!req && wnd.webpackChunkbitburner) {
            wnd.webpackChunkbitburner.push([[Symbol("infiltration-runner-runtime-state")], {}, (r) => { req = r; }]);
            wnd.__bbWebpackRequire = req;
        }
        const { Player } = req("./src/Player.ts");
        playerHasInfiltration = !!Player?.infiltration;
    } catch {
        playerHasInfiltration = null;
    }
    return { uiState: getInfiltrationUiStateDirect(), playerHasInfiltration };
}

async function waitForInfiltrationIdle(ns, timeout = infiltrationTeardownTimeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const state = await getInfiltrationRuntimeState(ns);
        const infiltrationActive = state?.playerHasInfiltration === true;
        const uiBusy = ["running", "start", "success", "hospitalized"].includes(state?.uiState);
        if (!infiltrationActive && !uiBusy) return true;
        await ns.sleep(50);
    }
    return false;
}

function clearInfiltrationActiveLock(ns) {
    ns.write(infiltrationActiveLockFile, "", "w");
}
