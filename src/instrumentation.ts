// Runs once when the Next.js server starts. Starts the Chief's heartbeat (src/lib/agent/heartbeat.ts) on the
// Node.js runtime only; the dynamic import keeps node:sqlite and Circle out of edge bundles. The scheduler
// guards itself against a second timer after a hot reload and does nothing under vitest.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VITEST) return;
  const { startHeartbeatScheduler } = await import("./lib/agent/heartbeat");
  startHeartbeatScheduler();
}
