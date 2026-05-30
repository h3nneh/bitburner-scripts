/* Author: Sphyxis */
const corpName = "Sphyx-Corp"
const div1 = "Family Farm" //Agriculture
const div2 = "The Bog Pit" //Chemical
const div3 = "Ciggy\'s r Us" //Tobacco
const div4 = "Bob\'s Burgers" //Restaurant
const div5 = "Brawndo" //Water Utilities
const div6 = "Fabrikator" //Computer Hardware
const div7 = "The Furnace" //Refinery
const div8 = "Diggers Inc." //Mining
let win
let workersWIP = []
const round1Money = 440e9 //b
const round2Money = 8.8e12 //t
const round3Money = 12e15 //q
const round4Money = 500e18 //Q
let tobaccoBooster = false
let ta2DB = [] //TA2 DB
const indDataDB = []
const matDataDB = []
let researchedDB = []
let hasDivDB = []
let hasOfficeDB = []
let hasWarehouseDB = []
let roundTrigger = false
let bnMults
let oldRound
let teaNeeded
let investOffer
const HEIGHT = 780
const WIDTH = 900
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  const showTail = !ns.args.includes("quiet") && !ns.args.includes("--no-tail-windows")
  if (showTail) ns.ui.openTail()
  if (showTail) ns.ui.resizeTail(WIDTH, HEIGHT)
  ns.clearLog()
  ns.clearPort(9)
  ns.writePort(9, ns.pid)
  ns.atExit(() => {
    ns.clearPort(9)
    for (const worker of workersWIP) {
      globalThis["SphyxOSCorpWebWorkers"].push(worker) //Dirty push
      worker = null
    }
  })
  if (!globalThis["SphyxOSCorpWebWorkers"]) globalThis["SphyxOSCorpWebWorkers"] = []
  hasDivDB = []
  researchedDB = []
  hasOfficeDB = []
  hasWarehouseDB = []
  win = false
  ns.atExit(() => {
    ns.clearPort(9)
    if (win) win.close()
  })
  //Create our proxy file
  writeProxy(ns)
  writeBNMults(ns)
  const resetInfo = await proxy(ns, "getResetInfo")
  const myBN = resetInfo.currentNode
  const sfLevel = resetInfo.ownedSF.has(3) ? resetInfo.ownedSF.get(3) : 0
  if (myBN !== 3 && sfLevel !== 3) {
    update(ns, "You cannot start a corp yet.  Be in BN 3 or have SF 3.3 to start.")
    ns.exit()
  }

  bnMults = await getBNMults(ns)
  const selfFund = myBN === 3 ? false : true
  if (!await proxy(ns, "corporation.canCreateCorporation", selfFund)) {
    ns.clearLog()
    ns.print("Cannot create a corporation")
    ns.exit()
  }
  getCommands(ns)
  await ns.asleep(4)
  while (!await proxy(ns, "corporation.hasCorporation")) {
    await proxy(ns, "corporation.createCorporation", corpName, selfFund)
    await ns.asleep(1000)
    clearLogs(ns)
    update(ns, "Cannot create corporation yet")
  }
  const invest = await proxy(ns, "corporation.getInvestmentOffer")
  let round = invest.round
  teaNeeded = true
  oldRound = 0
  tobaccoBooster = false
  while (round === 1) {
    await prep(ns)
    await updateHud(ns)
    let division1 = await proxy(ns, "corporation.getDivision", div1)
    if (division1.numAdVerts < 2)
      while (division1.numAdVerts < 2) {
        await proxy(ns, "corporation.hireAdVert", div1)
        division1 = await proxy(ns, "corporation.getDivision", div1)
      }
    const corp = await proxy(ns, "corporation.getCorporation")
    const nState = corp.nextState
    if (nState === "SALE")
      await sell(ns)
    if (nState === "PURCHASE") {
      const office = await proxy(ns, "corporation.getOffice", div1, "Sector-12")
      if (!teaNeeded && office.employeeJobs.Business > 0) {
        await optimizeMats(ns)
      }
      await purchase(ns)
    }
    if (nState === "START") {
      teaNeeded = await teaParty(ns)
      round = await checkInvest(ns)
    }
    if (nState === "EXPORT") {
      await manageOffice(ns)
      await warehouseUpgrade(ns)
    }
    await proxy(ns, "corporation.levelUpgrade", "ABC SalesBots")
    await ns.corporation.nextUpdate()
  }
  while (round === 2) {
    await prep(ns)
    await updateHud(ns)
    let hasDiv2 = false
    //Set up Tobacco    
    let count = 0
    if (researchedDB["Export"])
      for (const city of cities)
        if (hasWarehouseDB[div2 + city]) count++
    if (count === 6)
      hasDiv2 = true
    while (hasDiv2 && await proxy(ns, "corporation.getUpgradeLevel", "Smart Factories") < 16 && await proxy(ns, "corporation.getUpgradeLevelCost", "Smart Factories") <= await corpFunds(ns))
      await proxy(ns, "corporation.levelUpgrade", "Smart Factories")
    const corp = await proxy(ns, "corporation.getCorporation")
    const nState = corp.nextState
    if (nState === "SALE")
      await sell(ns)
    if (nState === "PURCHASE") {
      await importExport(ns)
      await purchase(ns)
      const materials = await proxy(ns, "corporation.getMaterial", div1, "Sector-12", "Plants")
      while (await corpFunds(ns) > await proxy(ns, "corporation.getHireAdVertCost", div1) && await proxy(ns, "corporation.getHireAdVertCount", div1) < 12 && hasDiv2)
        await proxy(ns, "corporation.hireAdVert", div1)
      if (await proxy(ns, "corporation.getHireAdVertCount", div1) < 11 && materials.stored > 200)
        await proxy(ns, "corporation.hireAdVert", div1)
      else if (hasDiv2 && materials.stored > 200)
        await proxy(ns, "corporation.hireAdVert", div1)
      const office = await proxy(ns, "corporation.getOffice", div1, "Sector-12")
      if (ns.ui.getGameInfo()?.versionNumber === undefined) {
        if (!teaNeeded && office.employeeJobs.Business > 0 && await proxy(ns, "corporation.getUpgradeLevel", "DreamSense") === 0)
          await proxy(ns, "corporation.levelUpgrade", "DreamSense")
      }
    }
    if (nState === "START") {
      teaNeeded = await teaParty(ns)
      round = await checkInvest(ns)
      await warehouseUpgrade(ns)
    }
    if (nState === "EXPORT") {
      await manageOffice(ns)
      const office = await proxy(ns, "corporation.getOffice", div1, "Sector-12")
      if (!teaNeeded && office.employeeJobs.Business > 0) {

        while (hasDiv2 && await corpFunds(ns) >= await proxy(ns, "corporation.getUpgradeLevelCost", "ABC SalesBots") && await proxy(ns, "corporation.getUpgradeLevel", "ABC SalesBots") < 30)
          await proxy(ns, "corporation.levelUpgrade", "ABC SalesBots")
        await optimizeMats(ns)
      }
      while (await corpFunds(ns) >= await proxy(ns, "corporation.getUpgradeLevelCost", "ABC SalesBots") && await proxy(ns, "corporation.getUpgradeLevel", "ABC SalesBots") < 10)
        await proxy(ns, "corporation.levelUpgrade", "ABC SalesBots")
    }
    await ns.corporation.nextUpdate()
  }
  while (round === 3 || round === 4) {
    await prep(ns)
    await updateHud(ns)
    while (await proxy(ns, "corporation.getUpgradeLevel", "Smart Factories") < 20 && await proxy(ns, "corporation.getUpgradeLevelCost", "Smart Factories") <= await corpFunds(ns))
      await proxy(ns, "corporation.levelUpgrade", "Smart Factories")

    const corp = await proxy(ns, "corporation.getCorporation")
    const nState = corp.nextState
    if (nState === "SALE") {
      await sell(ns)
    }
    if (nState === "PURCHASE") {
      await importExport(ns)
      await purchase(ns)
      const material = await proxy(ns, "corporation.getMaterial", div1, "Sector-12", "Plants")
      if (material.stored > 200)
        await proxy(ns, "corporation.hireAdVert", div1)
      const office = await proxy(ns, "corporation.getOffice", div1, "Sector-12")
      if (ns.ui.getGameInfo()?.versionNumber === undefined) {
        if (!teaNeeded && office.employeeJobs.Business > 0 && await proxy(ns, "corporation.getUpgradeLevel", "DreamSense") === 0)
          await proxy(ns, "corporation.levelUpgrade", "DreamSense")
      }
    }
    if (nState === "START") {
      teaNeeded = await teaParty(ns)
      round = await checkInvest(ns)
      await manageProducts(ns)
      await spendRP(ns)
      await warehouseUpgrade(ns)
    }
    if (nState === "EXPORT") {
      await updateMisc(ns)
      await manageOffice(ns)
      await optimizeMats(ns)
    }
    await ns.corporation.nextUpdate()
  }
  while (round === 5) {
    await prep(ns)
    await updateHud(ns)

    const corp = await proxy(ns, "corporation.getCorporation")
    const nState = corp.nextState
    if (nState === "SALE") {
      await sell(ns)
    }
    if (nState === "PURCHASE") {
      await updateMisc(ns)
      await importExport(ns)
      await purchase(ns)
    }

    if (nState === "START") {
      teaNeeded = await teaParty(ns)
      await manageProducts(ns)
      await spendRP(ns)
      await warehouseUpgrade(ns)
    }
    if (nState === "EXPORT") {
      await optimizeMats(ns)
      await manageOffice(ns)
    }
    await ns.corporation.nextUpdate()
  }
}
/** @param {NS} ns */
async function checkInvest(ns) {
  const round = investOffer.round
  const corp = await proxy(ns, "corporation.getCorporation")
  if (round === 1) {
    if (round1Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        await proxy(ns, "corporation.acceptInvestmentOffer")
        teaNeeded = true
        roundTrigger = false
        if (!ns.args.includes("quiet")) ns.tprintf("Off to round 2!")
        return 2
      }
    }
    return 1
  }
  if (round === 2) {
    let hasDiv2 = false
    //Set up Tobacco    
    let count = 0
    if (researchedDB["Export"])
      for (const city of cities)
        if (hasWarehouseDB[div2 + city]) count++
    if (count === 6)
      hasDiv2 = true
    if ((hasDiv2 && investOffer.funds + corp.funds > 30e9 && round2Money * bnMults.CorporationValuation < investOffer.funds + corp.funds) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + Math.min(30e9, corp.funds)) {
        oldRound = investOffer.funds + Math.min(30e9, corp.funds)
      }
      else if (investOffer.funds + Math.min(30e9, corp.funds) > 30e9) {
        await proxy(ns, "corporation.acceptInvestmentOffer")
        teaNeeded = true
        roundTrigger = false
        if (!ns.args.includes("quiet")) ns.tprintf("Off to round 3!")
        return 3
      }
    }
    return 2
  }
  if (round === 3) {
    if (round3Money * bnMults.CorporationValuation < (investOffer.funds * 4) + (corp.funds * bnMults.CorporationValuation)) {
      tobaccoBooster = true
    }
    if ((round3Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation)) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        await proxy(ns, "corporation.acceptInvestmentOffer")
        teaNeeded = true
        roundTrigger = false
        tobaccoBooster = false
        if (!ns.args.includes("quiet")) ns.tprintf("Off to round 4!")
        return 4
      }
    }
    return 3
  }
  if (round === 4) {
    if (round4Money * bnMults.CorporationValuation < (investOffer.funds * 4) + (corp.funds * bnMults.CorporationValuation)) {
      tobaccoBooster = true
    }
    if ((round4Money * bnMults.CorporationValuation < investOffer.funds + (corp.funds * bnMults.CorporationValuation)) || roundTrigger) {
      roundTrigger = true
      if (oldRound <= investOffer.funds + (corp.funds * bnMults.CorporationValuation)) {
        oldRound = investOffer.funds + (corp.funds * bnMults.CorporationValuation)
      }
      else {
        await proxy(ns, "corporation.acceptInvestmentOffer")
        teaNeeded = true
        roundTrigger = false
        if (!ns.args.includes("quiet")) ns.tprintf("Off to round 5!")
        return 5
      }
    }
    return 4
  }
}
/** @param {NS} ns */
async function corpFunds(ns) {
  const corp = await proxy(ns, "corporation.getCorporation")
  return corp.funds
}
/** @param {NS} ns */
async function prep(ns) {
  investOffer = await proxy(ns, "corporation.getInvestmentOffer")
  const round = investOffer.round
  if (round >= 1) {
    if (!hasDivDB[div1]) {
      let division1 = await proxy(ns, "corporation.getDivision", div1)
      if (division1)
        hasDivDB[div1] = division1
      else {
        await proxy(ns, "corporation.expandIndustry", "Agriculture", div1)
        division1 = await proxy(ns, "corporation.getDivision", div1)
        if (division1)
          hasDivDB[div1] = division1
      }
    }
    for (const city of cities) {
      if (!hasOfficeDB[div1 + city]) {
        await proxy(ns, "corporation.expandCity", div1, city)
        if (await proxy(ns, "corporation.getOffice", div1, city))
          hasOfficeDB[div1 + city] = true
      }
      if (!hasWarehouseDB[div1 + city]) {
        await proxy(ns, "corporation.purchaseWarehouse", div1, city)
        const warehouse = await proxy(ns, "corporation.hasWarehouse", div1, city)
        if (warehouse)
          hasWarehouseDB[div1 + city] = warehouse
      }
    }
  }
  if (round >= 2) {
    if (!researchedDB["Export"]) {
      await proxy(ns, "corporation.purchaseUnlock", "Export")
      if (await proxy(ns, "corporation.hasUnlock", "Export"))
        researchedDB["Export"] = true
    }
    if (researchedDB["Export"]) {
      if (!hasDivDB[div2]) {
        let division2 = await proxy(ns, "corporation.getDivision", div2)
        if (division2)
          hasDivDB[div2] = division2
        else {
          await proxy(ns, "corporation.expandIndustry", "Chemical", div2)
          division2 = await proxy(ns, "corporation.getDivision", div2)
          if (division2)
            hasDivDB[div2] = division2
        }
      }
      if (hasDivDB[div2]) {
        for (const city of cities) {
          if (!hasOfficeDB[div2 + city]) {
            await proxy(ns, "corporation.expandCity", div2, city)
            if (await proxy(ns, "corporation.getOffice", div2, city))
              hasOfficeDB[div2 + city] = true
          }
          if (!hasWarehouseDB[div2 + city]) {
            await proxy(ns, "corporation.purchaseWarehouse", div2, city)
            if (await proxy(ns, "corporation.hasWarehouse", div2, city))
              hasWarehouseDB[div2 + city] = true
          }
        }
      }
    }
  }
  if (round >= 3) {
    if (!researchedDB["Market Research - Demand"]) {
      await proxy(ns, "corporation.purchaseUnlock", "Market Research - Demand")
      if (await proxy(ns, "corporation.hasUnlock", "Market Research - Demand"))
        researchedDB["Market Research - Demand"] = true
    }
    if (!researchedDB["Market Data - Competition"]) {
      await proxy(ns, "corporation.purchaseUnlock", "Market Data - Competition")
      if (await proxy(ns, "corporation.hasUnlock", "Market Data - Competition"))
        researchedDB["Market Data - Competition"] = true
    }
    if (!hasDivDB[div3] && researchedDB["Market Research - Demand"] && researchedDB["Market Data - Competition"]) {
      let division3 = await proxy(ns, "corporation.getDivision", div3)
      if (division3)
        hasDivDB[div3] = division3
      else {
        await proxy(ns, "corporation.expandIndustry", "Tobacco", div3)
        division3 = await proxy(ns, "corporation.getDivision", div3)
        if (division3)
          hasDivDB[div3] = division3
      }
    }
    if (hasDivDB[div3]) {
      for (const city of cities) {
        if (!hasOfficeDB[div3 + city]) {
          await proxy(ns, "corporation.expandCity", div3, city)
          if (await proxy(ns, "corporation.getOffice", div3, city))
            hasOfficeDB[div3 + city] = true
        }
        if (!hasWarehouseDB[div3 + city]) {
          await proxy(ns, "corporation.purchaseWarehouse", div3, city)
          if (await proxy(ns, "corporation.hasWarehouse", div3, city))
            hasWarehouseDB[div3 + city] = true
        }
      }
    }
  }
  if (round >= 5) {
    let division4 = await proxy(ns, "corporation.getDivision", div4)
    if (division4)
      hasDivDB[div4] = division4
    else {
      await proxy(ns, "corporation.expandIndustry", "Restaurant", div4)
      division4 = await proxy(ns, "corporation.getDivision", div4)
      if (division4)
        hasDivDB[div4] = division4
    }
    for (const city of cities) {
      if (!hasOfficeDB[div4 + city]) {
        await proxy(ns, "corporation.expandCity", div4, city)
        if (await proxy(ns, "corporation.getOffice", div4, city))
          hasOfficeDB[div4 + city] = true
      }
      if (!hasWarehouseDB[div4 + city]) {
        await proxy(ns, "corporation.purchaseWarehouse", div4, city)
        if (await proxy(ns, "corporation.hasWarehouse", div4, city))
          hasWarehouseDB[div4 + city] = true
      }
    }
    const corp = await proxy(ns, "corporation.getCorporation")
    if (corp.valuation >= 100e12) {
      if (!researchedDB["Government Partnership"]) {
        await proxy(ns, "corporation.purchaseUnlock", "Government Partnership")
        if (await proxy(ns, "corporation.hasUnlock", "Government Partnership"))
          researchedDB["Government Partnership"] = true
      }
      if (!researchedDB["Shady Accounting"]) {
        await proxy(ns, "corporation.purchaseUnlock", "Shady Accounting")
        if (await proxy(ns, "corporation.hasUnlock", "Shady Accounting"))
          researchedDB["Shady Accounting"] = true
      }
      if (!corp.public) {
        await proxy(ns, "corporation.goPublic", 0)
        await proxy(ns, "corporation.issueDividends", 0.1)
      }
    }
    if (corp.revenue >= 1e24) {
      let division5 = await proxy(ns, "corporation.getDivision", div5)
      if (division5)
        hasDivDB[div5] = await proxy(ns, "corporation.getDivision", div5)
      else {
        await proxy(ns, "corporation.expandIndustry", "Water Utilities", div5)
        division5 = await proxy(ns, "corporation.getDivision", div5)
        if (division5)
          hasDivDB[div5] = await proxy(ns, "corporation.getDivision", div5)
      }
      let division6 = await proxy(ns, "corporation.getDivision", div6)
      if (division6)
        hasDivDB[div6] = await proxy(ns, "corporation.getDivision", div6)
      else {
        await proxy(ns, "corporation.expandIndustry", "Computer Hardware", div6)
        division6 = await proxy(ns, "corporation.getDivision", div6)
        if (division6)
          hasDivDB[div6] = await proxy(ns, "corporation.getDivision", div6)
      }
      let division7 = await proxy(ns, "corporation.getDivision", div7)
      if (division7)
        hasDivDB[div7] = await proxy(ns, "corporation.getDivision", div7)
      else {
        await proxy(ns, "corporation.expandIndustry", "Refinery", div7)
        division7 = await proxy(ns, "corporation.getDivision", div7)
        if (division7)
          hasDivDB[div7] = await proxy(ns, "corporation.getDivision", div7)
      }
      let division8 = await proxy(ns, "corporation.getDivision", div8)
      if (division8)
        hasDivDB[div8] = await proxy(ns, "corporation.getDivision", div8)
      else {
        await proxy(ns, "corporation.expandIndustry", "Mining", div8)
        division8 = await proxy(ns, "corporation.getDivision", div8)
        if (division8)
          hasDivDB[div8] = await proxy(ns, "corporation.getDivision", div8)
      }
      for (const city of cities) {
        //Set up divs
        const divs = [div5, div6, div7, div8]
        for (const div of divs) {
          if (!hasOfficeDB[div + city]) {
            await proxy(ns, "corporation.expandCity", div, city)
            if (await proxy(ns, "corporation.getOffice", div, city))
              hasOfficeDB[div + city] = true
          }
          if (!hasWarehouseDB[div + city]) {
            await proxy(ns, "corporation.purchaseWarehouse", div, city)
            if (await proxy(ns, "corporation.hasWarehouse", div, city))
              hasWarehouseDB[div + city] = true
          }
        }
      }
    }
  }
}
/** @param {NS} ns */
async function updateMisc(ns) {
  const round = investOffer.round
  let corp = await proxy(ns, "corporation.getCorporation")
  const mult = round === 3 ? 3 : 2.5
  let hasDiv4 = false
  let hasDiv3 = false
  let div3Count = 0
  for (const city of cities)
    if (hasWarehouseDB[div3 + city])
      div3Count++
  if (div3Count === 6) hasDiv3 = true


  let div4Count = 0
  for (const city of cities)
    if (hasWarehouseDB[div4 + city])
      div4Count++
  if (div4Count === 6) hasDiv4 = true

  if (round === 3 && !hasDiv3) return
  const division3 = await proxy(ns, "corporation.getDivision", div3)
  const division4 = await proxy(ns, "corporation.getDivision", div4)
  if (round >= 3
    && await proxy(ns, "corporation.getUpgradeLevelCost", "Wilson Analytics") < corp.funds
    && (((round >= 5)
      && (hasDiv4
        && (division4.awareness < Number.MAX_VALUE
          || division4.popularity < Number.MAX_VALUE)))
      || (hasDiv3
        && (division3.awareness < Number.MAX_VALUE
          || division3.popularity < Number.MAX_VALUE)))) {
    await proxy(ns, "corporation.levelUpgrade", "Wilson Analytics")
    corp = await proxy(ns, "corporation.getCorporation")
  }
  while ((round === 3)
    && await proxy(ns, "corporation.getUpgradeLevelCost", "Wilson Analytics") < await corpFunds(ns)
    && await proxy(ns, "corporation.getUpgradeLevel", "Wilson Analytics") < 2) {
    await proxy(ns, "corporation.levelUpgrade", "Wilson Analytics")
    corp = await proxy(ns, "corporation.getCorporation")
  }
  if (round < 5 && await proxy(ns, "corporation.getUpgradeLevelCost", "ABC SalesBots") * mult / 2 < corp.funds) {
    await proxy(ns, "corporation.levelUpgrade", "ABC SalesBots")
    corp = await proxy(ns, "corporation.getCorporation")
  }
  while (round >= 5 && await proxy(ns, "corporation.getUpgradeLevelCost", "ABC SalesBots") * mult / 2 < await corpFunds(ns))
    await proxy(ns, "corporation.levelUpgrade", "ABC SalesBots")
  corp = await proxy(ns, "corporation.getCorporation")
  if ((round === 3 && corp.revenue >= 8e7) || round >= 4) {
    if (await proxy(ns, "corporation.getUpgradeLevel", "Neural Accelerators") < 500 && await proxy(ns, "corporation.getUpgradeLevelCost", "Neural Accelerators") * mult < corp.funds) {
      await proxy(ns, "corporation.levelUpgrade", "Neural Accelerators")
      corp = await proxy(ns, "corporation.getCorporation")
    }
    if (await proxy(ns, "corporation.getUpgradeLevel", "Project Insight") < 500 && await proxy(ns, "corporation.getUpgradeLevelCost", "Project Insight") * mult < corp.funds) {
      await proxy(ns, "corporation.levelUpgrade", "Project Insight")
      corp = await proxy(ns, "corporation.getCorporation")
    }
    if (await proxy(ns, "corporation.getUpgradeLevel", "Nuoptimal Nootropic Injector Implants") < 500 && await proxy(ns, "corporation.getUpgradeLevelCost", "Nuoptimal Nootropic Injector Implants") * mult < corp.funds) {
      await proxy(ns, "corporation.levelUpgrade", "Nuoptimal Nootropic Injector Implants")
      corp = await proxy(ns, "corporation.getCorporation")
    }
    if (await proxy(ns, "corporation.getUpgradeLevel", "FocusWires") < 500 && await proxy(ns, "corporation.getUpgradeLevelCost", "FocusWires") * mult < corp.funds) {
      await proxy(ns, "corporation.levelUpgrade", "FocusWires")
      corp = await proxy(ns, "corporation.getCorporation")
    }
    if (await proxy(ns, "corporation.getUpgradeLevel", "Speech Processor Implants") < 500 && await proxy(ns, "corporation.getUpgradeLevelCost", "Speech Processor Implants") * mult < corp.funds) {
      await proxy(ns, "corporation.levelUpgrade", "Speech Processor Implants")
      corp = await proxy(ns, "corporation.getCorporation")
    }
  }

  if (round >= 3 && round <= 4) {
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      if (!["Tobacco", "Restaurant"].includes(hasDivDB[div].type)) continue
      const division = await proxy(ns, "corporation.getDivision", div)
      if (corp.funds >= await proxy(ns, "corporation.getHireAdVertCost", div) * mult / 2
        && (division.awareness < Number.MAX_VALUE || division.popularity < Number.MAX_VALUE)) {
        await proxy(ns, "corporation.hireAdVert", div)
        corp = await proxy(ns, "corporation.getCorporation")
      }
    }
  }
  if (round === 5) {
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      if (!["Tobacco", "Restaurant", "Computer Hardware"].includes(hasDivDB[div].type)) continue
      const division = await proxy(ns, "corporation.getDivision", div)
      while (await corpFunds(ns) >= await proxy(ns, "corporation.getHireAdVertCost", div) * mult / 2
        && (division.awareness < Number.MAX_VALUE || division.popularity < Number.MAX_VALUE))
        await proxy(ns, "corporation.hireAdVert", div)
    }
  }
}
/** @param {NS} ns */
async function getRP(ns, div) {
  const division = await proxy(ns, "corporation.getDivision", div)
  return division.researchPoints
}
/** @param {NS} ns */
async function spendRP(ns) {
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    switch (hasDivDB[div].type) {
      case "Mining":
      case "Refinery":
      case "Computer Hardware":
      case "Water Utilities":
      case "Chemical":
      case "Agriculture": {
        if (!researchedDB[div + "Hi-Tech R&D Laboratory"]) {
          if (await getRP(ns, div) / 2 > await proxy(ns, "corporation.getResearchCost", div, "Hi-Tech R&D Laboratory")) {
            await proxy(ns, "corporation.research", div, "Hi-Tech R&D Laboratory")
            researchedDB[div + "Hi-Tech R&D Laboratory"] = true
          }
          else break
        }
        if (!researchedDB[div + "Overclock"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Overclock")) {
            await proxy(ns, "corporation.research", div, "Overclock")
            researchedDB[div + "Overclock"] = true
          }
          else break
        }
        if (!researchedDB[div + "Sti.mu"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Sti.mu")) {
            await proxy(ns, "corporation.research", div, "Sti.mu")
            researchedDB[div + "Sti.mu"] = true
          }
          else break
        }
        if (!researchedDB[div + "Automatic Drug Administration"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Automatic Drug Administration")) {
            await proxy(ns, "corporation.research", div, "Automatic Drug Administration")
            researchedDB[div + "Automatic Drug Administration"] = true
          }
          else break
        }
        if (!researchedDB[div + "Go-Juice"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Go-Juice")) {
            await proxy(ns, "corporation.research", div, "Go-Juice")
            researchedDB[div + "Go-Juice"] = true
          }
          else break
        }
        if (!researchedDB[div + "CPH4 Injections"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "CPH4 Injections")) {
            await proxy(ns, "corporation.research", div, "CPH4 Injections")
            researchedDB[div + "CPH4 Injections"] = true
          }
          else break
        }
      }
        break
      case "Restaurant":
      case "Tobacco": {
        if (!researchedDB[div + "Hi-Tech R&D Laboratory"]) {
          if (await getRP(ns, div) / 2 > await proxy(ns, "corporation.getResearchCost", div, "Hi-Tech R&D Laboratory")) {
            await proxy(ns, "corporation.research", div, "Hi-Tech R&D Laboratory")
            researchedDB[div + "Hi-Tech R&D Laboratory"] = true
          }
          else break
        }
        if (!researchedDB[div + "uPgrade: Fulcrum"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "uPgrade: Fulcrum")) {
            await proxy(ns, "corporation.research", div, "uPgrade: Fulcrum")
            researchedDB[div + "uPgrade: Fulcrum"] = true
          }
          else break
          break
        }
        /*if (!researchedDB[div + "uPgrade: Capacity.I"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "uPgrade: Capacity.I")) {
            await proxy(ns, "corporation.research", div, "uPgrade: Capacity.I")
            researchedDB[div + "uPgrade: Capacity.I"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "uPgrade: Capacity.II"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "uPgrade: Capacity.II")) {
            await proxy(ns, "corporation.research", div, "uPgrade: Capacity.II")
            researchedDB[div + "uPgrade: Capacity.II"] = true
          }
          else break
          break
        }
        */
        if (!researchedDB[div + "Self-Correcting Assemblers"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Self-Correcting Assemblers")) {
            await proxy(ns, "corporation.research", div, "Self-Correcting Assemblers")
            researchedDB[div + "Self-Correcting Assemblers"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Drones")) {
            await proxy(ns, "corporation.research", div, "Drones")
            researchedDB[div + "Drones"] = true
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones - Assembly"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Drones - Assembly")) {
            await proxy(ns, "corporation.research", div, "Drones - Assembly")
            researchedDB[div + "Drones - Assembly"] = false
          }
          else break
          break
        }
        if (!researchedDB[div + "Drones - Transport"]) {
          if (await getRP(ns, div) / 10 > await proxy(ns, "corporation.getResearchCost", div, "Drones - Transport")) {
            await proxy(ns, "corporation.research", div, "Drones - Transport")
            researchedDB[div + "Drones - Transport"] = true
          }
          else break
          break
        }
      }
        break
    }
  }
}
/** @param {NS} ns */
async function manageProducts(ns) {
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    if (!hasDivDB[div].makesProducts) continue
    let active = 0
    let calculating = 0
    let division = await proxy(ns, "corporation.getDivision", div)
    for (const prod of division.products) {
      const product = await proxy(ns, "corporation.getProduct", div, "Sector-12", prod)
      if (product.developmentProgress === 100) {
        const ta2 = ta2DB[div + "Sector-12" + prod]
        if (ta2 !== undefined && ta2.markupLimit !== 0)
          active++
        else
          calculating++
      }
    }
    //Discontinue?
    if (active + calculating === division.maxProducts && calculating <= 1) {
      let worstProd = "none"
      let worstRating = Infinity
      for (const prod of division.products) {
        const product = await proxy(ns, "corporation.getProduct", div, "Sector-12", prod)
        if (product.developmentProgress != 100 || await getSellPrice(ns, div, "Sector-12", prod) === 0) continue
        if (await getSellPrice(ns, div, "Sector-12", prod) < worstRating) {
          worstProd = prod
          worstRating = await getSellPrice(ns, div, "Sector-12", prod)
        }
      }
      for (const city of cities)
        delete ta2DB[div + city + worstProd]
      await proxy(ns, "corporation.discontinueProduct", div, worstProd)
      division = await proxy(ns, "corporation.getDivision", div)
    }
    //Discontinue?
    else if (active + calculating === division.maxProducts && !tobaccoBooster) {
      let worstProd = "none"
      let worstRating = Infinity
      for (const prod of division.products) {
        const product = await proxy(ns, "corporation.getProduct", div, "Sector-12", prod)
        if (product.developmentProgress === 100 && product.stats.quality < worstRating) {
          worstProd = prod
          worstRating = product.stats.quality
        }
      }
      for (const city of cities)
        delete ta2DB[div + city + worstProd]
      await proxy(ns, "corporation.discontinueProduct", div, worstProd)
      division = await proxy(ns, "corporation.getDivision", div)
    }
    let researching = false
    if (division.products.length <= division.maxProducts) {
      //Are we researching one?
      for (const prod of division.products) {
        const product = await proxy(ns, "corporation.getProduct", div, "Sector-12", prod)
        if (product.developmentProgress < 100) {
          researching = true
          break
        }
      }
    }
    let prodname = "none:" + Math.random()
    if (hasDivDB[div].type === "Tobacco") {
      prodname = cigaretts[Math.floor(Math.random() * cigaretts.length)]
      while (division.products.includes(prodname)) {
        prodname = cigaretts[Math.floor(Math.random() * cigaretts.length)]
      }
    }
    else if (hasDivDB[div].type === "Restaurant") {
      prodname = burgers[Math.floor(Math.random() * burgers.length)]
      while (division.products.includes(prodname)) {
        prodname = burgers[Math.floor(Math.random() * burgers.length)]
      }
    }
    else if (hasDivDB[div].type === "Computer Hardware") {
      prodname = hardwares[Math.floor(Math.random() * hardwares.length)]
      while (division.products.includes(prodname)) {
        prodname = hardwares[Math.floor(Math.random() * hardwares.length)]
      }
    }
    let active2 = 0
    for (const prod of division.products) {
      const product = await proxy(ns, "corporation.getProduct", div, "Sector-12", prod)
      if (product.developmentProgress === 100)
        active2++
    }
    const corp = await proxy(ns, "corporation.getCorporation")
    if (!researching && active2 < division.maxProducts && corp.funds > 200)
      await proxy(ns, "corporation.makeProduct", div, "Sector-12", prodname, corp.funds / 100, corp.funds / 100)
  }
}
/** @param {NS} ns */
async function officeSize(ns, div, city) {
  const office = await proxy(ns, "corporation.getOffice", div, city)
  return office.size
}
/** @param {NS} ns */
async function officeNumEmployee(ns, div, city) {
  const office = await proxy(ns, "corporation.getOffice", div, city)
  return office.numEmployees
}
/** @param {NS} ns */
async function setJob(ns, div, city, job, total) {
  if (ns.ui.getGameInfo()?.versionNumber >= 44) await proxy(ns, "corporation.setJobAssignment", div, city, job, total)
  else await proxy(ns, "corporation.setAutoJobAssignment", div, city, job, total)
}
/** @param {NS} ns */
async function manageOffice(ns) {
  const round = investOffer.round
  let hasDiv2 = false
  if (hasDivDB[div2]) {
    let cityCount = 0
    for (const city of cities) {
      if (hasWarehouseDB[div2 + city])
        cityCount++
    }
    if (cityCount === 6) hasDiv2 = true
  }
  let hasDiv3 = false
  if (hasDivDB[div3]) {
    let cityCount = 0
    for (const city of cities) {
      if (hasWarehouseDB[div3 + city]) {
        cityCount++
      }
    }
    if (cityCount === 6) hasDiv3 = true
  }

  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      switch (hasDivDB[div].type) {
        case "Agriculture":
          switch (round) {
            case 1: {
              while (await officeSize(ns, div, city) < 4 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) <= await corpFunds(ns))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) {/*hireEmployee is our stoping point*/ }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              const rp = await getRP(ns, div)
              if (rp < 60 && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", await officeNumEmployee(ns, div, city))
              }
              else if (rp >= 60 && (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== 1
                || office.employeeJobs.Engineer !== 1
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Engineer", 1)
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", 1)
              }
            }
              break
            case 2: {
              while (hasDiv2 && await officeSize(ns, div, city) < 8 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) <= await corpFunds(ns)) await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              const rp = await getRP(ns, div)
              if (rp < 700 && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", await officeNumEmployee(ns, div, city))
              }
              else if (rp >= 700 && (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 2.66)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== office.numEmployees - 1 - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 2.66))) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 2.66))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                const remainder = office.numEmployees - 1 - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 2.66)
                await setJob(ns, div, city, "Management", remainder)
              }
            }
              break
            case 3: {
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (!hasDiv3
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== 1
                  || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== Math.floor(office.numEmployees / 4)
                  || office.employeeJobs["Research & Development"] !== office.numEmployees - 1 - Math.floor(office.numEmployees / 3) - 1 - Math.floor(office.numEmployees / 4))) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 4))
                const left = office.numEmployees - 1 - Math.floor(office.numEmployees / 3) - 1 - Math.floor(office.numEmployees / 4)
                await setJob(ns, div, city, "Research & Development", left)
              }
              if (!hasDiv3) break
              while (await officeSize(ns, div, city) < 8 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) <= await corpFunds(ns))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== 1
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - 1 - Math.floor(office.numEmployees / 3) - 1 - Math.floor(office.numEmployees / 4)) {
                await resetOffice(ns, div, city)
                const office = await proxy(ns, "corporation.getOffice", div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 4))
                const left = office.numEmployees - 1 - Math.floor(office.numEmployees / 3) - 1 - Math.floor(office.numEmployees / 4)
                await setJob(ns, div, city, "Research & Development", left)
              }
            }
              break
            case 4: {
              if (await officeSize(ns, div, city) < 60)
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city))
                await proxy(ns, "corporation.hireEmployee", div, city)
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== 1
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 2)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - 1 - Math.floor(office.numEmployees / 2) - 1 - Math.floor(office.numEmployees / 4)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 2))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 4))
                const left = office.numEmployees - 1 - Math.floor(office.numEmployees / 2) - 1 - Math.floor(office.numEmployees / 4)
                await setJob(ns, div, city, "Research & Development", left)
              }
            }
              break
            case 5: {
              if (await officeSize(ns, div, city) < 300)
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city))
                await proxy(ns, "corporation.hireEmployee", div, city)
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== 1
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 2.5)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 2.5)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - 1 - Math.floor(office.numEmployees / 2.5) - Math.floor(office.numEmployees / 2.5) - 1) {
                await resetOffice(ns, div, city)
                const office = await proxy(ns, "corporation.getOffice", div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 2.5))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 2.5))
                const left = office.numEmployees - 1 - Math.floor(office.numEmployees / 2.5) - Math.floor(office.numEmployees / 2.5) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
            }
          }
          break
        case "Chemical":
          switch (round) {
            case 2: {
              while (await officeSize(ns, div, city) < 3 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) <= await corpFunds(ns))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              const rp = await getRP(ns, div)
              if (rp < 390 && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office.numEmployees)
              }
              else if (rp >= 390 && (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== 1
                || office.employeeJobs.Engineer !== 1
                || office.employeeJobs.Business !== 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", 1)
                await setJob(ns, div, city, "Engineer", 1)
                await setJob(ns, div, city, "Business", 1)
              }
            }
              break
            case 3: {
              if (!hasDiv3) break
              while (await officeSize(ns, div, city) < 8 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) <= await corpFunds(ns))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.max(1, Math.floor(office.numEmployees / 4))
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.max(1, Math.floor(office.numEmployees / 4)) - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.max(1, Math.floor(office.numEmployees / 4)))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 4))
                const left = office.numEmployees - Math.max(1, Math.floor(office.numEmployees / 4)) - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
            }
              break
            case 4: {
              if (await officeSize(ns, div, city) < 60)
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city))
                await proxy(ns, "corporation.hireEmployee", div, city)
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 4))
                const left = office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
            }
              break
            case 5: {
              if (await officeSize(ns, div, city) < 300)
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (await officeNumEmployee(ns, div, city) < officeSize(ns, div, city))
                await proxy(ns, "corporation.hireEmployee", div, city)
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 3))
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
            }
          }
          break
        case "Tobacco":
          switch (round) {
            case 3: {
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (city !== "Sector-12" && !tobaccoBooster && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office.numEmployees)
              }
              else if (city === "Sector-12"
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 3)
                  || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - 1
                await setJob(ns, div, city, "Management", left)
              }
              if (!hasDiv3) break
              const corp = await proxy(ns, "corporation.getCorporation")
              const corpRev = corp.revenue
              while (await officeSize(ns, div, city) < 106 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (corpRev > 50e9)
                while (await officeSize(ns, div, city) < 226 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 20e9)
                while (await officeSize(ns, div, city) < 200 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 10e9)
                while (await officeSize(ns, div, city) < 176 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 5e9)
                while (await officeSize(ns, div, city) < 156 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 2.5e9)
                while (await officeSize(ns, div, city) < 146 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 1e9)
                while (await officeSize(ns, div, city) < 136 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 5e8)
                while (await officeSize(ns, div, city) < 116 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office2 = await proxy(ns, "corporation.getOffice", div, city)
              if (city !== "Sector-12" && !tobaccoBooster && office2.employeeJobs["Research & Development"] !== office2.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office2.numEmployees)
              }
              else if (city === "Sector-12"
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== Math.floor(office2.numEmployees / 3)
                  || office.employeeJobs.Engineer !== Math.floor(office2.numEmployees / 3)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== office2.numEmployees - Math.floor(office2.numEmployees / 3) - Math.floor(office2.numEmployees / 3) - 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office2.numEmployees / 3))
                await setJob(ns, div, city, "Engineer", Math.floor(office2.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                const left = office2.numEmployees - Math.floor(office2.numEmployees / 3) - Math.floor(office2.numEmployees / 3) - 1
                await setJob(ns, div, city, "Management", left)
              }
            }
              break
            case 4: {
              const corp = await proxy(ns, "corporation.getCorporation")
              const corpRev = corp.revenue
              if (await officeSize(ns, div, city) < 250)
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (corpRev > 2e12)
                while (await officeSize(ns, div, city) < 380 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 1e12)
                while (await officeSize(ns, div, city) < 360 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 400e9)
                while (await officeSize(ns, div, city) < 320 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 200e9)
                while (await officeSize(ns, div, city) < 290 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              else if (corpRev > 100e9)
                while (await officeSize(ns, div, city) < 270 && await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1) * 1.5 <= await corpFunds(ns))
                  await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              if (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city))
                await proxy(ns, "corporation.hireEmployee", div, city)
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (city !== "Sector-12" && !tobaccoBooster && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office.numEmployees)
              }
              else if (city === "Sector-12"
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 3)
                  || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - 1
                await setJob(ns, div, city, "Management", left)
              }
            }
              break
            case 5:
              while (await officeSize(ns, div, city) < 1500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (city !== "Sector-12" && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office.numEmployees)
              }
              else if (city === "Sector-12"
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                  || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                const left = office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Management", left)
              }
              break
          }
          break
        case "Restaurant":
          switch (round) {
            case 5:
              while (await officeSize(ns, div, city) < 1500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (city !== "Sector-12" && office.employeeJobs["Research & Development"] !== office.numEmployees) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Research & Development", office.numEmployees)
              }
              else if (city === "Sector-12"
                && (office.employeeJobs.Unassigned > 0
                  || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                  || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                  || office.employeeJobs.Business !== 1
                  || office.employeeJobs.Management !== office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1)) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                const left = office.numEmployees - Math.floor(office.numEmployees / 4) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Management", left)
              }
              break
          }
          break
        case "Water Utilities":
          switch (round) {
            case 5:
              while (await officeSize(ns, div, city) < 6500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 3))
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Computer Hardware":
          switch (round) {
            case 5:
              while (await officeSize(ns, div, city) < 4500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 3))
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Refinery":
          switch (round) {
            case 5:
              while (await officeSize(ns, div, city) < 6500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 3))
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
          }
          break
        case "Mining":
          switch (round) {
            case 5:
              while (await officeSize(ns, div, city) < 1500 && await corpFunds(ns) >= await proxy(ns, "corporation.getOfficeSizeUpgradeCost", div, city, 1))
                await proxy(ns, "corporation.upgradeOfficeSize", div, city, 1)
              while (await officeNumEmployee(ns, div, city) < await officeSize(ns, div, city) && await proxy(ns, "corporation.hireEmployee", div, city)) { }
              const office = await proxy(ns, "corporation.getOffice", div, city)
              if (office.employeeJobs.Unassigned > 0
                || office.employeeJobs.Operations !== Math.floor(office.numEmployees / 4)
                || office.employeeJobs.Engineer !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs.Business !== 1
                || office.employeeJobs.Management !== Math.floor(office.numEmployees / 3)
                || office.employeeJobs["Research & Development"] !== office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1) {
                await resetOffice(ns, div, city)
                await setJob(ns, div, city, "Operations", Math.floor(office.numEmployees / 4))
                await setJob(ns, div, city, "Business", 1)
                await setJob(ns, div, city, "Engineer", Math.floor(office.numEmployees / 3))
                await setJob(ns, div, city, "Management", Math.floor(office.numEmployees / 3))
                const left = office.numEmployees - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 3) - Math.floor(office.numEmployees / 4) - 1
                await setJob(ns, div, city, "Research & Development", left)
              }
              break
          }
          break
      }
    }
  }
}
/** @param {NS} ns */
async function resetOffice(ns, div, city) {
  await setJob(ns, div, city, "Operations", 0)
  await setJob(ns, div, city, "Engineer", 0)
  await setJob(ns, div, city, "Business", 0)
  await setJob(ns, div, city, "Management", 0)
  await setJob(ns, div, city, "Research & Development", 0)
  await setJob(ns, div, city, "Intern", 0)
}
/** @param {NS} ns */
async function teaParty(ns) {
  let needed = false
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      const office = await proxy(ns, "corporation.getOffice", div, city)
      if (office.avgEnergy < office.maxEnergy - .5) {
        await proxy(ns, "corporation.buyTea", div, city)
        needed = true
      }
      if (office.avgMorale < office.maxMorale - 10) {
        await proxy(ns, "corporation.throwParty", div, city, 500000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale - 5) {
        await proxy(ns, "corporation.throwParty", div, city, 200000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale - .5) {
        await proxy(ns, "corporation.throwParty", div, city, 100000)
        needed = true
      }
      else if (office.avgMorale < office.maxMorale) {
        await proxy(ns, "corporation.throwParty", div, city, 50000)
        needed = false
      }
    }
  }
  return needed
}
/** @param {NS} ns */
async function purchase(ns) {
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      const smartBuy = []
      const warehouse = await proxy(ns, "corporation.getWarehouse", div, city)
      if (!indDataDB[hasDivDB[div].type]) {
        indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
      }
      /* Process purchase of materials, not from smart supply */
      for (const [matName, mat] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
        // Smart supply
        let buyAmt = await maxMatRequired(ns, div, city, matName)
        const material = await proxy(ns, "corporation.getMaterial", div, city, matName)
        buyAmt -= material.stored
        if (!matDataDB[matName])
          matDataDB[matName] = await proxy(ns, "corporation.getMaterialData", matName)
        const maxAmt = Math.floor((warehouse.size - warehouse.sizeUsed) / matDataDB[matName].size);
        buyAmt = Math.min(buyAmt, maxAmt);
        smartBuy[matName] = [buyAmt, mat];
      } //End process purchase of materials

      // Use the materials already in the warehouse if the option is on.
      for (const [matName, [buy, reqMat]] of Object.entries(smartBuy)) {
        const buyAmt = buy
        const mult = await getMult(ns, div, city)
        if (mult[0] === 0) {
          await proxy(ns, "corporation.buyMaterial", div, city, matName, 0)
          await proxy(ns, "corporation.sellMaterial", div, city, matName, "MAX", "0")
        }
        else if (buyAmt > 0) {
          await proxy(ns, "corporation.buyMaterial", div, city, matName, buyAmt / 10)
          await proxy(ns, "corporation.sellMaterial", div, city, matName, 0, "MP")
        }
        else {
          await proxy(ns, "corporation.buyMaterial", div, city, matName, 0)
          const material = await proxy(ns, "corporation.getMaterial", div, city, matName)
          if (material.quality <= 1)
            await proxy(ns, "corporation.sellMaterial", div, city, matName, buyAmt / 10 * -1, "0")
          else await proxy(ns, "corporation.sellMaterial", div, city, matName, buyAmt / 10 * -1, "MP")
        }
      }
    }//city
  }//div
}
/** @param {NS} ns */
async function importExport(ns) {
  if (!researchedDB["Export"]) return
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    if (!indDataDB[hasDivDB[div].type])
      indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
    if (!indDataDB[hasDivDB[div].type].makesMaterials) continue
    for (const city of cities) {
      //We make this.  Export it
      for (const name of Object.values(indDataDB[hasDivDB[div].type].producedMaterials)) {
        if (name === "Plants") { //(IPROD+IINV/10)*(-1)   (-IPROD-IINV/10)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div3, "Sector-12", name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div3, city, name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div2, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div2, city, name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div3, city, name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div3, "Sector-12", name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Chemicals") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div1, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div1, city, name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Food") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div4, "Sector-12", name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div4, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div4, "Sector-12", name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div4, city, name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Water") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div1, city, name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div2, city, name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div4, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div1, city, name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div2, city, name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div4, city, name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Hardware") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div5, city, name)
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div8, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div5, city, name, `(IPROD+IINV/10)*(-1)`)
          await proxy(ns, "corporation.exportMaterial", div, city, div8, city, name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Metal") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div6, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div6, city, name, `(IPROD+IINV/10)*(-1)`)
        }
        else if (name === "Ore") {
          await proxy(ns, "corporation.cancelExportMaterial", div, city, div7, city, name)
          await proxy(ns, "corporation.exportMaterial", div, city, div7, city, name, `(IPROD+IINV/10)*(-1)`)
        }
      }
    }
  }
}
/** @param {NS} ns */
async function optimizeMats(ns) {
  const round = investOffer.round
  let runningWorkers = 0
  const results = []
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      const type = hasDivDB[div].type
      if (!indDataDB[type])
        indDataDB[type] = await proxy(ns, "corporation.getIndustryData", type)
      let { hardwareFactor, robotFactor, aiCoreFactor, realEstateFactor } = indDataDB[type]
      if (isNaN(hardwareFactor)) hardwareFactor = 0
      if (isNaN(robotFactor)) robotFactor = 0
      if (isNaN(aiCoreFactor)) aiCoreFactor = 0
      if (isNaN(realEstateFactor)) realEstateFactor = 0

      const divWeights = [hardwareFactor, robotFactor, aiCoreFactor, realEstateFactor]
      if (!matDataDB["Hardware"])
        matDataDB["Hardware"] = await proxy(ns, "corporation.getMaterialData", "Hardware")
      if (!matDataDB["Robots"])
        matDataDB["Robots"] = await proxy(ns, "corporation.getMaterialData", "Robots")
      if (!matDataDB["AI Cores"])
        matDataDB["AI Cores"] = await proxy(ns, "corporation.getMaterialData", "AI Cores")
      if (!matDataDB["Real Estate"])
        matDataDB["Real Estate"] = await proxy(ns, "corporation.getMaterialData", "Real Estate")
      const matSizes = ["Hardware", "Robots", "AI Cores", "Real Estate"].map((mat) => matDataDB[mat].size)
      let maxProd = await maxProduced(ns, div, city)
      if (round < 3) maxProd *= 1.01
      else maxProd *= 1.1
      const warehouse = await proxy(ns, "corporation.getWarehouse", div, city)
      //Start webworkers here
      let worker = await getWorker(ns)
      runningWorkers++
      //Set up promise for when worker is done to run async
      worker.onmessage = (msg) => {
        //msg.data[x] should be:  0:results, 1:div, 2:city
        results[msg.data[1] + msg.data[2]] = msg.data[0]
        if (!globalThis["SphyxOSCorpWebWorkers"].includes(worker)) //On script kill, workersWIP gets dumped into storage as dirty - or directly
          globalThis["SphyxOSCorpWebWorkers"].push({ workerReady: worker }) //That will fire on script kill, this could fire shortly after that
        workersWIP = workersWIP.filter(w => w !== worker) //If it fires before, it will be empty when it gets dumped
        worker = null
        runningWorkers--
      }
      //Send data to worker now that we can handle the return
      worker.postMessage([matSizes, divWeights, warehouse.size - maxProd, false, div, city])
      workersWIP.push(worker)
    }
  }
  //Wait for our workers to finish
  while (runningWorkers > 0) await ns.asleep(4)

  //Process the results
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      //[Hardware, Robots, AI Cores, Real Estate]
      const [hardware, robots, aicores, realestate] = results[div + city]
      const hw = await proxy(ns, "corporation.getMaterial", div, city, "Hardware")
      const hardwareStored = hw.stored
      if (hardwareStored === hardware) {
        await proxy(ns, "corporation.buyMaterial", div, city, "Hardware", 0)
        await proxy(ns, "corporation.sellMaterial", div, city, "Hardware", 0, "MP")
      }
      else if (hardwareStored < hardware) {
        if (round >= 4) await proxy(ns, "corporation.buyMaterial", div, city, "Hardware", (hardware - hardwareStored) / 10 / 10)
        else await proxy(ns, "corporation.buyMaterial", div, city, "Hardware", (hardware - hardwareStored) / 10)
        await proxy(ns, "corporation.sellMaterial", div, city, "Hardware", 0, "MP")
      }
      else {
        if (round >= 4) {
          await proxy(ns, "corporation.sellMaterial", div, city, "Hardware", (hardwareStored - hardware) / 10 / 10, "0")
        }
        else await proxy(ns, "corporation.sellMaterial", div, city, "Hardware", (hardwareStored - hardware) / 10, "MP")
        await proxy(ns, "corporation.buyMaterial", div, city, "Hardware", 0)
      }
      const ro = await proxy(ns, "corporation.getMaterial", div, city, "Robots")
      const robotsStored = ro.stored
      if (robotsStored === robots) {
        await proxy(ns, "corporation.buyMaterial", div, city, "Robots", 0)
        await proxy(ns, "corporation.sellMaterial", div, city, "Robots", 0, "MP")
      }
      else if (robotsStored < robots) {
        if (round >= 4) await proxy(ns, "corporation.buyMaterial", div, city, "Robots", (robots - robotsStored) / 10 / 10)
        else await proxy(ns, "corporation.buyMaterial", div, city, "Robots", (robots - robotsStored) / 10)
        await proxy(ns, "corporation.sellMaterial", div, city, "Robots", 0, "MP")
      }
      else {
        if (round >= 4) {
          await proxy(ns, "corporation.sellMaterial", div, city, "Robots", (robotsStored - robots) / 10 / 10, "0")
        }
        else await proxy(ns, "corporation.sellMaterial", div, city, "Robots", (robotsStored - robots) / 10, "MP")
        await proxy(ns, "corporation.buyMaterial", div, city, "Robots", 0)
      }
      const ai = await proxy(ns, "corporation.getMaterial", div, city, "AI Cores")
      const aiCoresStored = ai.stored
      if (aiCoresStored === aicores) {
        await proxy(ns, "corporation.buyMaterial", div, city, "AI Cores", 0)
        await proxy(ns, "corporation.sellMaterial", div, city, "AI Cores", 0, "MP")
      }
      else if (aiCoresStored < aicores) {
        if (round >= 4) await proxy(ns, "corporation.buyMaterial", div, city, "AI Cores", (aicores - aiCoresStored) / 10 / 10)
        else await proxy(ns, "corporation.buyMaterial", div, city, "AI Cores", (aicores - aiCoresStored) / 10)
        await proxy(ns, "corporation.sellMaterial", div, city, "AI Cores", 0, "MP")
      }
      else {
        if (round >= 4) {
          await proxy(ns, "corporation.sellMaterial", div, city, "AI Cores", (aiCoresStored - aicores) / 10 / 10, "0")
        }
        else await proxy(ns, "corporation.sellMaterial", div, city, "AI Cores", (aiCoresStored - aicores) / 10, "MP")
        await proxy(ns, "corporation.buyMaterial", div, city, "AI Cores", 0)
      }
      const re = await proxy(ns, "corporation.getMaterial", div, city, "Real Estate")
      const realEstateStored = re.stored
      if (realEstateStored === realestate) {
        await proxy(ns, "corporation.buyMaterial", div, city, "Real Estate", 0)
        await proxy(ns, "corporation.sellMaterial", div, city, "Real Estate", 0, "MP")
      }
      else if (realEstateStored < realestate) {
        if (round >= 4) await proxy(ns, "corporation.buyMaterial", div, city, "Real Estate", (realestate - realEstateStored) / 10 / 10)
        else await proxy(ns, "corporation.buyMaterial", div, city, "Real Estate", (realestate - realEstateStored) / 10)
        await proxy(ns, "corporation.sellMaterial", div, city, "Real Estate", 0, "MP")
      }
      else {
        if (round >= 4) {
          await proxy(ns, "corporation.sellMaterial", div, city, "Real Estate", (realEstateStored - realestate) / 10 / 10, "0")
        }
        else await proxy(ns, "corporation.sellMaterial", div, city, "Real Estate", (realEstateStored - realestate) / 10, "MP")
        await proxy(ns, "corporation.buyMaterial", div, city, "Real Estate", 0)
      }
    }
  }
}
/** @param {NS} ns */
async function maxProduction(ns, div, city) {
  if (!hasWarehouseDB[div + city]) return [0, 0]
  const mult = await getMult(ns, div, city)
  return [10 * mult[0], 10 * mult[1]]
}
/** @param {NS} ns */
async function maxMatRequired(ns, div, city, matID) {
  if (!hasDivDB[div]) return 0
  if (!hasWarehouseDB[div + city]) return 0
  let productMult = 0
  if (indDataDB[hasDivDB[div].type] === undefined)
    indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
  if (indDataDB[hasDivDB[div].type].makesProducts) {
    let products = 0
    const division = await proxy(ns, "corporation.getDivision", div)
    for (const prod of division.products) {
      const product = await proxy(ns, "corporation.getProduct", div, city, prod)
      if (product.developmentProgress === 100)
        products++
    }
    productMult = products
  }
  else productMult = 1

  for (const [matName, mat] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
    if (matName !== matID) continue
    // Smart supply
    let required = 0
    const mult = await getMult(ns, div, city)
    if (hasDivDB[div].makesProducts) required += 10 * mult[1] * mat * productMult
    if (indDataDB[hasDivDB[div].type].makesMaterials) required += 10 * mult[0] * mat
    return required
  } //End process purchase of materials
  return 0
}
/** @param {NS} ns */
async function maxProduced(ns, div, city) {
  if (!hasWarehouseDB[div + city]) return 0
  const mult = await getMult(ns, div, city)
  const multMaterial = mult[0]
  const multProduct = mult[1]
  if (multMaterial === 0) return 0

  let totalSize = 0
  if (indDataDB[hasDivDB[div].type] === undefined)
    indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
  for (const [matName, matAmount] of Object.entries(indDataDB[hasDivDB[div].type].requiredMaterials)) {
    if (matDataDB[matName] === undefined)
      matDataDB[matName] = await proxy(ns, "corporation.getMaterialData", matName)
    totalSize += await maxMatRequired(ns, div, city, matName) * matDataDB[matName].size
  }
  if (indDataDB[hasDivDB[div].type].makesMaterials)
    for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
      if (matDataDB[mat] === undefined)
        matDataDB[mat] = await proxy(ns, "corporation.getMaterialData", mat)
      totalSize += matDataDB[mat].size * 10 * multMaterial
      const material = await proxy(ns, "corporation.getMaterial", div, city, mat)
      totalSize += material.stored * matDataDB[mat].size
    }
  const division = await proxy(ns, "corporation.getDivision", div)
  for (const prod of division.products) {
    const product = await proxy(ns, "corporation.getProduct", div, city, prod)
    if (product.developmentProgress === 100) {
      totalSize += product.size * 10 * multProduct
      totalSize += product.stored * product.size
    }
  }
  return totalSize
}
/** @param {NS} ns */
async function warehouseUpgrade(ns) {
  const round = investOffer.round
  let hasDiv2 = false
  let count = 0
  for (const city of cities)
    if (hasWarehouseDB[div2 + city]) count++
  if (count === 6)
    hasDiv2 = true

  let hasDiv3 = false
  let cityCount = 0
  for (const city of cities)
    if (hasWarehouseDB[div3 + city]) cityCount++
  if (cityCount === 6) hasDiv3 = true

  while (count < 8) {
    if (round >= 3) count++
    let smartStorageIncrease = 0
    const smartStorage = await proxy(ns, "corporation.getUpgradeLevel", "Smart Storage")
    for (const div of industries) {
      if (!hasDivDB[div]) continue
      if (round === 2 && hasDivDB[div].type === "Chemical") continue
      for (const city of cities) {
        if (!hasWarehouseDB[div + city]) continue
        const warehouse = await proxy(ns, "corporation.getWarehouse", div, city)
        let divMult = researchedDB[div + "Drones - Transport"] ? 1.5 : 1
        smartStorageIncrease += (warehouse.level * 100 * (1 + ((smartStorage + 1) * .1)) * divMult) - (warehouse.level * 100 * (1 + (smartStorage * .1)) * divMult)
      }
    }
    const funds = await corpFunds(ns)
    if ((hasDiv2 && smartStorage >= 30)
      || (!hasDiv2 && smartStorage >= 10))
      smartStorageIncrease = 0

    let bestUpgradeType = "none"
    let bestUpgradeCity = "none"
    let bestUpgradeRatio = 0
    let bestAgriCity = "none"
    let bestAgriRatio = 0
    let bestChemCity = "none"
    let bestChemRatio = 0
    let bestWaterCity = "none"
    let bestWaterRatio = 0
    let bestComputerCity = "none"
    let bestComputerRatio = 0
    let bestRefineryCity = "none"
    let bestRefineryRatio = 0
    let bestMiningCity = "none"
    let bestMiningRatio = 0
    const smartUpgrade = await proxy(ns, "corporation.getUpgradeLevelCost", "Smart Storage")
    let smartRatio = smartStorageIncrease === 0 ? 0 : smartStorageIncrease / smartUpgrade

    for (const div of industries) {
      if (!hasDivDB[div]) continue
      for (const city of cities) {
        if (!hasWarehouseDB[div + city]) continue
        const warehouse = await proxy(ns, "corporation.getWarehouse", div, city)
        const wUpgrade = await proxy(ns, "corporation.getUpgradeWarehouseCost", div, city)
        const smartStorageMult = 1 + (smartStorage * .1)
        let divMult = researchedDB[div + "Drones - Transport"] ? 1.5 : 1
        let warehouseIncrease = ((warehouse.level + 1) * 100 * smartStorageMult * divMult) - warehouse.size
        let warehouseRatio = warehouseIncrease / wUpgrade
        //if (round === 2 && (warehouse.level === 2 || !hasDiv2) && hasDivDB[div].type === "Chemical") warehouseRatio = 0 //Early break on Chemical warehouse upgrade until we get all of Chemical
        if (hasDivDB[div].type === "Agriculture" && warehouseRatio > bestAgriRatio) {
          bestAgriCity = city
          bestAgriRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Chemical" && warehouseRatio > bestChemRatio) {
          bestChemCity = city
          bestChemRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Water Utilities" && warehouseRatio > bestWaterRatio) {
          bestWaterCity = city
          bestWaterRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Computer Hardware" && warehouseRatio > bestComputerRatio) {
          bestComputerCity = city
          bestComputerRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Refinery" && warehouseRatio > bestRefineryRatio) {
          bestRefineryCity = city
          bestRefineryRatio = warehouseRatio
        }
        else if (hasDivDB[div].type === "Mining" && warehouseRatio > bestMiningRatio) {
          bestMiningCity = city
          bestMiningRatio = warehouseRatio
        }
        const maxProd = await maxProduction(ns, div, city)
        if (round >= 3 && hasDivDB[div].type === "Agriculture") {
          if (maxProd[0] > await maxMatRequired(ns, div4, city, "Food") && maxProd[0] > (await maxMatRequired(ns, div2, city, "Plants") + await maxMatRequired(ns, div3, "Sector-12", "Plants")))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round >= 3 && hasDivDB[div].type === "Chemical") {
          if (maxProd[0] > await maxMatRequired(ns, div1, city, "Chemicals") || !hasDiv3)
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round >= 5 && hasDivDB[div].type === "Water Utilities") {
          if (maxProd[0] > await maxMatRequired(ns, div1, city, "Water") + await maxMatRequired(ns, div2, city, "Water") + await maxMatRequired(ns, div4, city, "Water"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round >= 5 && hasDivDB[div].type === "Computer Hardware") {
          if (maxProd[0] > await maxMatRequired(ns, div5, city, "Hardware") + await maxMatRequired(ns, div8, city, "Hardware"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round >= 5 && hasDivDB[div].type === "Refinery") {
          if (maxProd[0] > await maxMatRequired(ns, div6, city, "Metal"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round >= 5 && hasDivDB[div].type === "Mining") {
          if (maxProd[0] > await maxMatRequired(ns, div7, city, "Metal"))
            warehouseRatio = 0
          else warehouseRatio *= .9
        }
        else if (round === 2 && !hasDiv2 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if (round === 2 && hasDiv2 && warehouse.level >= 20 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if (round === 3 && !hasDiv3 && hasDivDB[div].type === "Agriculture") {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if (round === 3 && !hasDiv3 && warehouse.level >= 3 && hasDivDB[div].type === "Chemical") {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if (round === 3 && !hasDiv3 && hasDivDB[div].type === "Tobacco") {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if (round === 2 && ((hasDivDB[div].type === "Chemical" && (warehouse.level === 2 || !hasDiv2)))) {
          warehouseRatio = 0
          smartRatio = 0
        }
        else if ((round >= 3) && ["Tobacco", "Restaurant"].includes(hasDivDB[div].type) && warehouse.level >= 5)
          warehouseRatio = 0
        //Round 2 - upgrade chem once
        if (round === 2 && hasDivDB[div].type === "Chemical" && warehouse.level === 1) {
          bestUpgradeType = div
          bestUpgradeCity = city
          bestUpgradeRatio = Infinity
        }
        else if (warehouseRatio > smartRatio && warehouseRatio > bestUpgradeRatio) {
          bestUpgradeType = div
          bestUpgradeCity = city
          bestUpgradeRatio = warehouseRatio
        }
        else if (smartRatio > bestUpgradeRatio) {
          bestUpgradeType = "Smart"
          bestUpgradeRatio = smartRatio
        }
      }
    }
    if (!["Smart", "none"].includes(bestUpgradeType)) {
      if (hasDivDB[bestUpgradeType].type === "Agriculture") {
        bestUpgradeCity = bestAgriCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Chemical") {
        bestUpgradeCity = bestChemCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Water Utilities") {
        bestUpgradeCity = bestWaterCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Computer Hardware") {
        bestUpgradeCity = bestComputerCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Refinery") {
        bestUpgradeCity = bestRefineryCity
      }
      else if (hasDivDB[bestUpgradeType].type === "Mining") {
        bestUpgradeCity = bestMiningCity
      }
    }
    if (round >= 3) {
      if (bestUpgradeType === "none") break
      else if (bestUpgradeType === "Smart" && funds >= await proxy(ns, "corporation.getUpgradeLevelCost", "Smart Storage") * 1.5) {
        await proxy(ns, "corporation.levelUpgrade", "Smart Storage")
      }
      else if (bestUpgradeCity !== "none" && funds >= await proxy(ns, "corporation.getUpgradeWarehouseCost", bestUpgradeType, bestUpgradeCity) * 1.5) {
        await proxy(ns, "corporation.upgradeWarehouse", bestUpgradeType, bestUpgradeCity)
      }
      else break
    }
    else {
      if (bestUpgradeType === "none") break
      else if (bestUpgradeType === "Smart" && funds >= await proxy(ns, "corporation.getUpgradeLevelCost", "Smart Storage")) {
        await proxy(ns, "corporation.levelUpgrade", "Smart Storage")
      }
      else if (bestUpgradeCity !== "none" && funds >= await proxy(ns, "corporation.getUpgradeWarehouseCost", bestUpgradeType, bestUpgradeCity)) {
        await proxy(ns, "corporation.upgradeWarehouse", bestUpgradeType, bestUpgradeCity)
      }
      else break
    }
  }
}
/** @param {NS} ns */
async function getSellPrice(ns, div, city, prod) {
  const ta2 = ta2DB[div + city + prod]
  if (ta2 === undefined || ta2.markupLimit === 0) return 0
  const product = await proxy(ns, "corporation.getProduct", div, city, prod)
  const prodMarketPrice = 5 * product.productionCost
  return (((ta2.markupLimit * Math.sqrt(1)) / Math.sqrt(1)) + prodMarketPrice) * 10
}
/** @param {NS} ns */
async function sell(ns) {
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    const hasMTAII = await proxy(ns, "corporation.hasResearched", div, "Market-TA.II")
    for (const city of cities) {
      if (!hasWarehouseDB[div + city]) continue
      if (researchedDB["Market Research - Demand"] && researchedDB["Market Data - Competition"]) {
        if (indDataDB[hasDivDB[div].type] === undefined)
          indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
        if (indDataDB[hasDivDB[div].type].makesProducts) {
          const division = await proxy(ns, "corporation.getDivision", div)
          for (const prod of division.products) {
            const product = await proxy(ns, "corporation.getProduct", div, city, prod)
            if (product.developmentProgress !== 100 || product.stored === 0) continue
            //Setting Market TA II if researchedDB
            if (hasMTAII) { //I don't research it, but it could be there from manual purchase
              await proxy(ns, "corporation.setProductMarketTA2", div, prod, true)
              await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", "0")
              continue
            }

            let ta2 = ta2DB[div + city + prod]
            if (ta2 === undefined) { //No TA2 data
              ta2DB[div + city + prod] = {
                "sellingPrice": product.rating,
                "sellingQuantity": product.stored,
                "markupLimit": 0
              }
              await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", (product.rating).toString())
              continue
            }
            const prodMarketPrice = 5 * product.productionCost
            if (ta2.markupLimit === 0) { //Not calculated yet
              const actualSellAmount = product.actualSellAmount
              if (actualSellAmount >= ta2.sellingQuantity / 10) { // We failed to set it high enough.  Set it higher and try again
                const oldSalePrice = ta2DB[div + city + prod].sellingPrice
                ta2DB[div + city + prod].sellingPrice = oldSalePrice * 1000
                ta2DB[div + city + prod].sellingQuantity = product.stored
                await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", (oldSalePrice * 1000).toString())
                continue
              }
              else if (actualSellAmount <= ta2.sellingQuantity / 10 * .15) { //Not enough sold, lower the price!
                const oldSalePrice = ta2DB[div + city + prod].sellingPrice
                ta2DB[div + city + prod].sellingPrice = oldSalePrice / 3
                ta2DB[div + city + prod].sellingQuantity = product.stored
                await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", (oldSalePrice / 3).toString())
                continue
              }
              const mult = await getMult(ns, div, city)
              const m = mult[1]
              const markupLimit = (ta2.sellingPrice - prodMarketPrice) * Math.sqrt(actualSellAmount / m)
              ta2DB[div + city + prod].markupLimit = markupLimit
              ta2 = ta2DB[div + city + prod]
            }
            const prodStored = product.stored
            let sellingPrice = (((ta2.markupLimit * Math.sqrt(prodStored)) / Math.sqrt(prodStored)) + prodMarketPrice) * 10
            const priceMult = product.productionAmount / prodStored
            if (priceMult !== Infinity) sellingPrice *= priceMult >= 1 ? 1 : priceMult
            if (sellingPrice < 0 || isNaN(sellingPrice)) {
              const oldSalePrice = ta2DB[div + city + prod].sellingPrice
              ta2DB[div + city + prod].sellingPrice = oldSalePrice * 10
              ta2DB[div + city + prod].sellingQuantity = prodStored
              ta2DB[div + city + prod].markupLimit = 0
              await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", (oldSalePrice * 10).toString())
              continue
            }
            await proxy(ns, "corporation.sellProduct", div, city, prod, "MAX", sellingPrice.toString())
          } //Products
        } //Product check
        if (indDataDB[hasDivDB[div].type].producedMaterials)
          for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
            const material = await proxy(ns, "corporation.getMaterial", div, city, mat)
            if (material.stored === 0) continue
            let exported = 0
            for (const xp of material.exports) {
              const expoMat = await proxy(ns, "corporation.getMaterial", xp.division, xp.city, mat)
              exported += expoMat.importAmount
            }

            //Set TA2 if we have it
            if (researchedDB[div + "Market-TA.II"]) {
              await proxy(ns, "corporation.setMaterialMarketTA2", div, city, mat, true)
              await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", "0")
              continue
            }
            let ta2 = ta2DB[div + city + mat]
            if (ta2 === undefined) { //No TA2 data              
              ta2DB[div + city + mat] = {
                "sellingPrice": material.marketPrice,
                "sellingQuantity": material.stored + (exported * 10),
                "markupLimit": 0
              }
              await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", (material.marketPrice).toString())
              continue
            }
            const prodMarketPrice = material.marketPrice
            const mult = await getMult(ns, div, city)
            const m = mult[0]
            if (ta2.markupLimit === 0) { //Not calculated yet
              const actualSellAmount = material.actualSellAmount
              if (actualSellAmount >= (ta2.sellingQuantity) / 10) { // We failed to set it high enough.  Set it higher and try again
                const oldSalePrice = ta2DB[div + city + mat].sellingPrice
                ta2DB[div + city + mat].sellingPrice = oldSalePrice * 1.2
                ta2DB[div + city + mat].sellingQuantity = material.stored + (exported * 10)
                await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", (oldSalePrice * 1.2).toString())
                continue
              }
              else if (actualSellAmount <= (ta2.sellingQuantity) / 10 * .1) { //Not enough sold, lower the price!
                const oldSalePrice = ta2DB[div + city + mat].sellingPrice
                ta2DB[div + city + mat].sellingPrice = oldSalePrice * .9
                ta2DB[div + city + mat].sellingQuantity = material.stored + (exported * 10)
                await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", (oldSalePrice * .9).toString())
                continue
              }
              const markupLimit = (ta2.sellingPrice - prodMarketPrice) * Math.sqrt(actualSellAmount / m)
              ta2DB[div + city + mat].markupLimit = markupLimit
              ta2 = ta2DB[div + city + mat]
            }
            const prodStored = material.stored
            let sellingPrice = (((ta2.markupLimit * Math.sqrt(prodStored)) / Math.sqrt(prodStored)) + prodMarketPrice) * 10
            const priceMult = (material.productionAmount - exported) / prodStored
            if (priceMult !== Infinity) sellingPrice *= priceMult >= 1 ? 1 : priceMult
            if (sellingPrice < 0 || isNaN(sellingPrice)) {
              const oldSalePrice = ta2DB[div + city + mat].sellingPrice
              ta2DB[div + city + mat].sellingPrice = oldSalePrice * 2
              ta2DB[div + city + mat].sellingQuantity = prodStored + (exported * 10)
              ta2DB[div + city + mat].markupLimit = 0
              await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", (oldSalePrice * 2).toString())
              continue
            }
            await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", sellingPrice.toString())
          }
      } //TA2
      else { // No TA2
        if (!indDataDB[hasDivDB[div].type])
          indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
        if (indDataDB[hasDivDB[div].type].producedMaterials) {
          for (const mat of indDataDB[hasDivDB[div].type].producedMaterials) {
            const material = await proxy(ns, "corporation.getMaterial", div, city, mat)
            if (material.stored === 0) continue
            const marketPrice = material.marketPrice
            if (!matDataDB[mat])
              matDataDB[mat] = await proxy(ns, "corporation.getMaterialData", mat)
            let price = marketPrice + (material.quality / matDataDB[mat].baseMarkup)
            const maxProd = await maxProduction(ns, div, city)
            const priceMult = maxProd[0] / (material.stored)
            price *= priceMult >= 1 ? 1 : priceMult >= .6 ? priceMult : priceMult / 10
            await proxy(ns, "corporation.sellMaterial", div, city, mat, "MAX", price)
          }
        }
      }
    }
  }
}
/** @param {NS} ns */
async function getMult(ns, div, city) {
  if (!hasOfficeDB[div + city]) return [0, 0] //[Material, Product]
  const office = await proxy(ns, "corporation.getOffice", div, city)
  const operationEmployeesProduction = office.employeeProductionByJob.Operations
  const engineerEmployeesProduction = office.employeeProductionByJob.Engineer
  const managementEmployeesProduction = office.employeeProductionByJob.Management
  const totalEmployeesProduction = operationEmployeesProduction + engineerEmployeesProduction + managementEmployeesProduction;
  if (totalEmployeesProduction <= 0) return [0, 0]
  const managementFactor = 1 + managementEmployeesProduction / (1.2 * totalEmployeesProduction)
  const employeesProductionMultiplier = (Math.pow(operationEmployeesProduction, 0.4) + Math.pow(engineerEmployeesProduction, 0.3)) * managementFactor;
  const balancingMultiplier = 0.05;
  const officeMultiplierProduct = 0.5 * balancingMultiplier * employeesProductionMultiplier;
  const officeMultiplierMaterial = balancingMultiplier * employeesProductionMultiplier;

  // Multiplier from Smart Factories
  const upgradeMultiplier = 1 + (await proxy(ns, "corporation.getUpgradeLevel", "Smart Factories") * 0.03)
  // Multiplier from researches
  let researchMultiplier = 1
  researchMultiplier *=
    (researchedDB[div + "Drones - Assembly"] ? 1.2 : 1)
    * (researchedDB[div + "Self-Correcting Assemblers"] ? 1.1 : 1);
  if (hasDivDB[div].makesProducts) {
    researchMultiplier *= (researchedDB[div + "uPgrade: Fulcrum"] ? 1.05 : 1);
  }
  let multSum = 0;
  if (!indDataDB[hasDivDB[div].type])
    indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", hasDivDB[div].type)
  for (const scity of cities) {
    if (!hasWarehouseDB[div + scity]) continue
    const real = await proxy(ns, "corporation.getMaterial", div, scity, "Real Estate")
    const hard = await proxy(ns, "corporation.getMaterial", div, scity, "Hardware")
    const robo = await proxy(ns, "corporation.getMaterial", div, scity, "Robots")
    const ai = await proxy(ns, "corporation.getMaterial", div, scity, "AI Cores")
    let realestate = Math.pow(0.002 * real.stored + 1, indDataDB[hasDivDB[div].type].realEstateFactor)
    let hardware = Math.pow(0.002 * hard.stored + 1, indDataDB[hasDivDB[div].type].hardwareFactor)
    let robots = Math.pow(0.002 * robo.stored + 1, indDataDB[hasDivDB[div].type].robotFactor)
    let aicores = Math.pow(0.002 * ai.stored + 1, indDataDB[hasDivDB[div].type].aiCoreFactor);
    if (isNaN(realestate)) realestate = 1
    if (isNaN(hardware)) hardware = 1
    if (isNaN(robots)) robots = 1
    if (isNaN(aicores)) aicores = 1
    const cityMult =
      realestate *
      hardware *
      robots *
      aicores
    multSum += Math.pow(cityMult, 0.73);
  }
  const productionMult = multSum < 1 ? 1 : multSum
  const multMaterial = officeMultiplierMaterial * productionMult * upgradeMultiplier * researchMultiplier
  const multProduct = officeMultiplierProduct * productionMult * upgradeMultiplier * researchMultiplier
  return [multMaterial, multProduct]
}
function clearLogs(ns) {
  ns.clearLog()
  if (win) win.clear()
}
function update(ns, text) {
  ns.printRaw(text)
  if (win && win.closed) {
    win = false
    ns.writePort(1, "puppet popout off")
  }
  if (win) win.update(text)
}
/** @param {NS} ns */
async function updateHud(ns) {
  clearLogs(ns)
  const cObj = await proxy(ns, "corporation.getCorporation")
  const bnMults = await getBNMults(ns)
  update(ns, ns.sprintf("%s", cObj.name))
  update(ns, ns.sprintf("Funds: $%s  Profit: $%s/s", fNumber(ns, cObj.funds, 3), fNumber(ns, cObj.revenue - cObj.expenses, 3)))
  const invest = investOffer
  const upgrades = await proxy(ns, "corporation.getUpgradeLevel", "Neural Accelerators")
    + await proxy(ns, "corporation.getUpgradeLevel", "Project Insight")
    + await proxy(ns, "corporation.getUpgradeLevel", "Nuoptimal Nootropic Injector Implants")
    + await proxy(ns, "corporation.getUpgradeLevel", "FocusWires")
    + await proxy(ns, "corporation.getUpgradeLevel", "Speech Processor Implants")
    + await proxy(ns, "corporation.getUpgradeLevel", "FocusWires")
  const offer = invest.round === 1 ? (round1Money * bnMults.CorporationValuation)
    : invest.round === 2 ? (round2Money * bnMults.CorporationValuation)
      : invest.round === 3 ? (round3Money * bnMults.CorporationValuation)
        : invest.round === 4 ? (round4Money * bnMults.CorporationValuation)
          : 0
  const minRound = invest.round === 2 ? "-BareMin 30b" : ""
  const produpgrades = await proxy(ns, "corporation.getUpgradeLevel", "Smart Factories") + await proxy(ns, "corporation.getUpgradeLevel", "Smart Storage")
  update(ns, ns.sprintf("Round: %s  Offer: %s FundsReq: %s  %s", invest.round, fNumber(ns, invest.funds, 3), fNumber(ns, offer, 3), minRound))
  update(ns, ns.sprintf("Empl Upgrades: %s  Prod Upgrades: %s  Profit Upgrades: %s  Wilson: %s", upgrades, produpgrades, await proxy(ns, "corporation.getUpgradeLevel", "ABC SalesBots"), await proxy(ns, "corporation.getUpgradeLevel", "Wilson Analytics")))
  const state = cObj.nextState === "PURCHASE" ? "START"
    : cObj.nextState === "PRODUCTION" ? "PURCHASE"
      : cObj.nextState === "EXPORT" ? "PRODUCTION"
        : cObj.nextState === "SALE" ? "EXPORT"
          : "SALE"
  update(ns, ns.sprintf("Stage: %s", state))
  for (const div of industries) {
    if (!hasDivDB[div]) continue
    const division = await proxy(ns, "corporation.getDivision", div)
    update(ns, ns.sprintf("-%s(%s)  Profit: $%s/s  Awareness: %s  Pop: %s", div, division.type, fNumber(ns, division.lastCycleRevenue - division.lastCycleExpenses, 3), fNumber(ns, division.awareness, 3), fNumber(ns, division.popularity, 3)))
    let wCount = 0
    let wSpace = 0
    let wSpaceUsed = 0
    let oCount = 0
    let oEmployees = 0
    let oSize = 0
    for (const city of cities) {
      if (!hasOfficeDB[div + city]) continue
      if (hasWarehouseDB[div + city]) {
        wCount++
        const warehouse = await proxy(ns, "corporation.getWarehouse", div, city)
        wSpace += warehouse.size
        wSpaceUsed += warehouse.sizeUsed
      }
      try {
        const office = await proxy(ns, "corporation.getOffice", div, city)
        oEmployees += office.numEmployees
        oCount++
        oSize += office.size
      }
      catch { }
    }
    update(ns, ns.sprintf("  Warehouse Space: (%s/6) %s/%s  Office Usage: (%s/6) %s/%s  Research: %s", wCount, Math.round(wSpaceUsed), Math.round(wSpace), oCount, oEmployees, oSize, fNumber(ns, division.researchPoints, 3)))
    if (indDataDB[hasDivDB[div].type] === undefined)
      indDataDB[hasDivDB[div].type] = await proxy(ns, "corporation.getIndustryData", division.type)
    if (indDataDB[hasDivDB[div].type].makesProducts) {
      for (const product of division.products) {
        const prod = await proxy(ns, "corporation.getProduct", div, "Sector-12", product)
        const prog = prod.developmentProgress
        const sellPrice = await getSellPrice(ns, div, "Sector-12", product)
        if (prog === 100) {
          if (sellPrice === 0) update(ns, ns.sprintf("  Calculating - %s", product))
          else update(ns, ns.printf("  $%s - %s", fNumber(ns, await getSellPrice(ns, div, "Sector-12", product), 3), product))
        }
        else {
          update(ns, ns.sprintf("  %s - %s", fNumber(ns, prog, 2), product))
        }
      }
    }
  }
  ns.ui.renderTail()
}

/** @param {NS} ns */
async function getCommands(ns) {
  while (true) {
    let silent = false
    while (ns.peek(19) !== "NULL PORT DATA") {
      let result = ns.readPort(19)
      switch (result) {
        case "Reset TAII":
          if (!silent) ns.tprintf("Corp: Resetting TAII DB!")
          ta2DB = []
          break
        case "popout":
          if (!silent) ns.tprintf("Corp: Enabling pop out")
          win = await makeNewWindow("Corp", ns.ui.getTheme())
          break
        case "nopopout":
          if (!silent) ns.tprintf("Corp: Disabling pop out")
          if (win) win.close()
          win = false
          break
        case "Silent":
          silent = true
          break
        default:
          ns.tprintf("Invalid command received in corp: %s", result)
          break;
      }
    }
    await ns.asleep(200)
  }
}
async function getWorker(ns) {
  if (globalThis["SphyxOSCorpWebWorkers"].length) {
    const worker = globalThis["SphyxOSCorpWebWorkers"].shift()
    if (worker?.workerReady) return worker.workerReady
    return new Promise((resolve) => {
      worker.onmessage = (event) => {
        if (event.data?.type === "reset-complete") {
          //ns.tprintf("corp Worker recycled and ready!")
          resolve(worker)
        }
      }
      worker.postMessage({ type: "reset" })
    })
  }
  const worker = new Worker(URL.createObjectURL(blob))
  //ns.tprintf("corp Worker newly created!")
  return worker
}

const workerCode = `
function optimizeCorpoMaterials_raw(matSizes, divWeights, spaceConstraint, round) {
  let p = divWeights.reduce((a, b) => a + b, 0);
  let w = matSizes.reduce((a, b) => a + b, 0);
  let r = [];
  for (let i = 0; i < matSizes.length; ++i) {
    let m = (spaceConstraint - 500 * ((matSizes[i] / divWeights[i]) * (p - divWeights[i]) - (w - matSizes[i]))) / (p / divWeights[i]) / matSizes[i];
    if (divWeights[i] <= 0 || m < 0) {
      return optimizeCorpoMaterials_raw(matSizes.toSpliced(i, 1), divWeights.toSpliced(i, 1), spaceConstraint, round).toSpliced(i, 0, 0);
    } else {
      if (round) m = Math.round(m);
      r.push(m);
    }
  }
  return r;
}
//event.data[x] should be:  0:matSizes, 1:divWeights, 2:spaceContraint, 3:round, 4:div, 5:city
onmessage = (event) => {
  if (event.data?.type === "reset") {
    postMessage({ type: "reset-complete" })
    return
  }
  postMessage([optimizeCorpoMaterials_raw(event.data[0], event.data[1], event.data[2], event.data[3]), event.data[4], event.data[5]]);
}
`
const blob = new Blob([workerCode], { type: "application/javascript" })
//Ram dodged functions below and their file writes
async function proxy(ns, func, ...argmnts) { return await runIt(ns, "/Temp/corporation-sphyx-nsProxy.js", ns.getFunctionRamCost(func) + 1.6, [func, ...argmnts]) }
async function getBNMults(ns) { return await runIt(ns, "/Temp/corporation-sphyx-bnmults.js", 0, []) }

/** @param {NS} ns */
async function runIt(ns, script, scriptOverride, argmnts) {
  let thispid = 0
  let threads = 1
  const scriptRam = scriptOverride === 0 ? ns.getScriptRam(script) : scriptOverride

  const threadsOnHome = Math.floor((ns.getServerMaxRam("home") - ns.getServerUsedRam("home")) / scriptRam)
  if (threadsOnHome >= 1) {
    thispid = ns.exec(script, "home", { ramOverride: scriptRam, threads: 1, temporary: true }, ...argmnts)
    if (thispid > 0)
      threads--
  }
  if (threads >= 1) {
    const servers = getServersLight(ns)
    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue
      const tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
      const threadsonserver = Math.floor(tmpramavailable / scriptRam)
      // How many threads can we run?  If we can run something, do it
      if (threadsonserver <= 0) continue
      ns.scp([script], server, "home")
      thispid = ns.exec(script, server, { ramOverride: scriptRam, threads: 1, temporary: true }, ...argmnts)
      if (thispid === 0) continue
      threads--
      break
    }// All servers
  }
  if (threads >= 1) ns.tprintf("Failed to allocate all threads for script: %s", script)
  await ns.nextPortWrite(thispid)
  const result = ns.readPort(thispid)
  return result
}

/** @param {NS} ns */
function getServersLight(ns) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }
  return Array.from(serverList)
}
/** @param {NS} ns */
function writeProxy(ns) {
  const data = `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  let [func, ...argmnts] = ns.args
  let nsFunction = ns
  for (let prop of func.split(".")) nsFunction = nsFunction[prop]
  let finalResult
  try {
    const result = nsFunction(...argmnts)
    if (result instanceof Promise) finalResult = await result
    else if (result instanceof Object) {
      promiseRemoval(result)
      finalResult = result
    }
    else finalResult = result
  } catch { } //finalResult is undefined if it failed to run.
  ns.atExit(() => ns.writePort(ns.pid, finalResult))
}
function promiseRemoval(object) {
  for (const key in object)
    if (object[key] instanceof Promise) delete object[key]
    else if (object[key] instanceof Object) promiseRemoval(object[key])
}`
  ns.write("/Temp/corporation-sphyx-nsProxy.js", data, "w")
}

function writeBNMults(ns) {
  const data = `/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
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
      "CloudServerCost": 1,//Old
      "CloudServerCost": 1,//New
      "CloudServerSoftcap": 1,//Old
      "CloudServerSoftcap": 1,//New
      "CloudServerLimit": 1,//Old
      "CloudServerLimit": 1,//New
      "CloudServerMaxRam": 1,//Old
      "CloudServerMaxRam": 1,//New
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
        record.CloudServerCost = 2
        record.CloudServerSoftcap = 1.3
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
  ns.atExit(() => port.write(mults))
}
`
  ns.write("/Temp/corporation-sphyx-bnmults.js", data, "w")
}

function fNumber(ns, num, fraction = 3, suffix = 1000, isInt = false) {
  if (ns.ui.getGameInfo()?.versionNumber >= 44) return ns.format.number(num, fraction, suffix, isInt)
  else return ns.formatNumber(num, fraction, suffix, isInt)
}
const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"]
const industries = [div1, div2, div3, div4, div5, div6, div7, div8]
const cigaretts = ["Pall Mall", "Camel", "Marlboro", "Kool", "American Spirit", "Bastos", "Philip Morris", "USA Gold", "Winston", "Backwoods Smokes", "Capstan", "Chesterfield", "Davidoff", "Maverick", "Newport", "Black Devil", "Dunhill", "Rothman\'s"]
const burgers = ["Double Bacon Cheeseburger", "Plain Hamburger", "Pickle Burger", "Onion Burger", "Turkey Burger", "Mozza Burger", "Chili Cheeseburger", "Tropical Burger", "The BLT", "Spicy Extreem Burger", "Deconstructed Burger", "Junior Delux"]
const hardwares = ["Home Entertainment Threater", "Next-Gen Graphics Card", "Portable Soldering Kit (PSK)", "Advanced Micro-Fluidics Home Kit", "xPhone MAX", "Hyper-RAM", "Superior xDisplay", "A Lamp (It's just a lamp)", "Personal Electric Transportation ULTRA"]

let slp = ms => new Promise(r => setTimeout(r, ms));
async function makeNewWindow(title = "Default Window Title", theme) {
  //  let win = open("", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  let win = open("main.bundle.js", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  let good = false;
  let doc = 0;
  while (!good) {
    await slp(1000);
    try {
      doc = win["document"];
      doc.head.innerHTML = "No.";
      good = true;
    } catch {
      good = false;
    }
  }
  await slp(200);
  doc.head.innerHTML = `
  <title>${title}</title>
  <style>
    *{
      margin:0;
    }
    body{
      background:` + theme['backgroundprimary'] + `;
      color:` + theme['primary'] + `;
      overflow:hidden;
      height:100vh;
      width:100vw;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
      display:flex;
      flex-direction:column;
    }
    td{
      background:` + theme['backgroundsecondary'] + `;
      color:` + theme['primary'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    a{
      color:` + theme['primary'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    warning{
      color:` + theme['error'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    .title{
      font-size:20px;
      text-align:center;
      flex: 0 0;
      display:flex;
      align-items:center;
      border-bottom:1px solid white;
    }
    .scrollQuery{
      font-size:12px;
      margin-left:auto;
    }
    .logs{
      width:100%;
      flex: 1;
      overflow-y:scroll;
      font-size:14px;
      white-space:normal;
    }
    .logs::-webkit-scrollbar,::-webkit-scrollbar-corner{
      background:` + theme['button'] + `;
      width:10px;
      height:10px;
    }
    .logs::-webkit-scrollbar-button{
      width:0px;
      height:0px;
    }
    .logs::-webkit-scrollbar-thumb{
      background:` + theme['primary'] + `;
    }
  </style>`;
  doc.body.innerHTML = `<div class=title>${title}</div><div class=logs><p></p></div>`;
  win.clear = () => {
    win["document"].body.querySelector(".logs").innerHTML = "";
  }
  win.header = (content) => {
    win["document"].body.innerHTML = `<div class=title>${content}</div><div class=logs><p></p></div>`;
  }
  win.update = (content) => {
    win["document"].body.querySelector(".logs").innerHTML = win["document"].body.querySelector(".logs").innterHTML === "" ? content.replaceAll(" ", "&nbsp;").replaceAll("\r", "<br>").replaceAll("\n", "<br>") : win["document"].body.querySelector(".logs").innerHTML + `<br>` + content.replaceAll(" ", "&nbsp;").replaceAll("\r", "<br>").replaceAll("\n", "<br>");
  }
  win.reopen = () => open("", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  win.focus()
  return win;
}