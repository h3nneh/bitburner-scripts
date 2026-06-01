//Puppet2 batcher by Sphyxis (https://github.com/Sphyxis/SphyxOS) - ported into this repo.
//Self-contained single-target saturation HWGW batcher. Run standalone: `run puppet.js [target] [flags]`
//Flags: usehacknet nopurchase autohash autobuyhacknet
const WORKER_W = "puppet-weaken.js"
const WORKER_G = "puppet-grow.js"
const WORKER_H = "puppet-hack.js"
/** @type {Server[]} baseServers */
let baseServers;
let servers; //Utilized by server run
let batchServers; //Utilized by server run
//For the tail logs:
/** @type {Server} TARGET */
let TARGET = "" //Who you are hacking
/** @type {Server} NEXTTARGET */
let NEXTTARGET = "" //Whos next up
let TARGETUPDATE = false
let ZERGSTATUS = false
let ZERGSENT = 0
let ZERGREQUIRED = -1
let RECALC_GOOD = false
let RECALC_BAD = false
let PORTS_OPEN = 0
let BMODE = "B" //Batch mode:  b is not batching,  B is batching
let THREADSLEFT = 0 //Total threads used
let THREADSMAX = 0 //Total threads available
let BATCHESTOTAL = 0 //Total batches done
let BATCHESRUN = 0 //Actual batches run
let PREPW1 = 0 //Prep wave
let PREPG1 = 0
let PREPW2 = 0
let PREPH1 = 1
let PREPW3 = 0
let PREPG2 = 0
let PREPW4 = 0
let BATCHINFO;
let STARTTIME = 0
let ENDTIME = 0
let BETWEENSTART = 0
let BETWEENEND = 0
let HACKTIME = 0
let WEAKENTIME = 0
let USEHACKNET = false
let PURCHASE = true
let AUTOHASH = false
let AUTOBUYHACKNET = false
let AUTOHASHTIMER = Number.POSITIVE_INFINITY
const RESERVERAM = 32

//Configuration
let lastpid = 0
let weakenStrength

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  const QUIET = ns.args.includes("quiet")
  if (!QUIET) ns.ui.openTail()
  USEHACKNET = ns.args.includes("usehacknet")
  PURCHASE = !ns.args.includes("nopurchase")
  AUTOHASH = ns.args.includes("autohash") && hasBN(ns, 9)
  AUTOBUYHACKNET = ns.args.includes("autobuyhacknet")
  if (AUTOBUYHACKNET) AUTOHASHTIMER = (1000 * 60 * 15) + performance.now()
  virus(ns)
  init(ns)
  await writeFiles(ns)
  /**@type {Player} player */
  let player = ns.getPlayer()
  const basicservers = getServersLight(ns)
  if (ns.args[0] && basicservers.includes(ns.args[0]))
    TARGET = ns.getServer(ns.args[0])
  else if (player.skills.hacking < 10) TARGET = ns.getServer("n00dles")
  else TARGET = getOptimalTarget(ns)
  NEXTTARGET = TARGET

  //Get the batch info.  Contains: H1 W1 G1 W2 Type Take HackP
  BATCHINFO = getHackP(ns, TARGET, -1, -1, 1)
  let spending = true
  let new_ports_open = 0
  let overflowed = false
  while (true) {
    TARGET = ns.getServer(TARGET.hostname)
    //Calc wave
    const wavew1 = Math.ceil((TARGET.hackDifficulty - TARGET.minDifficulty) / weakenStrength)
    const waveg1 = Math.ceil(getGrowThreads(ns, TARGET.hostname, TARGET.moneyAvailable, TARGET.minDifficulty))

    //Refresh times.  Hack Time is the constant for that.  3.2x for Grow, 4x for Weaken
    HACKTIME = ns.getHackTime(TARGET.hostname)
    WEAKENTIME = HACKTIME * 4
    //Refresh base servers
    baseServers = getServers(ns)
    //Get thread information
    THREADSLEFT = 0 //Reserved?
    for (const server of baseServers) {
      if (server.hostname.startsWith("hacknet") && !USEHACKNET) continue
      if (server.hasAdminRights && server.maxRam > 0) {
        let tmpramavailable = getServerAvailRam(ns, server.hostname)
        if (server.hostname === "home") tmpramavailable = Math.max(tmpramavailable - RESERVERAM, 0)
        let tmpthreads = Math.floor(tmpramavailable / 1.75)
        THREADSLEFT += tmpthreads
      }
    }
    THREADSMAX = THREADSLEFT

    //Figure out how many threads to assign to the wave, and where they will go for best usage.
    //First weaken
    if (wavew1 > THREADSLEFT) { //We need too many!
      PREPW1 = THREADSLEFT
      THREADSLEFT = 0
    }
    else { //Enough to fit
      PREPW1 = wavew1
      THREADSLEFT -= PREPW1  //Could be as low as 0 now
    }

    // If we have threads left, move on to Grow/Weaken
    PREPW2 = 0
    PREPG1 = 0
    if (waveg1 > THREADSLEFT) { //We need more grow than we can handle
      PREPW2 = Math.ceil((THREADSLEFT * .004) / weakenStrength) //Figure out how many weaken threads we need to accomodate the highest
      PREPG1 = THREADSLEFT - PREPW2 //Fill in as many grows as can fit now
      THREADSLEFT = 0
    }
    else { //We can handle the total grow threads, but can we handle it with weaken?
      PREPW2 = Math.ceil((waveg1 * .004) / weakenStrength) //total weakens we need for a full grow
      if (PREPW2 + waveg1 <= THREADSLEFT) {//We have enough for both grow and weaken!
        PREPG1 = waveg1
        THREADSLEFT -= PREPG1 + PREPW2 //Could be as low as 0 now
      }
      else { //We don't have enough.  Calculate optimal
        const growP = .004 / weakenStrength
        const remainder = waveg1 + PREPW2 - THREADSLEFT
        const weakremove = Math.floor(remainder * growP)
        const growremove = remainder - weakremove
        PREPG1 = waveg1 - growremove
        PREPW2 -= weakremove
        THREADSLEFT = 0
      }
    }

    //If we have threads left, move on to Hack/Weaken
    PREPW3 = 0
    PREPH1 = 0
    if (BATCHINFO.H1 > THREADSLEFT) { //We don't have enough to fully hack!
      PREPW3 = Math.floor((THREADSLEFT * .002) / weakenStrength)
      PREPH1 = THREADSLEFT - PREPW3
      THREADSLEFT = 0
    }
    else { //We can handle the total hack threads, but what about the weakens it produces?
      PREPW3 = Math.ceil((BATCHINFO.H1 * .002) / weakenStrength)
      if (PREPW3 + BATCHINFO.H1 <= THREADSLEFT) { //We have enough for both hack and weaken
        PREPH1 = BATCHINFO.H1
        THREADSLEFT -= PREPH1 + PREPW3
      }
      else { //We don'thave enough.  Calculate optimal
        const hackP = .002 / weakenStrength
        const remainder = BATCHINFO.H1 + PREPW3 - THREADSLEFT
        const weakenremove = Math.floor(remainder * hackP)
        const hackremove = remainder - weakenremove
        PREPH1 = BATCHINFO.H1 - hackremove
        PREPW3 -= weakenremove
        THREADSLEFT = 0
      }
    }

    // If we have threads left, move on to Grow/Weaken
    PREPW4 = 0
    PREPG2 = 0
    if (BATCHINFO.G1 > THREADSLEFT) { //We need more grow than we can handle
      PREPW4 = Math.ceil((THREADSLEFT * .004) / weakenStrength) //Figure out how many weaken threads we need to accomodate the highest
      PREPG2 = THREADSLEFT - PREPW4 //Fill in as many grows as can fit now
      THREADSLEFT = 0
    }
    else { //We can handle the total grow threads, but can we handle it with weaken?
      PREPW4 = Math.ceil((BATCHINFO.G1 * .004) / weakenStrength) //total weakens we need for a full grow
      if (PREPW4 + BATCHINFO.G1 <= THREADSLEFT) {//We have enough for both grow and weaken!
        PREPG2 = BATCHINFO.G1
        THREADSLEFT -= PREPG2 + PREPW4 //Could be as low as 0 now
      }
      else { //We don't have enough.  Calculate optimal
        const growP = .004 / weakenStrength
        const remainder = BATCHINFO.G1 + PREPW4 - THREADSLEFT
        const weakremove = Math.floor(remainder * growP)
        const growremove = remainder - weakremove
        PREPG2 = BATCHINFO.G1 - growremove
        PREPW4 -= weakremove
        THREADSLEFT = 0
      }
    }
    BATCHESTOTAL = Math.floor(THREADSLEFT / (BATCHINFO.H1 + BATCHINFO.W1 + BATCHINFO.G1 + BATCHINFO.W2))
    if (ZERGSTATUS && ZERGREQUIRED !== ZERGSENT) BATCHESTOTAL = Math.max(BATCHESTOTAL - 2, 0) //Reserve a few batches to send as zerglings

    BETWEENEND = performance.now()
    STARTTIME = performance.now()
    //Start it all and get the results
    const results = await serverRun(ns, TARGET.hostname, PREPW1, PREPG1, PREPW2, PREPH1, PREPW3, PREPG2, PREPW4, BATCHINFO.H1, BATCHINFO.W1, BATCHINFO.G1, BATCHINFO.W2, BATCHESTOTAL, !USEHACKNET)
    ENDTIME = performance.now()

    lastpid = results.lastpid
    RECALC_BAD = results.recalc
    BATCHESRUN = results.batches
    BMODE = results.batching ? "B" : "b"
    THREADSLEFT -= (BATCHINFO.H1 + BATCHINFO.W1 + BATCHINFO.G1 + BATCHINFO.W2) * BATCHESRUN //Includes the wave as a batch
    if (ZERGSTATUS && ZERGREQUIRED !== ZERGSENT) await zerglings(ns, THREADSLEFT)  //If zerg is on, send the lings!

    //Now that we have the next batch ready, we wait...
    while (ns.isRunning(lastpid)) {
      await ns.sleep(20)
      update_hud(ns)
    }
    update_hud(ns)

    BETWEENSTART = performance.now()
    //If our hacking has gone up, recalculate
    /**@type {Player} player2 */
    const player2 = ns.getPlayer()
    if (PORTS_OPEN < 5) new_ports_open = getPortOpeners(ns)
    if (PURCHASE && spending) if (!serverPurchaser(ns)) spending = false
    if (AUTOHASH) {
      hashIt(ns, TARGET.hostname, "max")
      hashIt(ns, TARGET.hostname, "min")
    }
    if (AUTOBUYHACKNET && AUTOHASHTIMER <= performance.now()) {
      if (!hacknetPurchaser(ns)) AUTOHASHTIMER = Number.POSITIVE_INFINITY
      else AUTOHASHTIMER = performance.now() + (1000 * 60 * 15)
    }
    if (player2.skills.hacking > player.skills.hacking || PORTS_OPEN !== new_ports_open) {
      player = player2
      RECALC_GOOD = true
      TARGETUPDATE = true
      if (PORTS_OPEN !== new_ports_open) {
        PORTS_OPEN = new_ports_open
        virus(ns)
      }
    }

    if (NEXTTARGET.hostname === TARGET.hostname && TARGETUPDATE) { //Nexttarget is target.  We are open for a new target     
      /**@type {Server} upcoming */
      const upcoming = getOptimalTarget(ns)
      if (upcoming.hostname !== TARGET.hostname) { //We have an up and commer that's better.  Start zerglings
        NEXTTARGET = upcoming
        ZERGSTATUS = true
      }
      TARGETUPDATE = false
    }
    else if (NEXTTARGET.hostname !== TARGET.hostname && ns.getServerSecurityLevel(NEXTTARGET.hostname) === ns.getServerMinSecurityLevel(NEXTTARGET.hostname)) { //Ready for the change over
      TARGET = NEXTTARGET
      ZERGSTATUS = false
      ZERGSENT = 0
      ZERGREQUIRED = -1
      RECALC_BAD = false
      RECALC_GOOD = false
      //overflowed = false
      //Get the batch info.  Contains: H1 W1 G1 W2 Type Take HackP
      BATCHINFO = getHackP(ns, TARGET, -1, -1, 1)
      TARGETUPDATE = true
    }

    if (RECALC_BAD) {
      BATCHINFO = getHackP(ns, TARGET, BATCHESRUN, THREADSMAX, BATCHINFO.H1)
      RECALC_BAD = false
      overflowed = true
    }
    else if (RECALC_GOOD && !overflowed) {
      BATCHINFO = getHackP(ns, TARGET, -1, -1, 1)
      RECALC_GOOD = false
    }
    else BATCHINFO = getHackP(ns, TARGET, -1, -1, Math.max(BATCHINFO.H1 - 1, 1))
  }//while (true) loop
}

