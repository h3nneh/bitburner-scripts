const VERSION = "2026-05-17-dev-console-detected-open.1";

/** @param {NS} ns */
export async function main(ns) {
  const args = ns.args.map(String);
  const statusOnly = args.includes("--status");
  const testLog = args.includes("--test");
  const openDevPage = !args.includes("--no-open");
  const wnd = eval("window");
  if (statusOnly) {
    printStatus(ns, wnd);
    return;
  }
  if (testLog) {
    const status = getStatus(wnd);
    if (status.active) {
      wnd.eval?.(`console.log("[dev-console] test log: active, widthGap=${status.widthGap}, heightGap=${status.heightGap}")`);
    } else {
      ns.tprint(`Dev console test skipped: detectedOpen=${status.detectedOpen}, widthGap=${status.widthGap}, heightGap=${status.heightGap}`);
    }
  }
  printStatus(ns, wnd);
  if (!openDevPage) return;
  globalThis.webpack_require ?? webpackChunkbitburner.push([[-1], {}, w => globalThis.webpack_require = w]);
  Object.keys(webpack_require.m).forEach(k => Object.values(webpack_require(k)).forEach(p => p?.toPage?.('Dev')));
}

function getStatus(wnd) {
  const threshold = getThreshold(wnd);
  const widthGap = Math.abs((wnd.outerWidth || 0) - (wnd.innerWidth || 0));
  const heightGap = Math.abs((wnd.outerHeight || 0) - (wnd.innerHeight || 0));
  const detectedOpen = widthGap > threshold || heightGap > threshold;
  return {
    detectedOpen,
    active: detectedOpen,
    threshold,
    outerWidth: wnd.outerWidth || 0,
    innerWidth: wnd.innerWidth || 0,
    outerHeight: wnd.outerHeight || 0,
    innerHeight: wnd.innerHeight || 0,
    widthGap,
    heightGap,
  };
}

function getThreshold(wnd) {
  const threshold = Number(wnd?.bbDevConsoleGapThreshold);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : 800;
}

function printStatus(ns, wnd) {
  const status = getStatus(wnd);
  ns.tprint(`dev-console.js version ${VERSION}`);
  ns.tprint(`Dev console logs: detectedOpen=${status.detectedOpen}, active=${status.active}`);
  ns.tprint(`DevTools detection: outer=${status.outerWidth}x${status.outerHeight}, inner=${status.innerWidth}x${status.innerHeight}, gap=${status.widthGap}x${status.heightGap}, threshold>${status.threshold}`);
  ns.tprint(`Tune threshold in DevTools with: window.bbDevConsoleGapThreshold = ${Math.max(status.widthGap, status.heightGap) + 1}`);
}
