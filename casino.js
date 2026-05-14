// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/casino.js
const supportedGames = ['blackjack', 'roulette'];

export function autocomplete(data, args) {
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag === '--game')
        return supportedGames;
    return [];
}

function getSelectedGame(rawArgs) {
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] !== '--game')
            continue;
        const value = rawArgs[i + 1];
        return typeof value === 'string' ? value : 'roulette';
    }
    return 'roulette';
}

function removeGameArg(rawArgs) {
    const forwardedArgs = [];
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] === '--game') {
            i++;
            continue;
        }
        forwardedArgs.push(rawArgs[i]);
    }
    return forwardedArgs;
}

function filterArgsForGame(game, rawArgs) {
    const allowedFlags = game === 'roulette' ? new Set([
        '--click-sleep-time',
        '--find-sleep-time',
        '--enable-logging',
        '--training-bet',
        '--kill-all-scripts',
        '--no-deleting-remote-files',
        '--on-completion-script',
        '--on-completion-script-args',
    ]) : null;
    const forwardedArgs = removeGameArg(rawArgs);
    if (!allowedFlags)
        return forwardedArgs;
    const filteredArgs = [];
    for (let i = 0; i < forwardedArgs.length; i++) {
        const arg = forwardedArgs[i];
        if (typeof arg !== 'string' || !arg.startsWith('--')) {
            filteredArgs.push(arg);
            continue;
        }
        if (!allowedFlags.has(arg)) {
            i++;
            continue;
        }
        filteredArgs.push(arg);
        if (i + 1 < forwardedArgs.length && !(typeof forwardedArgs[i + 1] === 'string' && forwardedArgs[i + 1].startsWith('--')))
            filteredArgs.push(forwardedArgs[++i]);
    }
    return filteredArgs;
}

/** @param {NS} ns **/
export async function main(ns) {
    const game = getSelectedGame(ns.args);
    const gameScript = game === 'blackjack' ? 'casino-blackjack.js' :
        game === 'roulette' ? 'casino-roulette.js' : null;
    if (gameScript) {
        ns.spawn(gameScript, {
            threads: 1,
            spawnDelay: 100,
        }, ...filterArgsForGame(game, ns.args));
        return;
    }

    ns.tprint(`ERROR: Unsupported casino game "${game}". Supported values: ${supportedGames.join(', ')}`);
}