/** @param {NS} ns */
function update_hud(ns) {
  ns.clearLog()
  ns.printf("%s[%s] - (%s)", TARGET.hostname, BMODE, BATCHINFO.Type)
  if (TARGET.hostname !== NEXTTARGET.hostname) ns.printf("Next: %s  Zerglings: %s/%s", NEXTTARGET.hostname, ZERGSENT, ZERGREQUIRED)
  ns.printf("%s/%s(%s) Batches: %s  Take: $%s", THREADSMAX - THREADSLEFT, THREADSMAX, THREADSLEFT, BATCHESRUN + 1, ns.format.number(BATCHINFO.Take * (BATCHESRUN + 1) * PREPH1 / BATCHINFO.H1))
  ns.printf("HackP: %s%s ($%s/each)  Chance: %s%s", Math.round(BATCHINFO.HackP * 10000 * PREPH1) / 100, "%", ns.format.number(BATCHINFO.Take * PREPH1 / BATCHINFO.H1), ns.format.number(BATCHINFO.Chance * 100, 2), "%")
  ns.printf("Prep Wave: W:%s G:%s W:%s H:%s W:%s G:%s W:%s", PREPW1, PREPG1, PREPW2, PREPH1, PREPW3, PREPG2, PREPW4)
  ns.printf("Batching Composition: H:%s W:%s G:%s W:%s", BATCHINFO.H1, BATCHINFO.W1, BATCHINFO.G1, BATCHINFO.W2)
  ns.printf("%s  Countdown: %s", "$" + profitPerSecond(ns, WEAKENTIME, BATCHINFO.Take * BATCHINFO.H1 / PREPH1, BATCHESRUN + 1), ns.format.time((WEAKENTIME + ENDTIME) - performance.now()))
  ns.printf("Preptime : %s", ns.format.time(BETWEENEND - BETWEENSTART, true))
  ns.printf("Loadtime : %s", ns.format.time(ENDTIME - STARTTIME, true))
  ns.printf("Batchtime: %s", ns.format.time(WEAKENTIME, true))

  if (AUTOBUYHACKNET) ns.printf("Auto Buy Hash: %s", AUTOHASHTIMER - performance.now() > 0 ? ns.format.time(AUTOHASHTIMER - performance.now()) : "Next Up")
}

/** @param {NS} ns */
async function zerglings(ns, threads) {
  if (ZERGREQUIRED <= 0) ZERGREQUIRED = Math.ceil((NEXTTARGET.hackDifficulty - NEXTTARGET.minDifficulty) / weakenStrength) + 1
  if (ZERGSENT >= ZERGREQUIRED || threads === 0) return
  const weakthreadsneeded = Math.ceil((NEXTTARGET.hackDifficulty - NEXTTARGET.minDifficulty) / weakenStrength) + 1 - ZERGSENT
  const threadsthisround = weakthreadsneeded >= threads ? threads : weakthreadsneeded

  if (threadsthisround > 0) { //We are sending zerglings
    ZERGSENT += threadsthisround
    THREADSLEFT -= threadsthisround
    await serverRun(ns, NEXTTARGET.hostname, threadsthisround, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, !ns.args.includes("usehacknet"))
  }
}

