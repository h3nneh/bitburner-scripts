export async function main(ns) {
  const nearbyServers = ns.dnet.probe();
  // Nudge a neighbor to migrate, opens new parts of the net
  if (Math.random() < 0.2 && nearbyServers.length > 0) {
      const target = nearbyServers[Math.floor(Math.random() * nearbyServers.length)];
      try { await ns.dnet.induceServerMigration(target); } catch { /* stationary server */ }
  }
}