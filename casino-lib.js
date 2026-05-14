// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/casino-lib.js
export async function checkForKickedOut(tryfindElement, click, ns = null, retries = 10) {
    let closeModal;
    do {
        const kickedOut = await tryfindElement(
            "//*[contains(normalize-space(.), 'Alright cheater get out of here') and contains(normalize-space(.), 'not allowed here anymore')]",
            retries);
        if (kickedOut !== null) return true;
        closeModal = await tryfindElement("//button[contains(@class,'closeButton')]", retries);
        if (!closeModal) break;
        if (ns) ns.print("Found a modal that needs to be closed.");
        await click(closeModal);
    } while (closeModal !== null);
    return false;
}

export async function findCasinoSaveButton(findRequiredElement) {
    return await findRequiredElement("//button[@aria-label = 'save game']", 100,
        `Sorry, couldn't find the Overview Save (💾) button. Is your "Overview" panel collapsed or modded?`, true);
}

export async function saveCasinoGame(ns, click, btnSaveGame, saveSleepTime = 0) {
    if (saveSleepTime) await ns.sleep(saveSleepTime);
    await click(btnSaveGame);
    if (saveSleepTime) await ns.sleep(saveSleepTime);
}

export async function ensureInAevum(ns, click, findRequiredElement, travelToAevum = null) {
    if (ns.getPlayer().city === "Aevum")
        return;
    if (ns.getPlayer().money < 200000)
        throw new Error("Sorry, you need at least 200k to travel to the casino.");

    let travelled = false;
    if (travelToAevum) {
        try { travelled = await travelToAevum(); } catch { }
    }

    if (!travelled) {
        await click(await findRequiredElement("//div[@role='button' and ./div/p/text()='Travel']"));
        await click(await findRequiredElement("//span[contains(@class,'travel') and ./text()='A']"));
        const confirm = await findRequiredElement("//button[p/text()='Travel']", 5);
        if (confirm)
            await click(confirm);
    }

    if (ns.getPlayer().city !== "Aevum")
        throw new Error(`We thought we travelled to Aevum, but we're apparently still in ${ns.getPlayer().city}...`);
}

export async function navigateToCasino(ns, click, findRequiredElement, goToCasino = null) {
    let success = false;
    if (goToCasino) {
        try { success = await goToCasino(); } catch { }
    }
    if (!success) {
        await click(await findRequiredElement("//div[(@role = 'button') and (contains(., 'City'))]", 15,
            `Couldn't find the "🏙 City" menu button. Is your "World" nav menu collapsed?`));
        await click(await findRequiredElement("//span[@aria-label = 'Iker Molina Casino']"));
    }
}

export async function openCasinoGame(click, findRequiredElement, gameButtonText, retries = 15) {
    await click(await findRequiredElement(`//button[contains(text(), '${gameButtonText}')]`, retries));
}