/** @param {NS} ns **/
function virus(ns) {
  const servers = getServersLight(ns)
  for (const server of servers) {
    try { ns.brutessh(server) } catch { }
    try { ns.ftpcrack(server) } catch { }
    try { ns.relaysmtp(server) } catch { }
    try { ns.httpworm(server) } catch { }
    try { ns.sqlinject(server) } catch { }
    try {
      ns.nuke(server)
      ns.scp(WORKER_W, server, "home")
      ns.scp(WORKER_G, server, "home")
      ns.scp(WORKER_H, server, "home")

    }
    catch { }
  }
}

/** @param {NS} ns */
function getServersLight(ns) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }
  const serverDetails = []
  for (const server of serverList) {
    serverDetails.push(server)
  }
  return serverDetails
}

/** @param {NS} ns */
function getServers(ns, noHacknet = true) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }

  const serverDetails = []
  for (const server of serverList) {
    serverDetails.push(ns.getServer(server))
  }
  serverDetails.sort((a, b) => { return (a.maxRam - a.ramUsed) - (b.maxRam - b.ramUsed) })

  return serverDetails
}
/** @param {NS} ns */
function getServersSorted(ns, nohacknet) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }

  const serverDetails = []
  for (const server of serverList) {
    if (!ns.hasRootAccess(server)) continue
    if (server.startsWith("hacknet") && nohacknet) continue
    serverDetails.push(server)
  }
  serverDetails.sort((a, b) => { return (ns.getServerMaxRam(a) - ns.getServerUsedRam(a)) - (ns.getServerMaxRam(b) - ns.getServerUsedRam(b)) })

  return serverDetails
}
/** @param {NS} ns */
function getPortOpeners(ns) {
  let count = 0
  if (ns.fileExists("BruteSSH.exe", "home")) count++
  if (ns.fileExists("FTPCrack.exe", "home")) count++
  if (ns.fileExists("relaySMTP.exe", "home")) count++
  if (ns.fileExists("HTTPWorm.exe", "home")) count++
  if (ns.fileExists("SQLInject.exe", "home")) count++

  return count
}
/** @param {NS} ns */
export function getGrowThreads(ns, server, money, sec) {
  const player = ns.getPlayer()
  const host = ns.getServer(server)
  host.hackDifficulty = sec
  host.moneyAvailable = money
  let gthreads = 0
  try {
    gthreads = ns.formulas.hacking.growThreads(host, player, host.moneyMax)
    return gthreads
  }
  catch {
    const server = host
    const targetMoney = host.moneyMax
    let startMoney = host.moneyAvailable
    const cores = 1
    const person = player
    /*
          if (!server.serverGrowth) {
            gthreads = Infinity
          }
      */
    const moneyMax = server.moneyMax ?? 1;
    const hackDifficulty = server.hackDifficulty ?? 100;

    if (startMoney < 0) startMoney = 0; // servers "can't" have less than 0 dollars on them
    if (targetMoney > moneyMax) targetMoney = moneyMax; // can't grow a server to more than its moneyMax
    if (targetMoney <= startMoney) {
      gthreads = 0; // no growth --> no threads
      return gthreads
    }
    // exponential base adjusted by security
    const adjGrowthRate = 1 + (1.03 - 1) / hackDifficulty;
    const exponentialBase = Math.min(adjGrowthRate, 1.0035); // cap growth rate

    // total of all grow thread multipliers
    const serverGrowthPercentage = server.serverGrowth / 100.0;
    const coreMultiplier = 1 + (cores - 1) / 16
    let threadMultiplier = 0
    try {
      /** @type {BitNodeMultipliers} mults */
      const mults = getBNMults(ns)
      threadMultiplier = serverGrowthPercentage * person.mults.hacking_grow * coreMultiplier * mults.ServerGrowthRate
    }
    catch { threadMultiplier = serverGrowthPercentage * person.mults.hacking_grow * coreMultiplier }

    const x = threadMultiplier * Math.log(exponentialBase)
    const y = startMoney * x + Math.log(targetMoney * x)
    let w;
    if (y < Math.log(2.5)) {
      const ey = Math.exp(y);
      w = (ey + (4 / 3) * ey * ey) / (1 + (7 / 3) * ey + (5 / 6) * ey * ey);
    } else {
      w = y;
      if (y > 0) w -= Math.log(y);
    }
    let cycles = w / x - startMoney;
    let bt = exponentialBase ** threadMultiplier;
    if (bt == Infinity) bt = 1e300;
    let corr = Infinity;
    // Two sided error because we do not want to get stuck if the error stays on the wrong side
    do {
      // c should be above 0 so Halley's method can't be used, we have to stick to Newton-Raphson
      let bct = bt ** cycles;
      if (bct == Infinity) bct = 1e300;
      const opc = startMoney + cycles;
      let diff = opc * bct - targetMoney;
      if (diff == Infinity) diff = 1e300;
      corr = diff / (opc * x + 1.0) / bct;
      cycles -= corr;
    } while (Math.abs(corr) >= 1);

    const fca = Math.floor(cycles);
    if (targetMoney <= (startMoney + fca) * Math.pow(exponentialBase, fca * threadMultiplier)) {
      gthreads = fca;
      return gthreads
    }
    const cca = Math.ceil(cycles);
    if (targetMoney <= (startMoney + cca) * Math.pow(exponentialBase, cca * threadMultiplier)) {
      gthreads = cca;
      return gthreads
    }
    gthreads = cca + 1;
    return gthreads
  }
}
/** @param {NS} ns */
function getHackChance(ns, server, sec) {
  const host = ns.getServer(server)
  host.hackDifficulty = sec
  try { return ns.formulas.hacking.hackChance(host, ns.getPlayer()) }
  catch {
    const person = ns.getPlayer()
    const hackDifficulty = sec
    const requiredHackingSkill = host.requiredHackingSkill
    // Unrooted or unhackable server
    if (!host.hasAdminRights || hackDifficulty >= 100 || host.minDifficulty >= 100) {
      return 0
    }
    const hackFactor = 1.75;
    const difficultyMult = (100 - hackDifficulty) / 100;
    const skillMult = hackFactor * person.skills.hacking;
    const skillChance = (skillMult - requiredHackingSkill) / skillMult;
    let chance = 0
    try {
      chance =
        skillChance *
        difficultyMult *
        person.mults.hacking_chance *
        1 + Math.pow(person.skills.intelligence, 0.8) / 600
    }
    catch {
      chance =
        skillChance *
        difficultyMult *
        person.mults.hacking_chance
    }
    return Math.min(1, Math.max(chance, 0));
  }
}
/** @param {NS} ns */
function getHackPercent(ns, server, sec) {
  const host = ns.getServer(server)
  host.hackDifficulty = sec
  const player = ns.getPlayer()
  let hackperc = 0
  try {
    hackperc = ns.formulas.hacking.hackPercent(host, player)
    return hackperc
  }
  catch {
    const hackDifficulty = host.minDifficulty ?? 100
    if (hackDifficulty >= 100) {
      hackperc = 0
      return hackperc
    }
    const requiredHackingSkill = host.requiredHackingSkill ?? 1e9
    const balanceFactor = 240
    const difficultyMult = (100 - hackDifficulty) / 100
    const skillMult = (player.skills.hacking - (requiredHackingSkill - 1)) / player.skills.hacking

    let percentMoneyHacked = 0
    try {
      /** @type {BitNodeMultipliers} mults */
      const mults = getBNMults(ns)
      percentMoneyHacked = difficultyMult * skillMult * player.mults.hacking_money * mults.ScriptHackMoney / balanceFactor
    }
    catch { percentMoneyHacked = difficultyMult * skillMult * player.mults.hacking_money / balanceFactor }
    hackperc = Math.min(1, Math.max(percentMoneyHacked, 0))
  }
  return hackperc
}

