/** Author: Sphyxis (original)
 * Updated: hybrid cascade + iterative-deepening alpha-beta search with quiescence.
 *
 * Architecture:
 *   1. Opening (turn < 3): hand-crafted opening points
 *   2. Forced tactics (root only): counter-lib saves, snake-eyes cheat
 *   3. Pattern tactics (root only): disrupt-eyes / defensive shapes
 *   4. Search: iterative deepening negamax + alpha-beta + quiescence
 *   5. Fallback: random safe move, else pass
 *
 * Bugs fixed:
 *   - getAggroAttack/getDefAttack: `validLibMoves <= libsMax` (compared array to int)
 *   - 7 near-identical opponent style switch cases collapsed
 */

import {
    getConfiguration, instanceCount, log, getErrorInfo, getActiveSourceFiles, getNsDataThroughFile, formatTime
} from './helpers.js'

const argsSchema = [
    ['cheats', true],
    ['disable-cheats', false],
    ['cheat-chance-threshold', 0.9],
    ['logtime', false],
    ['runOnce', false],
    ['silent', false],
    // Search params
    ['max-depth', 6],              // hard cap for iterative deepening
    ['time-budget', 800],          // ms per move spent in search (default: aggressive)
    ['disable-search', false],     // fall back to pure heuristic cascade
    ['log-search', true],          // print depth/score reached each turn
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    let cheats = false;
    let cheatChanceThreshold = 1.0;
    let logtime = false;
    let runOnce = true;
    let maxDepth = 6;
    let timeBudgetMs = 800;
    let searchEnabled = true;
    let logSearch = true;

    let turn = 0;
    let START = performance.now();

    // Per-turn state from ns.go
    let board = (/**@returns{string[]}*/() => undefined)();
    let contested = (/**@returns{string[]}*/() => undefined)();
    let validMove = (/**@returns{boolean[][]}*/() => undefined)();
    let validLibMoves = (/**@returns{number[][]}*/() => undefined)();
    let chains = (/**@returns{number[][]}*/() => undefined)();
    let testBoard = (/**@returns{string[]}*/() => [])();

    // Patterns (kept from original)
    const disrupt4 = [
        ["??b?", "?b.b", "b.*b", "?bb?"],
        ["?bb?", "b..b", "b*Xb", "?bb?"],
        ["?bb?", "b..b", "b.*b", "?bb?"],
        ["??b?", "?b.b", "?b*b", "??O?"],
        ["?bbb", "bb.b", "W.*b", "?oO?"],
        ["?bbb", "bb.b", "W.*b", "?Oo?"],
        [".bbb", "o*.b", ".bbb", "????"],
    ];
    const disrupt5 = [
        ["?bbb?", "b.*.b", "?bbb?", "?????", "?????"],
        ["??OO?", "?b*.b", "?b..b", "??bb?", "?????"],
        ["?????", "??bb?", "?b*Xb", "?boob", "??bb?"],
        ["WWW??", "WWob?", "Wo*b?", "WWW??", "?????"],
        ["??b??", "?b.b?", "?b*b?", "?b.A?", "??b??"],
        ["??b??", "?b.b?", "??*.b", "?b?b?", "?????"],
        ["?WWW?", "WoOoW", "WOO*W", "W???W", "?????"],
        ["?WWW?", "Wo*oW", "WOOOW", "W???W", "?????"],
    ];
    const def5 = [
        ["?WW??", "WW.X?", "W.XX?", "WWW??", "?????"],
        ["WWW??", "WW.X?", "W.*X?", "WWW??", "?????"],
        ["BBB??", "BB.X?", "B..X?", "BBB??", "?????"],
        ["?WWW?", "W.*.W", "WXXXW", "?????", "?????"],
    ];

    const opponent = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"];
    const opponent2 = [...opponent, "????????????"];

    await start();

    /** @param {NS} ns */
    async function start() {
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions || (await instanceCount(ns)) > 1) return;

        logtime = runOptions.logtime;
        runOnce = runOptions.runOnce;
        maxDepth = runOptions['max-depth'];
        timeBudgetMs = runOptions['time-budget'];
        searchEnabled = !runOptions['disable-search'];
        logSearch = runOptions['log-search'];

        const sourceFiles = await getActiveSourceFiles(ns, true);
        cheats = !runOptions['disable-cheats'] && (sourceFiles[14] ?? 0) >= 2;
        cheatChanceThreshold = runOptions['cheat-chance-threshold'];

        ns.disableLog("go.makeMove");

        let ranToCompletion = false;
        while (!ranToCompletion) {
            try {
                await playGo(ns);
                ranToCompletion = true;
            } catch (err) {
                log(ns, `WARNING: go.js Caught (and suppressed) an unexpected error:\n${getErrorInfo(err)}`, false, 'warning');
                log(ns, `INFO: Will sleep for 10 seconds then try playing again.`, false);
                await ns.sleep(10 * 1000);
            }
        }
    }

    // ---- ns.go ram-dodging helpers ----
    async function go_getBoardState(ns) { return await getNsDataThroughFile(ns, `ns.go.getBoardState()`); }
    async function go_analysis_getControlledEmptyNodes(ns) { return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`); }
    async function go_analysis_getValidMoves(ns) { return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`); }
    async function go_analysis_getLiberties(ns) { return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`); }
    async function go_analysis_getChains(ns) { return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`); }
    async function go_cheat_getCheatSuccessChance(ns) { return await getNsDataThroughFile(ns, `ns.go.cheat.getCheatSuccessChance()`); }
    async function go_cheat_playTwoMoves(ns, x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, `await ns.go.cheat.playTwoMoves(...ns.args)`, null, [x1, y1, x2, y2]);
    }
    async function go_makeMove(ns, x, y) { return await ns.go.makeMove(x, y); }

    // ---- Main game loop ----
    /** @param {NS} ns */
    async function playGo(ns) {
        const startBoard = await go_getBoardState(ns);
        let inProgress = false;
        turn = 0;
        START = performance.now();
        for (let x = 0; x < startBoard[0].length && !inProgress; x++) {
            for (let y = 0; y < startBoard[0].length; y++) {
                if (startBoard[x][y] === "X") { inProgress = true; turn = 3; break; }
            }
        }
        const currentGame = await ns.go.opponentNextTurn(false);
        checkNewGame(ns, currentGame);

        while (true) {
            turn++;
            board = await go_getBoardState(ns);
            contested = await go_analysis_getControlledEmptyNodes(ns);
            validMove = await go_analysis_getValidMoves(ns);
            validLibMoves = await go_analysis_getLiberties(ns);
            chains = await go_analysis_getChains(ns);

            const size = board[0].length;
            // Build padded test board for pattern matching
            const testWall = "W".repeat(size + 2);
            testBoard = [testWall, ...board.map(b => "W" + b + "W"), testWall];

            let results;

            // === Stage 1: Opening ===
            if (turn < 3) {
                results = await movePiece(ns, getOpeningMove());
                if (results) { checkNewGame(ns, results); continue; }
            }

            // === Stage 2: Forced cheap tactics ===
            if (results = await movePiece(ns, getRandomCounterLib())) { checkNewGame(ns, results); continue; }
            if (cheats && (results = await moveSnakeEyes(ns, getSnakeEyes(6)))) { checkNewGame(ns, results); continue; }

            // === Stage 3: Tactical patterns (high-confidence shapes) ===
            if (results = await movePiece(ns, disruptEyes())) { checkNewGame(ns, results); continue; }
            if (results = await movePiece(ns, getDefPattern())) { checkNewGame(ns, results); continue; }

            // === Stage 4: Search ===
            if (searchEnabled) {
                const searchMove = runSearch(ns);
                if (searchMove && searchMove.coords) {
                    if (results = await movePiece(ns, searchMove)) { checkNewGame(ns, results); continue; }
                }
            }

            // === Stage 5: Fallback (random safe) ===
            if (results = await movePiece(ns, getRandomSafe())) { checkNewGame(ns, results); continue; }

            // === Stage 6: Pass ===
            ns.print("Turn Passed");
            results = await ns.go.passTurn();
            checkNewGame(ns, results);
        }
    }

    /** @param {{type:string;x:number;y:number}} gameInfo */
    function checkNewGame(ns, gameInfo) {
        if (gameInfo && gameInfo.type === "gameOver") {
            if (runOnce) ns.exit();
            try { ns.go.resetBoardState(opponent2[Math.floor(Math.random() * opponent2.length)], 13); }
            catch { ns.go.resetBoardState(opponent[Math.floor(Math.random() * opponent.length)], 13); }
            turn = 0;
            ns.clearLog();
        }
    }

    // ============================================================
    // LOCAL BOARD SIMULATOR (for search)
    // ============================================================
    // cells: 0=empty, 1=X (us), 2=O (them), 3=offline (#)
    function buildLocalBoard(boardStrings) {
        const size = boardStrings.length;
        const cells = new Int8Array(size * size);
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const c = boardStrings[x][y];
                cells[x * size + y] = c === 'X' ? 1 : c === 'O' ? 2 : c === '#' ? 3 : 0;
            }
        }
        return { size, cells };
    }
    function cloneLocalBoard(b) {
        return { size: b.size, cells: new Int8Array(b.cells) };
    }
    function inBounds(b, x, y) { return x >= 0 && x < b.size && y >= 0 && y < b.size; }

    /** BFS chain from (x,y). Returns {stones:[[x,y]...], libs:int, color:int} or null. */
    function findChain(b, x, y, scratch) {
        const size = b.size;
        const start = x * size + y;
        const color = b.cells[start];
        if (color === 0 || color === 3) return null;
        const visited = scratch || new Uint8Array(size * size);
        const stones = [];
        const libSet = new Set();
        const stack = [start];
        visited[start] = 1;
        while (stack.length) {
            const idx = stack.pop();
            const cx = (idx / size) | 0, cy = idx % size;
            stones.push([cx, cy]);
            const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
            for (const [nx, ny] of neighbors) {
                if (!inBounds(b, nx, ny)) continue;
                const ni = nx * size + ny;
                if (visited[ni]) continue;
                const nc = b.cells[ni];
                if (nc === 0) libSet.add(ni);
                else if (nc === color) {
                    visited[ni] = 1;
                    stack.push(ni);
                }
            }
        }
        return { stones, libs: libSet.size, color };
    }

    /** Apply move in-place. Returns capture count, or -1 if illegal (suicide). */
    function tryMoveLocal(b, x, y, color) {
        const size = b.size;
        const i = x * size + y;
        if (b.cells[i] !== 0) return -1;
        const opp = color === 1 ? 2 : 1;
        b.cells[i] = color;

        // Capture opponent chains with 0 libs
        let captured = 0;
        const removed = [];
        const visited = new Uint8Array(size * size);
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neighbors) {
            if (!inBounds(b, nx, ny)) continue;
            const ni = nx * size + ny;
            if (visited[ni] || b.cells[ni] !== opp) continue;
            const chain = findChain(b, nx, ny, visited);
            if (chain.libs === 0) {
                for (const [sx, sy] of chain.stones) {
                    const ri = sx * size + sy;
                    removed.push(ri);
                    b.cells[ri] = 0;
                }
                captured += chain.stones.length;
            }
        }

        // Suicide check
        const myChain = findChain(b, x, y);
        if (myChain.libs === 0) {
            // Undo
            b.cells[i] = 0;
            for (const ri of removed) b.cells[ri] = opp;
            return -1;
        }
        return captured;
    }

    /** Analyze all chains: returns chainOf[idx]=chainId, plus per-chain libs/size/color. */
    function analyzeChains(b) {
        const size = b.size;
        const chainOf = new Int16Array(size * size).fill(-1);
        const chainLibs = [];
        const chainSize = [];
        const chainColor = [];
        let id = 0;
        const visited = new Uint8Array(size * size);
        for (let i = 0; i < size * size; i++) {
            if (chainOf[i] !== -1) continue;
            const c = b.cells[i];
            if (c === 0 || c === 3) continue;
            const x = (i / size) | 0, y = i % size;
            const localVisited = new Uint8Array(size * size);
            const chain = findChain(b, x, y, localVisited);
            for (const [sx, sy] of chain.stones) chainOf[sx * size + sy] = id;
            chainLibs.push(chain.libs);
            chainSize.push(chain.stones.length);
            chainColor.push(c);
            id++;
        }
        return { chainOf, chainLibs, chainSize, chainColor, count: id };
    }

    // ============================================================
    // STATIC EVALUATION (from X's perspective)
    // ============================================================
    function evaluate(b) {
        const size = b.size;
        const a = analyzeChains(b);
        let xStones = 0, oStones = 0, xLibs = 0, oLibs = 0;
        let xAtariStones = 0, oAtariStones = 0;
        let xTwoLibStones = 0, oTwoLibStones = 0;
        for (let cid = 0; cid < a.count; cid++) {
            const sz = a.chainSize[cid], lb = a.chainLibs[cid];
            if (a.chainColor[cid] === 1) {
                xStones += sz; xLibs += lb;
                if (lb === 1) xAtariStones += sz;
                else if (lb === 2) xTwoLibStones += sz;
            } else {
                oStones += sz; oLibs += lb;
                if (lb === 1) oAtariStones += sz;
                else if (lb === 2) oTwoLibStones += sz;
            }
        }
        // Territory: empty points adjacent only to one color
        let xTerr = 0, oTerr = 0;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (b.cells[x * size + y] !== 0) continue;
                let touchX = false, touchO = false;
                if (x > 0) { const c = b.cells[(x - 1) * size + y]; if (c === 1) touchX = true; else if (c === 2) touchO = true; }
                if (x < size - 1) { const c = b.cells[(x + 1) * size + y]; if (c === 1) touchX = true; else if (c === 2) touchO = true; }
                if (y > 0) { const c = b.cells[x * size + (y - 1)]; if (c === 1) touchX = true; else if (c === 2) touchO = true; }
                if (y < size - 1) { const c = b.cells[x * size + (y + 1)]; if (c === 1) touchX = true; else if (c === 2) touchO = true; }
                if (touchX && !touchO) xTerr++;
                else if (touchO && !touchX) oTerr++;
            }
        }
        return (xStones - oStones) * 1.0
            + (xLibs - oLibs) * 0.25
            + (oAtariStones - xAtariStones) * 6.0
            + (oTwoLibStones - xTwoLibStones) * 1.0
            + (xTerr - oTerr) * 0.6;
    }

    function hasAtari(b) {
        const a = analyzeChains(b);
        for (let cid = 0; cid < a.count; cid++) {
            if (a.chainLibs[cid] === 1) return true;
        }
        return false;
    }

    // ============================================================
    // MOVE GENERATION + ORDERING
    // ============================================================
    /** Generate legal-ish moves with priority for ordering.
     *  At root, filters by ns.go validMove (handles ko correctly).
     *  Inside search, only suicide-checks via tryMove during recursion.
     */
    function generateOrderedMoves(b, color, isRoot = false) {
        const size = b.size;
        const opp = color === 1 ? 2 : 1;
        const a = analyzeChains(b);
        const moves = [];

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const i = x * size + y;
                if (b.cells[i] !== 0) continue;
                if (isRoot && !validMove[x][y]) continue;

                let captureSize = 0, saveSize = 0;
                let touchOwn = 0, touchOpp = 0, touchEmpty = 0;
                let oppMinLibs = 999, ownMinLibs = 999;

                if (x > 0) {
                    const ni = (x - 1) * size + y, nc = b.cells[ni];
                    if (nc === 0) touchEmpty++;
                    else if (nc === color) {
                        touchOwn++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) saveSize = Math.max(saveSize, a.chainSize[cid]);
                        if (lb < ownMinLibs) ownMinLibs = lb;
                    } else if (nc === opp) {
                        touchOpp++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) captureSize = Math.max(captureSize, a.chainSize[cid]);
                        if (lb < oppMinLibs) oppMinLibs = lb;
                    }
                }
                if (x < size - 1) {
                    const ni = (x + 1) * size + y, nc = b.cells[ni];
                    if (nc === 0) touchEmpty++;
                    else if (nc === color) {
                        touchOwn++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) saveSize = Math.max(saveSize, a.chainSize[cid]);
                        if (lb < ownMinLibs) ownMinLibs = lb;
                    } else if (nc === opp) {
                        touchOpp++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) captureSize = Math.max(captureSize, a.chainSize[cid]);
                        if (lb < oppMinLibs) oppMinLibs = lb;
                    }
                }
                if (y > 0) {
                    const ni = x * size + (y - 1), nc = b.cells[ni];
                    if (nc === 0) touchEmpty++;
                    else if (nc === color) {
                        touchOwn++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) saveSize = Math.max(saveSize, a.chainSize[cid]);
                        if (lb < ownMinLibs) ownMinLibs = lb;
                    } else if (nc === opp) {
                        touchOpp++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) captureSize = Math.max(captureSize, a.chainSize[cid]);
                        if (lb < oppMinLibs) oppMinLibs = lb;
                    }
                }
                if (y < size - 1) {
                    const ni = x * size + (y + 1), nc = b.cells[ni];
                    if (nc === 0) touchEmpty++;
                    else if (nc === color) {
                        touchOwn++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) saveSize = Math.max(saveSize, a.chainSize[cid]);
                        if (lb < ownMinLibs) ownMinLibs = lb;
                    } else if (nc === opp) {
                        touchOpp++;
                        const cid = a.chainOf[ni];
                        const lb = a.chainLibs[cid];
                        if (lb === 1) captureSize = Math.max(captureSize, a.chainSize[cid]);
                        if (lb < oppMinLibs) oppMinLibs = lb;
                    }
                }

                // Skip own-eye fills (no empty neighbor, all own, not capturing, not saving)
                if (touchEmpty === 0 && touchOpp === 0 && captureSize === 0 && saveSize === 0 && touchOwn > 0) continue;

                // Priority: captures >> saves >> attacks >> connects >> rest
                let priority = 0;
                priority += captureSize * 10000;
                priority += saveSize * 5000;
                if (oppMinLibs <= 2 && oppMinLibs < 999) priority += (3 - oppMinLibs) * 200;
                if (ownMinLibs <= 2 && ownMinLibs < 999) priority += (3 - ownMinLibs) * 100;
                priority += touchEmpty * 5;
                priority += touchOwn * 2;

                moves.push({ x, y, priority });
            }
        }
        moves.sort((a, b) => b.priority - a.priority);
        return moves;
    }

    // ============================================================
    // NEGAMAX + ALPHA-BETA + ITERATIVE DEEPENING + QUIESCENCE
    // ============================================================
    let searchDeadline = 0;
    let searchAborted = false;
    let nodesSearched = 0;

    function negamax(b, depth, alpha, beta, color, qExtensionsLeft) {
        if ((nodesSearched & 1023) === 0 && performance.now() > searchDeadline) {
            searchAborted = true;
            return 0;
        }
        nodesSearched++;

        if (depth <= 0) {
            // Quiescence: extend if there's atari
            if (qExtensionsLeft > 0 && hasAtari(b)) {
                depth = 1;
                qExtensionsLeft--;
            } else {
                const e = evaluate(b);
                return color === 1 ? e : -e;
            }
        }

        const moves = generateOrderedMoves(b, color, false);
        if (moves.length === 0) {
            const e = evaluate(b);
            return color === 1 ? e : -e;
        }

        // Cap branching at deeper plies to keep search tractable on 13x13
        const branchCap = depth <= 1 ? 24 : depth === 2 ? 16 : 12;
        const cappedMoves = moves.length > branchCap ? moves.slice(0, branchCap) : moves;

        let best = -Infinity;
        for (const m of cappedMoves) {
            const child = cloneLocalBoard(b);
            if (tryMoveLocal(child, m.x, m.y, color) === -1) continue;
            const score = -negamax(child, depth - 1, -beta, -alpha, color === 1 ? 2 : 1, qExtensionsLeft);
            if (searchAborted) return 0;
            if (score > best) best = score;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best === -Infinity ? (color === 1 ? evaluate(b) : -evaluate(b)) : best;
    }

    function searchRoot(b, depth, color) {
        const moves = generateOrderedMoves(b, color, true);
        if (moves.length === 0) return null;
        let bestMove = null;
        let bestScore = -Infinity;
        let alpha = -Infinity;
        const beta = Infinity;
        for (const m of moves) {
            const child = cloneLocalBoard(b);
            if (tryMoveLocal(child, m.x, m.y, color) === -1) continue;
            const score = -negamax(child, depth - 1, -beta, -alpha, color === 1 ? 2 : 1, 2);
            if (searchAborted) return bestMove ? { move: bestMove, score: bestScore, complete: false } : null;
            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
            }
            if (score > alpha) alpha = score;
        }
        return { move: bestMove, score: bestScore, complete: true };
    }

    /** @param {NS} ns */
    function runSearch(ns) {
        const localBoard = buildLocalBoard(board);
        searchDeadline = performance.now() + timeBudgetMs;
        searchAborted = false;
        nodesSearched = 0;

        let best = null;
        let reachedDepth = 0;
        for (let d = 1; d <= maxDepth; d++) {
            const result = searchRoot(localBoard, d, 1);
            if (!result) break;
            if (result.complete) {
                best = result;
                reachedDepth = d;
            } else {
                // Partial: keep prior depth's result if better than nothing
                if (!best && result.move) best = result;
                break;
            }
            // If we already used >60% of the budget, don't start the next iteration
            if (performance.now() - (searchDeadline - timeBudgetMs) > timeBudgetMs * 0.6) break;
        }

        if (!best || !best.move) return null;
        if (logSearch) {
            ns.printf("Search d=%d score=%.2f nodes=%d move=(%d,%d)",
                reachedDepth, best.score, nodesSearched, best.move.x, best.move.y);
        }
        return {
            coords: [best.move.x, best.move.y],
            msg: `Search d=${reachedDepth} score=${best.score.toFixed(2)}`
        };
    }

    // ============================================================
    // KEPT HEURISTICS: cheap/forced moves + patterns
    // ============================================================
    /** Counter-lib: friendly chain at 1 lib has an enemy neighbor also at 1 lib we can capture. */
    function getRandomCounterLib() {
        const size = board[0].length;
        const moves = getAllValidMoves();
        const movesAvailable = new Set();
        const friendlyToCheckForOpp = new Set();
        for (const [x, y] of moves) {
            if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === "X") {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x - 1, y]));
            }
            if (x < size - 1 && validLibMoves[x + 1][y] === 1 && board[x + 1][y] === "X") {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x + 1, y]));
            }
            if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === "X") {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x, y - 1]));
            }
            if (y < size - 1 && validLibMoves[x][y + 1] === 1 && board[x][y + 1] === "X") {
                movesAvailable.add(JSON.stringify([x, y]));
                friendlyToCheckForOpp.add(JSON.stringify([x, y + 1]));
            }
        }
        for (const explore of movesAvailable) {
            const [fx, fy] = JSON.parse(explore);
            if (!validMove[fx][fy]) continue;
            if (fx < size - 1 && board[fx + 1][fy] === "O" && validLibMoves[fx + 1][fy] === 1) return { coords: [fx, fy], msg: "Counter-Lib (E)" };
            if (fx > 0 && board[fx - 1][fy] === "O" && validLibMoves[fx - 1][fy] === 1) return { coords: [fx, fy], msg: "Counter-Lib (W)" };
            if (fy > 0 && board[fx][fy - 1] === "O" && validLibMoves[fx][fy - 1] === 1) return { coords: [fx, fy], msg: "Counter-Lib (S)" };
            if (fy < size - 1 && board[fx][fy + 1] === "O" && validLibMoves[fx][fy + 1] === 1) return { coords: [fx, fy], msg: "Counter-Lib (N)" };
        }
        // Extended search: friendly chain reachable through other friendlies has a killable enemy neighbor
        const enemiesToSearch = new Set();
        for (const explore of friendlyToCheckForOpp) {
            const [fx, fy] = JSON.parse(explore);
            if (fx < size - 1 && board[fx + 1][fy] === "O" && validLibMoves[fx + 1][fy] === 1) enemiesToSearch.add(JSON.stringify([fx + 1, fy]));
            if (fx > 0 && board[fx - 1][fy] === "O" && validLibMoves[fx - 1][fy] === 1) enemiesToSearch.add(JSON.stringify([fx - 1, fy]));
            if (fy > 0 && board[fx][fy - 1] === "O" && validLibMoves[fx][fy - 1] === 1) enemiesToSearch.add(JSON.stringify([fx, fy - 1]));
            if (fy < size - 1 && board[fx][fy + 1] === "O" && validLibMoves[fx][fy + 1] === 1) enemiesToSearch.add(JSON.stringify([fx, fy + 1]));
            if (fx < size - 1 && board[fx + 1][fy] === "X") friendlyToCheckForOpp.add(JSON.stringify([fx + 1, fy]));
            if (fx > 0 && board[fx - 1][fy] === "X") friendlyToCheckForOpp.add(JSON.stringify([fx - 1, fy]));
            if (fy > 0 && board[fx][fy - 1] === "X") friendlyToCheckForOpp.add(JSON.stringify([fx, fy - 1]));
            if (fy < size - 1 && board[fx][fy + 1] === "X") friendlyToCheckForOpp.add(JSON.stringify([fx, fy + 1]));
        }
        for (const explore of enemiesToSearch) {
            const [fx, fy] = JSON.parse(explore);
            if (fx < size - 1 && board[fx + 1][fy] === "O") enemiesToSearch.add(JSON.stringify([fx + 1, fy]));
            if (fx > 0 && board[fx - 1][fy] === "O") enemiesToSearch.add(JSON.stringify([fx - 1, fy]));
            if (fy > 0 && board[fx][fy - 1] === "O") enemiesToSearch.add(JSON.stringify([fx, fy - 1]));
            if (fy < size - 1 && board[fx][fy + 1] === "O") enemiesToSearch.add(JSON.stringify([fx, fy + 1]));
            if (fx < size - 1 && board[fx + 1][fy] === "." && validMove[fx + 1][fy]) return { coords: [fx + 1, fy], msg: "Counter-Lib ext (E)" };
            if (fx > 0 && board[fx - 1][fy] === "." && validMove[fx - 1][fy]) return { coords: [fx - 1, fy], msg: "Counter-Lib ext (W)" };
            if (fy > 0 && board[fx][fy - 1] === "." && validMove[fx][fy - 1]) return { coords: [fx, fy - 1], msg: "Counter-Lib ext (S)" };
            if (fy < size - 1 && board[fx][fy + 1] === "." && validMove[fx][fy + 1]) return { coords: [fx, fy + 1], msg: "Counter-Lib ext (N)" };
        }
        return [];
    }

    /** Snake-eyes cheat: kill 2-eyed enemy chain (size >= minKilled) with two cheat-placed stones. */
    function getSnakeEyes(minKilled = 5) {
        if (!cheats) return [];
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 1;
        const checked = new Set();
        for (let x = 0; x < size - 1; x++) {
            for (let y = 0; y < size - 1; y++) {
                if (contested[x][y] === "X" || board[x][y] !== "O" || validLibMoves[x][y] !== 2 || checked.has(JSON.stringify([x, y]))) continue;
                const chain = getChainValueLegacy(x, y, "O");
                if (chain < minKilled) continue;
                checked.add(JSON.stringify([x, y]));
                const enemySearch = new Set();
                const move1 = [], move2 = [];
                enemySearch.add(JSON.stringify([x, y]));
                for (const explore of enemySearch) {
                    const [fx, fy] = JSON.parse(explore);
                    if (board[fx][fy] === ".") {
                        (move1.length ? move2 : move1).push([fx, fy]);
                        checked.add(JSON.stringify([fx, fy]));
                        continue;
                    }
                    if (fx < size - 1 && ["O", "."].includes(board[fx + 1][fy])) { enemySearch.add(JSON.stringify([fx + 1, fy])); checked.add(JSON.stringify([fx, fy])); }
                    if (fx > 0 && ["O", "."].includes(board[fx - 1][fy])) { enemySearch.add(JSON.stringify([fx - 1, fy])); checked.add(JSON.stringify([fx, fy])); }
                    if (fy > 0 && ["O", "."].includes(board[fx][fy - 1])) { enemySearch.add(JSON.stringify([fx, fy - 1])); checked.add(JSON.stringify([fx, fy])); }
                    if (fy < size - 1 && ["O", "."].includes(board[fx][fy + 1])) { enemySearch.add(JSON.stringify([fx, fy + 1])); checked.add(JSON.stringify([fx, fy])); }
                }
                if (chain > highValue) {
                    highValue = chain;
                    moveOptions.length = 0;
                    const m1 = move1.pop(), m2 = move2.pop();
                    if (m1 && m2) moveOptions.push([m1[0], m1[1], m2[0], m2[1]]);
                } else if (chain === highValue) {
                    const m1 = move1.pop(), m2 = move2.pop();
                    if (m1 && m2) moveOptions.push([m1[0], m1[1], m2[0], m2[1]]);
                }
            }
        }
        const idx = Math.floor(Math.random() * moveOptions.length);
        return moveOptions[idx] ? { coords: moveOptions[idx], msg: "SnakeEyes Cheat" } : [];
    }

    // Legacy chain value (used only by snake-eyes; needs the contested[] array semantics)
    function getChainValueLegacy(checkx, checky, player) {
        const size = board[0].length;
        const otherPlayer = player === "X" ? "O" : "X";
        const explored = new Set();
        if (contested[checkx][checky] === "?" || board[checkx][checky] === otherPlayer) return 0;
        if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
        if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
        let count = 1;
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore);
            if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue;
            count++;
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
            if (x > 0) explored.add(JSON.stringify([x - 1, y]));
            if (y > 0) explored.add(JSON.stringify([x, y - 1]));
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
        }
        return count;
    }

    // ---- Pattern matching (kept) ----
    function isPattern(x, y, pattern) {
        const size = testBoard[0].length;
        const patterns = getAllPatterns(pattern);
        const patternSize = pattern.length;
        for (const patternCheck of patterns) {
            for (let cx = ((patternSize - 1) * -1); cx <= 0; cx++) {
                if (cx + x + 1 < 0 || cx + x + 1 > size - 1) continue;
                for (let cy = ((patternSize - 1) * -1); cy <= 0 - 1; cy++) {
                    if (cy + y + 1 < 0 || cy + y + 1 > size - 1) continue;
                    let count = 0, abort = false;
                    for (let px = 0; px < patternSize && !abort; px++) {
                        if (x + cx + px + 1 < 0 || x + cx + px + 1 >= size) { abort = true; break; }
                        for (let py = 0; py < patternSize && !abort; py++) {
                            if (y + cy + py + 1 < 0 || y + cy + py + 1 >= size) { abort = true; break; }
                            if (cx + px === 0 && cy + py === 0 && !["X", "*"].includes(patternCheck[px][py])) { abort = true; break; }
                            if (cx + px === 0 && cy + py === 0 && ["X"].includes(contested[x][y]) && patternCheck[px][py] !== "*") { abort = true; break; }
                            const cell = testBoard[cx + x + 1 + px][cy + y + 1 + py];
                            switch (patternCheck[px][py]) {
                                case "X":
                                    if (cell === "X" || (cx + px === 0 && cy + py === 0 && cell === ".")) count++;
                                    else if (cx + px === 0 && cy + py === 0) count++;
                                    else abort = true;
                                    break;
                                case "*":
                                    if (cell === "." && cx + px === 0 && cy + py === 0) count++;
                                    else abort = true;
                                    break;
                                case "O": if (cell === "O") count++; else abort = true; break;
                                case "x": if (["X", "."].includes(cell)) count++; else abort = true; break;
                                case "o": if (["O", "."].includes(cell)) count++; else abort = true; break;
                                case "?": count++; break;
                                case ".": if (cell === ".") count++; else abort = true; break;
                                case "W": if (["W", "#"].includes(cell)) count++; else abort = true; break;
                                case "B": if (["W", "#", "X"].includes(cell)) count++; else abort = true; break;
                                case "b": if (["W", "#", "O"].includes(cell)) count++; else abort = true; break;
                                case "A": if (["W", "#", "X", "O"].includes(cell)) count++; else abort = true; break;
                            }
                            if (count === patternSize * patternSize) return true;
                        }
                    }
                }
            }
        }
        return false;
    }
    function getAllPatterns(pattern) {
        const r = [pattern, rotate90(pattern), rotate90(rotate90(pattern)), rotate90(rotate90(rotate90(pattern)))];
        return [...r, ...r.map(p => p.toReversed())];
    }
    function rotate90(pattern) {
        return pattern.map((_, i) => pattern.map(row => row[i]).reverse().join(""));
    }

    function disruptEyes() {
        const all = [...disrupt4, ...disrupt5];
        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            for (const pattern of all) {
                if (isPattern(x, y, pattern)) {
                    return { coords: [x, y], msg: `Eye Disruption (${pattern.length}x${pattern.length})` };
                }
            }
        }
        return [];
    }
    function getDefPattern() {
        const moves = getAllValidMoves();
        for (const [x, y] of moves) {
            for (const pattern of def5) {
                if (isPattern(x, y, pattern)) {
                    return { coords: [x, y], msg: `Def Pattern (${pattern.length}x${pattern.length})` };
                }
            }
        }
        return [];
    }

    // ---- Move execution helpers ----
    async function movePiece(ns, attack) {
        if (!attack || attack.coords === undefined) return false;
        const [x, y] = attack.coords;
        if (x === undefined) return false;
        const mid = performance.now();
        ns.printf("%s", attack.msg);
        const results = await go_makeMove(ns, x, y);
        const END = performance.now();
        if (logtime) ns.printf("Time: Me: %s  Them: %s", formatTime(ns, mid - START, true), formatTime(ns, END - mid, true));
        START = performance.now();
        return results;
    }
    async function moveSnakeEyes(ns, attack) {
        if (!attack || attack.coords === undefined || !cheats) return false;
        const [s1x, s1y, s2x, s2y] = attack.coords;
        if (s1x === undefined) return false;
        const chance = await go_cheat_getCheatSuccessChance(ns);
        if (chance < cheatChanceThreshold) return false;
        try {
            const mid = performance.now();
            const results = await go_cheat_playTwoMoves(ns, s1x, s1y, s2x, s2y);
            ns.printf("%s  Chance: %.2f%%  Result: %s", attack.msg, chance * 100, results.type);
            const END = performance.now();
            if (logtime) ns.printf("Time: Me: %s  Them: %s", formatTime(ns, mid - START, true), formatTime(ns, END - mid, true));
            START = performance.now();
            return results;
        } catch { return false; }
    }

    function getAllValidMoves() {
        const moves = [];
        for (let x = 0; x < board[0].length; x++)
            for (let y = 0; y < board[0].length; y++)
                if (validMove[x][y]) moves.push([x, y]);
        return moves.sort(() => Math.random() - 0.5);
    }

    /** Random safe move fallback (no self-atari, prefers expansion). */
    function getRandomSafe() {
        const localBoard = buildLocalBoard(board);
        const candidates = generateOrderedMoves(localBoard, 1, true);
        for (const m of candidates) {
            const trial = cloneLocalBoard(localBoard);
            if (tryMoveLocal(trial, m.x, m.y, 1) === -1) continue;
            // Reject self-atari fallback
            const a = analyzeChains(trial);
            const cid = a.chainOf[m.x * trial.size + m.y];
            if (cid !== -1 && a.chainLibs[cid] === 1) continue;
            return { coords: [m.x, m.y], msg: "Fallback Safe" };
        }
        // Truly desperate
        for (const m of candidates) {
            const trial = cloneLocalBoard(localBoard);
            if (tryMoveLocal(trial, m.x, m.y, 1) !== -1) return { coords: [m.x, m.y], msg: "Fallback Any" };
        }
        return [];
    }

    /** Opening moves (kept). */
    function getOpeningMove() {
        const size = board[0].length;
        const tryPoint = (x, y) => {
            if (x < 0 || y < 0 || x >= size || y >= size) return null;
            if (!validMove[x][y]) return null;
            // "open corner" check: 4 empty neighbors
            let open = 0;
            if (x > 0 && board[x - 1][y] === ".") open++;
            if (x < size - 1 && board[x + 1][y] === ".") open++;
            if (y > 0 && board[x][y - 1] === ".") open++;
            if (y < size - 1 && board[x][y + 1] === ".") open++;
            if (open === 4) return { coords: [x, y], msg: `Opening Move: ${turn}` };
            return null;
        };
        const points = {
            13: [[2,2],[2,10],[10,10],[10,2],[3,3],[3,9],[9,9],[9,3],[4,4],[4,8],[8,8],[8,4]],
            9:  [[2,2],[2,6],[6,6],[6,2],[3,3],[3,5],[5,5],[5,3]],
            7:  [[2,2],[2,4],[4,4],[4,2],[3,3],[1,1],[5,1],[5,5],[1,5]],
            5:  [[2,2],[3,3],[3,1],[1,3],[1,1]],
            19: [[9,9],[2,2],[16,2],[2,16],[16,16],[3,3],[3,15],[15,15],[15,3],[4,4],[4,14],[14,14],[14,4]],
        };
        const list = points[size] || [];
        for (const [x, y] of list) {
            const r = tryPoint(x, y);
            if (r) return r;
        }
        return getRandomSafe();
    }
}