/** @param {NS} ns */
function getHackP(ns, server, batches, threads, starthacks) {
  const hack_chance = getHackChance(ns, server.hostname, server.minDifficulty)
  const hackperc = getHackPercent(ns, server.hostname, server.minDifficulty)
  let moneytotake = 0
  let hytotalbatches = 1
  let hgwtotalbatches = 1
  let hwgwtotalbatches = 1
  let besttake = 0
  let besth1threads = 0
  let bestw1threads = 0
  let bestg1threads = 0
  let bestw2threads = 0
  let besttype = "HGW"
  let bestratio = 0

  //let testthreads = Math.min(Math.ceil(1 / hackperc), starthacks) - 1
  for (let testthreads = Math.min(Math.ceil(1 / hackperc), starthacks); testthreads <= Math.max(Math.ceil(1 / hackperc), starthacks); testthreads++) {
  //while (testthreads <= Math.max(Math.ceil(1 / hackperc))) {
    //testthreads++
    moneytotake = hackperc * testthreads >= 1 ? server.moneyMax - 1 : hackperc * server.moneyMax * testthreads
    // Hybrid hacking threads and it's security threads
    let hysechack = testthreads * .002 //Security added from hacking
    const hyw1threads = Math.floor(hysechack / weakenStrength) //Take out the hybrid amount - just enough
    hysechack -= hyw1threads * weakenStrength
    // HGW hacking threads and it's security threads
    const hgwsechack = testthreads * .002 //Security added from hacking which will carry over
    // HWGW hacking threads and it's security threads
    let hwgwsechack = testthreads * .002 //Security added from hacking
    const hwgww1threads = Math.ceil(hwgwsechack / weakenStrength) //Take it all out   
    //Hybrid and HGW have some security left.  HWGW does not
    const hygthreads = getGrowThreads(ns, server.hostname, server.moneyMax - moneytotake, server.minDifficulty + hysechack)
    const hgwgthreads = getGrowThreads(ns, server.hostname, server.moneyMax - moneytotake, server.minDifficulty + hgwsechack)
    const hwgwgthreads = getGrowThreads(ns, server.hostname, server.moneyMax - moneytotake, server.minDifficulty)

    moneytotake *= hack_chance
    //Last weaken threads for the grows and remaining from hacks
    const hysecgrow = hygthreads * .004
    const hgwsecgrow = hgwgthreads * .004
    const hwgwsecgrow = hwgwgthreads * .004

    //Get weaken threads
    const hyw2threads = Math.ceil((hysecgrow + hysechack) / weakenStrength)
    const hgww2threads = Math.ceil((hgwsecgrow + hgwsechack) / weakenStrength)
    const hwgww2threads = Math.ceil((hwgwsecgrow) / weakenStrength)

    //Get total thread count
    const hytotalthreads = testthreads + hyw1threads + hygthreads + hyw2threads
    const hgwtotalthreads = testthreads + hgwgthreads + hgww2threads
    const hwgwtotalthreads = testthreads + hwgww1threads + hwgwgthreads + hwgww2threads

    if (threads > 0) {
      hytotalbatches = Math.floor(threads / hytotalthreads) > batches || batches < 1 ? 0 : Math.floor(threads / hytotalthreads)
      hgwtotalbatches = Math.floor(threads / hgwtotalthreads) > batches || batches < 1 ? 0 : Math.floor(threads / hgwtotalthreads)
      hwgwtotalbatches = Math.floor(threads / hwgwtotalthreads) > batches || batches < 1 ? 0 : Math.floor(threads / hwgwtotalthreads)
    }

    let VALIDTEST = false
    let hyratio = 0
    let hgwratio = 0
    let hwgwratio = 0

    if (batches === -1 && threads === -1) { //Simply get the best.  Assume unlimited batches/threads
      hyratio = moneytotake / hytotalthreads
      hgwratio = moneytotake / hgwtotalthreads
      hwgwratio = moneytotake / hwgwtotalthreads
    }
    else {
      hyratio = moneytotake / hytotalthreads * hytotalbatches
      hgwratio = moneytotake / hgwtotalthreads * hgwtotalbatches
      hwgwratio = moneytotake / hwgwtotalthreads * hwgwtotalbatches
    }
    if (hyratio || hgwratio || hwgwratio) VALIDTEST = true

    // Just cascade the possibilities
    let failed = 0
    //HGW
    if (hgwratio > bestratio || (testthreads === Math.ceil(1 / hackperc) && bestratio === 0)) {
      bestratio = hgwratio
      besttake = moneytotake
      besth1threads = testthreads
      bestw1threads = 0
      bestg1threads = hgwgthreads
      bestw2threads = hgww2threads
      besttype = "HGW"
    }
    else failed++
    //Hybrid
    if (hyratio > bestratio) {
      bestratio = hyratio
      besttake = moneytotake
      besth1threads = testthreads
      bestw1threads = hyw1threads
      bestg1threads = hygthreads
      bestw2threads = hyw2threads
      besttype = "Hybrid"
    }
    else failed++
    //HWGW
    if (hwgwratio > bestratio) {// || testthreads == Math.ceil(1 / hackperc)) { //Our default for the highest possible
      bestratio = hwgwratio
      besttake = moneytotake
      besth1threads = testthreads
      bestw1threads = hwgww1threads
      bestg1threads = hwgwgthreads
      bestw2threads = hwgww2threads
      besttype = "HWGW"
    }
    else failed++
    if (failed === 3 && VALIDTEST) break//We are done.  Nothing better
  } // for loop to max threads

  let takemult = 1
  try {
    const mults = getBNMults(ns)
    takemult = mults.ScriptHackMoney
  } catch { }
  //Create return object
  const record = {
    "H1": besth1threads,
    "W1": bestw1threads,
    "G1": bestg1threads,
    "W2": bestw2threads,
    "Type": besttype,
    "Take": besttake * takemult,
    "HackP": hackperc,
    "Chance": hack_chance
  }
  return record
}
/** @param {NS} ns */
function printProfit(ns, tm, take, batches, threads, chance) {
  //tm is in milliseconds...
  tm = tm / 1000
  //Profit per second
  let profit = (take / tm) * batches
  profit = profit / threads * chance
  return (profit === 0 || Number.isNaN(profit) || tm === Number.POSITIVE_INFINITY) ? 0 : profit
}
/** @param {NS} ns */
function profitPerSecond(ns, tm, take, batches) {
  //tm is in milliseconds...
  tm = tm / 1000
  //Profit per second
  let profit = (take / tm) * batches
  return tm === 0 || isNaN(profit) ? 0 + "/s" : (ns.format.number(profit, 2) + "/s")
}
/** @param {NS} ns **/
function getOptimalTarget(ns) {
  /** @type {Server[]} servers */
  const servers = getServers(ns)
  const player = ns.getPlayer()
  let bestratio = 0
  let bestserver;
  for (const server of servers) {
    if (server.minDifficulty === 100 || server.requiredHackingSkill > player.skills.hacking || !server.hasAdminRights || server.hostname === "home" || server.moneyMax === 0 || server.purchasedByPlayer) continue
    const hchance = getHackChance(ns, server.hostname, server.minDifficulty)
    if (hchance === 0) continue
    const batchinfo = getHackP(ns, server, -1, -1, 1)

    const hackingTime = ns.getHackTime(server.hostname)

    //Weaken time at minimal difficulty
    let weaktime = hackingTime * 4
    weaktime = (weaktime === 0) ? 4 : weaktime
    const totalthreads = (batchinfo.H1 + batchinfo.G1 + batchinfo.W2 + batchinfo.W1)

    const ratio = printProfit(ns, weaktime, batchinfo.Take, 1, totalthreads, hchance)
    if (ratio > bestratio) {
      bestratio = ratio
      bestserver = server
    }


  }
  return bestserver
}
/** @param {NS} ns */
async function serverRun(ns, target, w1, g1, w2, h1, w3, g2, w4, batchh1, batchw1, batchg1, batchw2, batches, nohacknet) {
  servers = getServersSorted(ns, nohacknet)
  batchServers = getServersSorted(ns, nohacknet)
  let results;
  const hacktime = ns.getHackTime(target)
  const growtime = ns.getGrowTime(target)
  const weaktime = ns.getWeakenTime(target)
  let recalc = false
  let chunkswitch1 = false
  let chunkswitch2 = false

  //Run the wave!
  chunkswitch1 = check_batch(ns, w1, g1, w2, h1, w3, g2, w4, nohacknet)
  const starttime = performance.now()
  if (w1) results = runIt_Local(ns, WORKER_W, [target, 0, w1, false, nohacknet])
  if (g1) results = runIt_Local(ns, WORKER_G, [target, weaktime - growtime, g1, chunkswitch1, nohacknet])
  if (w2) results = runIt_Local(ns, WORKER_W, [target, 0, w2, false, nohacknet])
  if (h1) results = runIt_Local(ns, WORKER_H, [target, weaktime - hacktime, h1, chunkswitch1, nohacknet])
  if (w3) results = runIt_Local(ns, WORKER_W, [target, 0, w3, false, nohacknet])
  if (g2) results = runIt_Local(ns, WORKER_G, [target, weaktime - growtime, g2, chunkswitch1, nohacknet])
  if (w4) results = runIt_Local(ns, WORKER_W, [target, 0, w4, false, nohacknet])

  let batchesrun = 0
  for (let i = 1; i <= Math.min(batches, 99999); i++) {
    if (starttime + weaktime <= performance.now()) { //The performance wall
      recalc = true
      break
    }
    if (i === 99999) recalc = true

    batchesrun++
    chunkswitch2 = check_batch(ns, 0, 0, 0, batchh1, batchw1, batchg1, batchw2, nohacknet)
    if (batchh1) results = runIt_Local(ns, WORKER_H, [target, weaktime - hacktime, batchh1, chunkswitch2, nohacknet])
    if (batchw1) results = runIt_Local(ns, WORKER_W, [target, 0, batchw1, false, nohacknet])
    if (batchg1) results = runIt_Local(ns, WORKER_G, [target, weaktime - growtime, batchg1, chunkswitch2, nohacknet])
    if (batchw2) results = runIt_Local(ns, WORKER_W, [target, 0, batchw2, false, nohacknet])

    if (i % 2000 === 0) { // Reduce down for a smother experience
      await ns.sleep(0)
    }
  }
  const record = {
    "lastpid": results,
    "recalc": recalc,
    "batches": batchesrun,
    "batching": chunkswitch1 && chunkswitch2
  }
  return record
}
/** @param {NS} ns */
function runIt_Local(ns, script, argmts) {//target, sleeptm, threads, chunks, opt) {
  const target = argmts[0]
  const sleeptm = argmts[1]
  let threads = argmts[2]
  const chunks = argmts[3]
  const nohacknet = argmts[4]
  let thispid = 0
  const serversRemove = []
  for (const server of servers) {
    let tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
    if (server === "hacknet" && nohacknet) continue
    if (server === "home") tmpramavailable = Math.max(tmpramavailable - RESERVERAM, 0) //Reserve home ram for smaller things
    //Reserve our home threads
    let threadsonserver = Math.floor(tmpramavailable / 1.75)
    if (threadsonserver <= 0) {
      serversRemove.push(server)
      continue
    }
    //ns.scp([WORKER_H, WORKER_G, WORKER_W], server, "home")
    if (chunks) { //We NEED enough to finish the whole operation at once
      if (threadsonserver >= threads) {
        thispid = ns.exec(script, server, { threads: threads, temporary: true }, target, sleeptm, "QUIET")
        if (thispid === 0) ns.tprintf("Failed to run: %s on %s threads:%s target:%s", script, server, threads, target)
        threads = 0
        break
      }
    } // chunks
    else {
      if (threadsonserver >= threads) { //We have enough to finish it off
        thispid = ns.exec(script, server, { threads: threads, temporary: true }, target, sleeptm, "QUIET")
        if (thispid === 0) ns.tprintf("Failed to run: %s on %s threads:%s target:%s", script, server, threads, target)
        threads = 0
        break
      }
      else { //We have threads but not enough     
        thispid = ns.exec(script, server, { threads: threadsonserver, temporary: true }, target, sleeptm, "QUIET")
        if (thispid === 0) ns.tprintf("Failed to run: %s on %s threads:%s target:%s", script, server, threads, target)
        threads -= threadsonserver
        threadsonserver = 0
        serversRemove.push(server)
      }
    }//No chunks
  }// All servers
  if (threads > 0) ns.tprintf("Failed to allocate all %s threads. %s left.  Chunk: %s  Error!", script, threads, chunks)
  //servers = servers.filter((f) => !serversRemove.includes(f))
  return thispid
}
/** @param {NS} ns */
function check_batch(ns, w1, g1, w2, h1, w3, g2, w4, noHacknet, checklist = []) {
  //Nothing has been started up yet.  Base servers have all the values we need.
  //Our test cases.  One for each possible worker type
  let w1test = false
  let g1test = false
  let w2test = false
  let h1test = false
  let w3test = false
  let g2test = false
  let w4test = false
  const startcount = w1 + g1 + w2 + h1 + w3 + g2 + w4
  const remove = []
  for (const server of batchServers) {
    let tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
    if (server === "home") tmpramavailable = Math.max(tmpramavailable - RESERVERAM, 0) //Reserve home ram for smaller things

    let threadsonserver = Math.floor(tmpramavailable / 1.75)
    //Reduce by our checklist

    if (checklist.length > 0) checklist.forEach((c) => c.name === server ? threadsonserver -= c.threads : null)
    if (threadsonserver <= 0) {
      remove.push(server)
      continue
    }

    //W1 testing
    if (!w1test) { //No chunking
      if (threadsonserver >= w1) { //We have enough to finish it off
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += w1
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": w1
          }
          checklist.push(record)
        }
        threadsonserver -= w1
        w1test = true
        w1 = 0
      }
      else { //We have threads but not enough
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += threadsonserver
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": threadsonserver
          }
          checklist.push(record)
        }
        w1 -= threadsonserver
        threadsonserver = 0
        remove.push(server)
      }
    }

    //G1 testing
    if (w1test && !g1test) { //Chunking
      if (threadsonserver >= g1) {
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += g1
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": g1
          }
          checklist.push(record)
        }
        threadsonserver -= g1
        g1test = true
        if (g1 !== 0) {
          g1 = 0
          break //Allows the next weaken cycle to start from the lowest server again
        }
      }
    }

    //W2 testing
    if (g1test && !w2test) { //No chunking
      if (threadsonserver >= w2) { //We have enough to finish it off
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += w2
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": w2
          }
          checklist.push(record)
        }
        threadsonserver -= w2
        w2test = true
        w2 = 0
      }
      else { //We have threads but not enough
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += threadsonserver
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": threadsonserver
          }
          checklist.push(record)
        }
        w2 -= threadsonserver
        threadsonserver = 0
        remove.push(server)
      }
    }

    //H1 testing
    if (w2test && !h1test) { //Chunking
      if (threadsonserver >= h1) {
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += h1
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": h1
          }
          checklist.push(record)
        }
        threadsonserver -= h1
        h1test = true
        if (h1 !== 0) {
          h1 = 0
          break //Allows the next weaken cycle to start from the lowest server again
        }
      }
    }

    //W3 testing
    if (h1test && !w3test) { //No chunking
      if (threadsonserver >= w3) { //We have enough to finish it off
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += w3
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": w3
          }
          checklist.push(record)
        }
        threadsonserver -= w3
        w3test = true
        w3 = 0
      }
      else { //We have threads but not enough
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += threadsonserver
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": threadsonserver
          }
          checklist.push(record)
        }
        w3 -= threadsonserver
        threadsonserver = 0
        remove.push(server)
      }
    }

    //G2 testing
    if (w3test && !g2test) { //Chunking
      if (threadsonserver >= g2) {
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += g2
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": g2
          }
          checklist.push(record)
        }
        threadsonserver -= g2
        g2test = true
        if (g2 !== 0) {
          g2 = 0
          break //Allows the next weaken cycle to start from the lowest server again
        }
      }
    }

    //W4 testing
    if (g2test && !w4test) { //No chunking
      if (threadsonserver >= w4) { //We have enough to finish it off
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += w4
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": w4
          }
          checklist.push(record)
        }
        threadsonserver -= w4
        w4test = true
        w4 = 0
      }
      else { //We have threads but not enough
        let found = false
        for (let check of checklist) {
          if (check.name === server) {
            found = true
            check.threads += threadsonserver
          }
        }
        if (!found) {
          let record = {
            "name": server,
            "threads": threadsonserver
          }
          checklist.push(record)
        }
        w4 -= threadsonserver
        threadsonserver = 0
        remove.push(server)
      }
    }

    //If this is true, it's all good
    if (w4test) { //Success
      return true
    }
  }//End of batchServers
  const endcount = w1 + g1 + w2 + h1 + w3 + g2 + w4
  batchServers = batchServers.filter((f) => !remove.includes(f))
  //Did we make a change?  If so, run it again!
  if (startcount !== endcount) { // We processed something.  Keep processing until we are done.
    return check_batch(ns, w1, g1, w2, h1, w3, g2, w4, noHacknet, checklist)
  }
  else {
    return false
  }
}
/** @param {NS} ns */
function serverPurchaser(ns) {
  let upgradecost = 1e150
  const startRam = 2
  // Iterator we'll use for our loop
  let i = ns.cloud.getServerNames().length
  if (ns.cloud.getServerLimit() === 0) return

  //Buy the base servers
  while (i < ns.cloud.getServerLimit()) {
    // Check if we have enough money to purchase a server
    if (ns.getServerMoneyAvailable("home") >= ns.cloud.getServerCost(startRam)) {
      const server = i >= 10 ? ns.cloud.purchaseServer("pserv-" + i, startRam) : ns.cloud.purchaseServer("pserv-0" + i, startRam);
      ns.scp(WORKER_W, server, "home")
      ns.scp(WORKER_G, server, "home")
      ns.scp(WORKER_H, server, "home")
      i++;
    }
    else {
      upgradecost = ns.cloud.getServerCost(startRam)
      return upgradecost
    }
  }
  const servers = ns.cloud.getServerNames()

  //Cycle through every server.  Check each attribute for cost of upgrade
  //Upgrade the cheapest.  Keep upgrading indefinitally
  let upgradeitem = ""
  let ramupgrade = 0
  upgradecost = Number.POSITIVE_INFINITY

  //Check all servers
  for (const server of servers) {
    //Get the cheapest one and document it
    if (ns.cloud.getServerUpgradeCost(server, ns.cloud.getRamLimit(server) * 2) < upgradecost) {
      upgradecost = ns.cloud.getServerUpgradeCost(server, ns.cloud.getRamLimit(server) * 2)
      upgradeitem = server
      ramupgrade = ns.cloud.getRamLimit(server) * 2
    }
  }
  //upgrade the server if we can
  if (ns.getServerMoneyAvailable("home") >= upgradecost) ns.cloud.upgradeServer(upgradeitem, ramupgrade)
  else {
    upgradecost = upgradecost === Number.POSITIVE_INFINITY ? 0 : upgradecost
  }
  return upgradecost
}
/** @param {NS} ns */
function hasBN(ns, bn, bnLvl = 1) {
  const resetInfo = ns.getResetInfo()
  const sourceFiles = []
  for (const item of ns.getResetInfo().ownedSF) {
    const record = {
      "n": item[0],
      "lvl": item[1]
    }
    sourceFiles.push(record)
  }
  if (resetInfo.currentNode === bn) {
    return true
  }
  for (const sf of sourceFiles) if (sf.n === bn && sf.lvl >= bnLvl) {
    return true
  }
  return false
}
/** @param {NS} ns */
function hashIt(ns, target, opt) {
  //arg[0] is Type; money, corp, min, max, study, train, research, bbrank, bbsp, coding, favor, 
  //Target needs to be determined.  peek(3) for current hacking target
  //Will need to figure out Target for company favor - working for should do it but it's singularity
  switch (opt) {
    case "min":
      if (ns.getServerMinSecurityLevel(target) === 1) break
      while (ns.hacknet.spendHashes("Reduce Minimum Security", target)) { if (ns.getServerMinSecurityLevel(target) === 1) break }
      break
    case "max":
      while (ns.hacknet.spendHashes("Increase Maximum Money", target)) { }
      break
    default:
      break
  }
}
/** @param {NS} ns */
function hacknetPurchaser(ns) {
  let upgradeCost = -1
  while (true) {
    let upgradeType = 0
    let upgradeItem = -1
    upgradeCost = -1
    if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
      upgradeCost = ns.hacknet.getPurchaseNodeCost()
      upgradeType = 5
    }
    for (let i = 0; i < ns.hacknet.numNodes(); i++) {

      if (upgradeCost == -1) { //Might be first one if we've purchased them all.  We need to set the cost of something.  Do so then move on
        upgradeCost = ns.hacknet.getLevelUpgradeCost(i, 1)
        upgradeType = 1
        upgradeItem = i
      }
      if (ns.hacknet.getLevelUpgradeCost(i, 1) < upgradeCost) {
        upgradeCost = ns.hacknet.getLevelUpgradeCost(i, 1)
        upgradeType = 1
        upgradeItem = i
      }
      if (ns.hacknet.getRamUpgradeCost(i, 1) < upgradeCost) {
        upgradeCost = ns.hacknet.getRamUpgradeCost(i, 1)
        upgradeType = 2
        upgradeItem = i
      }
      if (ns.hacknet.getCoreUpgradeCost(i, 1) < upgradeCost) {
        upgradeCost = ns.hacknet.getCoreUpgradeCost(i, 1)
        upgradeType = 3
        upgradeItem = i
      }
      if (ns.hacknet.getCacheUpgradeCost(i, 1) < upgradeCost) {
        upgradeCost = ns.hacknet.getCacheUpgradeCost(i, 1)
        upgradeType = 4
        upgradeItem = i
      }
    }

    if (upgradeCost === Number.POSITIVE_INFINITY) {
      upgradeCost = 0
      return upgradeCost
    } //We have no upgrade
    else if (ns.getServerMoneyAvailable("home") < upgradeCost) return upgradeCost//We don't have enough money to purchase
    switch (upgradeType) {
      case 1:
        ns.hacknet.upgradeLevel(upgradeItem, 1)
        break
      case 2:
        ns.hacknet.upgradeRam(upgradeItem, 1)
        break
      case 3:
        ns.hacknet.upgradeCore(upgradeItem, 1)
        break
      case 4:
        ns.hacknet.upgradeCache(upgradeItem, 1)
        break
      case 5:
        ns.hacknet.purchaseNode()
        break
      default:
        return upgradeCost
    }
  }
}
/** @param {NS} ns */
function getServerAvailRam(ns, target) {
  return ns.getServerMaxRam(target) - ns.getServerUsedRam(target)
}
/** @param {NS} ns */
function init(ns) {
  baseServers = getServers(ns)
  weakenStrength = ns.weakenAnalyze(1)
  TARGET = "" //Who you are hacking
  NEXTTARGET = "" //Whos next up
  TARGETUPDATE = false
  ZERGSTATUS = false
  ZERGSENT = 0
  ZERGREQUIRED = -1
  RECALC_GOOD = false
  RECALC_BAD = false
  PORTS_OPEN = getPortOpeners(ns)
  BMODE = "B" //Batching style.  b is not batching, B is batching
  THREADSMAX = 0 //Total threads available
  BATCHESTOTAL = 0 //Total batches done
  BATCHESRUN = 0 //Total batches actually run
  PREPW1 = 0 //Prep wave
  PREPG1 = 0
  PREPW2 = 0
  PREPH1 = 1
  PREPW3 = 0
  PREPG2 = 0
  PREPW4 = 0
  STARTTIME = 0
  ENDTIME = 0
  BETWEENSTART = performance.now()
  BETWEENEND = 0
  WEAKENTIME = 0
}

/** @param {NS} ns */
async function writeFiles(ns) {
  // Write the worker scripts to home so they can be scp'd out. args: [target, additionalMsec]
  const hfile = `/** @param {NS} ns */
export async function main(ns) { await ns.hack(ns.args[0], { additionalMsec: ns.args[1] }) }`
  const gfile = `/** @param {NS} ns */
export async function main(ns) { await ns.grow(ns.args[0], { additionalMsec: ns.args[1] }) }`
  const wfile = `/** @param {NS} ns */
export async function main(ns) { await ns.weaken(ns.args[0], { additionalMsec: ns.args[1] }) }`
  ns.write(WORKER_H, hfile, "w")
  ns.write(WORKER_G, gfile, "w")
  ns.write(WORKER_W, wfile, "w")
}

/** @param {NS} ns */
function getBNMults(ns) {
  let mults;
  try { mults = ns.getBitNodeMultipliers() }
  catch {
    const resetInfo = ns.getResetInfo()
    let record = {
      "AgilityLevelMultiplier": 1,
      "AugmentationMoneyCost": 1,
      "AugmentationRepCost": 1,
      "BladeburnerRank": 1,
      "BladeburnerSkillCost": 1,
      "CharismaLevelMultiplier": 1,
      "ClassGymExpGain": 1,
      "CodingContractMoney": 1,
      "CompanyWorkExpGain": 1,
      "CompanyWorkMoney": 1,
      "CompanyWorkRepGain": 1,
      "CorporationValuation": 1,
      "CrimeExpGain": 1,
      "CrimeMoney": 1,
      "CrimeSuccessRate": 1,
      "DaedalusAugsRequirement": 30,
      "DefenseLevelMultiplier": 1,
      "DexterityLevelMultiplier": 1,
      "FactionPassiveRepGain": 1,
      "FactionWorkExpGain": 1,
      "FactionWorkRepGain": 1,
      "FourSigmaMarketDataApiCost": 1,
      "FourSigmaMarketDataCost": 1,
      "GangSoftcap": 1,
      "GangUniqueAugs": 1,
      "GoPower": 1,
      "HackExpGain": 1,
      "HackingLevelMultiplier": 1,
      "HackingSpeedMultiplier": 1,
      "HacknetNodeMoney": 1,
      "HomeComputerRamCost": 1,
      "InfiltrationMoney": 1,
      "InfiltrationRep": 1,
      "ManualHackMoney": 1,
      "CloudServerCost": 1,
      "CloudServerSoftcap": 1,
      "CloudServerLimit": 1,
      "CloudServerMaxRam": 1,
      "FavorToDonateToFaction": 1, //New
      "FavorToDonateToFaction": 1, //Old
      "ScriptHackMoney": 1,
      "ScriptHackMoneyGain": 1,
      "ServerGrowthRate": 1,
      "ServerMaxMoney": 1,
      "ServerStartingMoney": 1,
      "ServerStartingSecurity": 1,
      "ServerWeakenRate": 1,
      "StrengthLevelMultiplier": 1,
      "StaneksGiftPowerMultiplier": 1,
      "StaneksGiftExtraSize": 0,
      "WorldDaemonDifficulty": 1,
      "CorporationSoftcap": 1,
      "CorporationDivisions": 1
    }
    switch (resetInfo.currentNode) {
      case 1:
        break
      case 2:
        record.HackingLevelMultiplier = 0.8
        record.ServerGrowthRate = 0.8
        record.ServerStartingMoney = 0.4
        record.CloudServerSoftcap = 1.3
        record.CrimeMoney = 3
        record.FactionPassiveRepGain = 0
        record.FactionWorkRepGain = 0.5
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.InfiltrationMoney = 3
        record.StaneksGiftPowerMultiplier = 2
        record.StaneksGiftExtraSize = -6
        record.WorldDaemonDifficulty = 5
        break
      case 3:
        record.HackingLevelMultiplier = 0.8
        record.ServerGrowthRate = 0.2
        record.ServerMaxMoney = 0.04
        record.ServerStartingMoney = 0.2
        record.HomeComputerRamCost = 1.5
        record.CloudServerCost = 2
        record.CloudServerSoftcap = 1.3
        record.CompanyWorkMoney = 0.25
        record.CrimeMoney = 0.25
        record.HacknetNodeMoney = 0.25
        record.ScriptHackMoney = 0.2
        record.FavorToDonateToFaction = 0.5 //New
        record.FavorToDonateToFaction = 0.5 //Old
        record.AugmentationMoneyCost = 3
        record.AugmentationRepCost = 3
        record.GangSoftcap = 0.9
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 0.75
        record.StaneksGiftExtraSize = -2
        record.WorldDaemonDifficulty = 2
        break
      case 4:
        record.ServerMaxMoney = 0.1125
        record.ServerStartingMoney = 0.75
        record.CloudServerSoftcap = 1.2
        record.CompanyWorkMoney = 0.1
        record.CrimeMoney = 0.2
        record.HacknetNodeMoney = 0.05
        record.ScriptHackMoney = 0.2
        record.ClassGymExpGain = 0.5
        record.CompanyWorkExpGain = 0.5
        record.CrimeExpGain = 0.5
        record.FactionWorkExpGain = 0.5
        record.HackExpGain = 0.4
        record.FactionWorkRepGain = 0.75
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 1.5
        record.StaneksGiftExtraSize = 0
        record.WorldDaemonDifficulty = 3
        break
      case 5:
        record.ServerStartingSecurity = 2
        record.ServerStartingMoney = 0.5
        record.CloudServerSoftcap = 1.2
        record.CrimeMoney = 0.5
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.15
        record.HackExpGain = 0.5
        record.AugmentationMoneyCost = 2
        record.InfiltrationMoney = 1.5
        record.InfiltrationRep = 1.5
        record.CorporationValuation = 0.75
        record.CorporationDivisions = 0.75
        record.GangUniqueAugs = 0.5
        record.StaneksGiftPowerMultiplier = 1.3
        record.StaneksGiftExtraSize = 0
        record.WorldDaemonDifficulty = 1.5
        break
      case 6:
        record.HackingLevelMultiplier = 0.35
        record.ServerMaxMoney = 0.2
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.CloudServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.75
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.75
        record.HackExpGain = 0.25
        record.InfiltrationMoney = 0.75
        record.CorporationValuation = 0.2
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.2
        record.DaedalusAugsRequirement = 35
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = 2
        record.WorldDaemonDifficulty = 2
        break
      case 7:
        record.HackingLevelMultiplier = 0.35
        record.ServerMaxMoney = 0.2
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.CloudServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.75
        record.HacknetNodeMoney = 0.2
        record.ScriptHackMoney = 0.5
        record.HackExpGain = 0.25
        record.AugmentationMoneyCost = 3
        record.InfiltrationMoney = 0.75
        record.FourSigmaMarketDataCost = 2
        record.FourSigmaMarketDataApiCost = 2
        record.CorporationValuation = 0.2
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.6
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.2
        record.DaedalusAugsRequirement = 35
        record.StaneksGiftPowerMultiplier = 0.9
        record.StaneksGiftExtraSize = -1
        record.WorldDaemonDifficulty = 2
        break
      case 8:
        record.CloudServerSoftcap = 4
        record.CompanyWorkMoney = 0
        record.CrimeMoney = 0
        record.HacknetNodeMoney = 0
        record.ManualHackMoney = 0
        record.ScriptHackMoney = 0.3
        record.ScriptHackMoneyGain = 0
        record.CodingContractMoney = 0
        record.FavorToDonateToFaction = 0 //New
        record.FavorToDonateToFaction = 0 //Old
        record.InfiltrationMoney = 0
        record.CorporationValuation = 0
        record.CorporationSoftcap = 0
        record.CorporationDivisions = 0
        record.BladeburnerRank = 0
        record.GangSoftcap = 0
        record.GangUniqueAugs = 0
        record.StaneksGiftExtraSize = -99
        break
      case 9:
        record.HackingLevelMultiplier = 0.5
        record.StrengthLevelMultiplier = 0.45
        record.DefenseLevelMultiplier = 0.45
        record.DexterityLevelMultiplier = 0.45
        record.AgilityLevelMultiplier = 0.45
        record.CharismaLevelMultiplier = 0.45
        record.ServerMaxMoney = 0.01
        record.ServerStartingMoney = 0.1
        record.ServerStartingSecurity = 2.5
        record.HomeComputerRamCost = 5
        record.CloudServerLimit = 0
        record.CrimeMoney = 0.5
        record.ScriptHackMoney = 0.1
        record.HackExpGain = 0.05
        record.FourSigmaMarketDataCost = 5
        record.FourSigmaMarketDataApiCost = 4
        record.CorporationValuation = 0.5
        record.CorporationSoftcap = 0.75
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.9
        record.BladeburnerSkillCost = 1.2
        record.GangSoftcap = 0.8
        record.GangUniqueAugs = 0.25
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = 2
        record.WorldDaemonDifficulty = 2
        break
      case 10:
        record.HackingLevelMultiplier = 0.35
        record.StrengthLevelMultiplier = 0.4
        record.DefenseLevelMultiplier = 0.4
        record.DexterityLevelMultiplier = 0.4
        record.AgilityLevelMultiplier = 0.4
        record.CharismaLevelMultiplier = 0.4
        record.HomeComputerRamCost = 1.5
        record.CloudServerCost = 5
        record.CloudServerSoftcap = 1.1
        record.CloudServerLimit = 0.6
        record.CloudServerMaxRam = 0.5
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 0.5
        record.HacknetNodeMoney = 0.5
        record.ManualHackMoney = 0.5
        record.ScriptHackMoney = 0.5
        record.CodingContractMoney = 0.5
        record.AugmentationMoneyCost = 5
        record.AugmentationRepCost = 2
        record.InfiltrationMoney = 0.5
        record.CorporationValuation = 0.5
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.BladeburnerRank = 0.8
        record.GangSoftcap = 0.9
        record.GangUniqueAugs = 0.25
        record.StaneksGiftPowerMultiplier = 0.75
        record.StaneksGiftExtraSize = -3
        record.WorldDaemonDifficulty = 2
        break
      case 11:
        record.HackingLevelMultiplier = 0.6
        record.ServerGrowthRate = 0.2
        record.ServerMaxMoney = 0.01
        record.ServerStartingMoney = 0.1
        record.ServerWeakenRate = 2
        record.CloudServerSoftcap = 2
        record.CompanyWorkMoney = 0.5
        record.CrimeMoney = 3
        record.HacknetNodeMoney = 0.1
        record.CodingContractMoney = 0.25
        record.HackExpGain = 0.5
        record.AugmentationMoneyCost = 2
        record.InfiltrationMoney = 2.5
        record.InfiltrationRep = 2.5
        record.FourSigmaMarketDataCost = 4
        record.FourSigmaMarketDataApiCost = 4
        record.CorporationValuation = 0.1
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.9
        record.GangUniqueAugs = 0.75
        record.WorldDaemonDifficulty = 1.5
        break
      case 12:
        const sourceFiles = []
        for (const item of ns.getResetInfo().ownedSF) {
          const record = {
            "n": item[0],
            "lvl": item[1]
          }
          sourceFiles.push(record)
        }
        let SF12LVL = 1
        for (const sf of sourceFiles) {
          if (sf.n === 12) {
            SF12LVL = sf.lvl + 1
            break
          }
        }
        const inc = Math.pow(1.02, SF12LVL)
        const dec = 1 / inc

        record.DaedalusAugsRequirement = Math.floor(Math.min(record.DaedalusAugsRequirement + inc, 40))
        record.HackingLevelMultiplier = dec
        record.StrengthLevelMultiplier = dec
        record.DefenseLevelMultiplier = dec
        record.DexterityLevelMultiplier = dec
        record.AgilityLevelMultiplier = dec
        record.CharismaLevelMultiplier = dec
        record.ServerGrowthRate = dec
        record.ServerMaxMoney = dec * dec
        record.ServerStartingMoney = dec
        record.ServerWeakenRate = dec
        record.ServerStartingSecurity = 1.5
        record.HomeComputerRamCost = inc
        record.CloudServerCost = inc
        record.CloudServerSoftcap = inc
        record.CloudServerLimit = dec
        record.CloudServerMaxRam = dec
        record.CompanyWorkMoney = dec
        record.CrimeMoney = dec
        record.HacknetNodeMoney = dec
        record.ManualHackMoney = dec
        record.ScriptHackMoney = dec
        record.CodingContractMoney = dec
        record.ClassGymExpGain = dec
        record.CompanyWorkExpGain = dec
        record.CrimeExpGain = dec
        record.FactionWorkExpGain = dec
        record.HackExpGain = dec
        record.FactionPassiveRepGain = dec
        record.FactionWorkRepGain = dec
        record.FavorToDonateToFaction = inc
        record.AugmentationMoneyCost = inc
        record.AugmentationRepCost = inc
        record.InfiltrationMoney = dec
        record.InfiltrationRep = dec
        record.FourSigmaMarketDataCost = inc
        record.FourSigmaMarketDataApiCost = inc
        record.CorporationValuation = dec
        record.CorporationSoftcap = 0.8
        record.CorporationDivisions = 0.5
        record.BladeburnerRank = dec
        record.BladeburnerSkillCost = inc
        record.GangSoftcap = 0.8
        record.GangUniqueAugs = dec
        record.StaneksGiftPowerMultiplier = inc
        record.StaneksGiftExtraSize = inc
        record.WorldDaemonDifficulty = inc
        break
      case 13:
        record.HackingLevelMultiplier = 0.25
        record.StrengthLevelMultiplier = 0.7
        record.DefenseLevelMultiplier = 0.7
        record.DexterityLevelMultiplier = 0.7
        record.AgilityLevelMultiplier = 0.7
        record.CloudServerSoftcap = 1.6
        record.ServerMaxMoney = 0.3375
        record.ServerStartingMoney = 0.75
        record.ServerStartingSecurity = 3
        record.CompanyWorkMoney = 0.4
        record.CrimeMoney = 0.4
        record.HacknetNodeMoney = 0.4
        record.ScriptHackMoney = 0.2
        record.CodingContractMoney = 0.4
        record.ClassGymExpGain = 0.5
        record.CompanyWorkExpGain = 0.5
        record.CrimeExpGain = 0.5
        record.FactionWorkExpGain = 0.5
        record.HackExpGain = 0.1
        record.FactionWorkRepGain = 0.6
        record.FourSigmaMarketDataCost = 10
        record.FourSigmaMarketDataApiCost = 10
        record.CorporationValuation = 0.001
        record.CorporationSoftcap = 0.4
        record.CorporationDivisions = 0.4
        record.BladeburnerRank = 0.45
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.3
        record.GangUniqueAugs = 0.1
        record.StaneksGiftPowerMultiplier = 2
        record.StaneksGiftExtraSize = 1
        record.WorldDaemonDifficulty = 3
        break
      case 14:
        record.GoPower = 4
        record.HackingLevelMultiplier = 0.4
        record.HackingSpeedMultiplier = 0.3
        record.ServerMaxMoney = 0.7
        record.ServerStartingMoney = 0.5
        record.ServerStartingSecurity = 1.5
        record.CrimeMoney = 0.75
        record.CrimeSuccessRate = 0.4
        record.HacknetNodeMoney = 0.25
        record.ScriptHackMoney = 0.3
        record.StrengthLevelMultiplier = 0.5
        record.DexterityLevelMultiplier = 0.5
        record.AgilityLevelMultiplier = 0.5
        record.AugmentationMoneyCost = 1.5
        record.InfiltrationMoney = 0.75
        record.FactionWorkRepGain = 0.2
        record.CompanyWorkRepGain = 0.2
        record.CorporationValuation = 0.4
        record.CorporationSoftcap = 0.9
        record.CorporationDivisions = 0.8
        record.BladeburnerRank = 0.6
        record.BladeburnerSkillCost = 2
        record.GangSoftcap = 0.7
        record.GangUniqueAugs = 0.4
        record.StaneksGiftPowerMultiplier = 0.5
        record.StaneksGiftExtraSize = -1
        record.WorldDaemonDifficulty = 5
        break
    }
    mults = record
  }
  return mults
}

export function autocomplete(data, args) { return data.servers }
