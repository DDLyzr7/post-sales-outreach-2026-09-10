#!/usr/bin/env node
/**
 * Runs the send and tracking jobs locally, the way a scheduler will once the app
 * is hosted: the send job every 30 seconds, the tracking job every 3 minutes.
 * Both go through /api/jobs/<job> with CRON_SECRET, so the dev server must be up.
 *
 *   npm run jobs              (keeps running)
 *   npm run jobs -- --once    (one pass of each, then exits)
 */
const base = (process.env.APP_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local.");
  process.exit(1);
}

async function run(job) {
  try {
    const response = await fetch(`${base}/api/jobs/${job}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await response.json().catch(() => ({}));
    const stamp = new Date().toLocaleTimeString();
    console.log(`${stamp}  ${job.padEnd(5)} ${response.status}  ${JSON.stringify(body.summary ?? body.error ?? body)}`);
    return response.ok;
  } catch (error) {
    console.log(`${new Date().toLocaleTimeString()}  ${job.padEnd(5)} unreachable: ${error.message}`);
    return false;
  }
}

if (process.argv.includes("--once")) {
  const ok = (await run("send")) & (await run("track"));
  process.exit(ok ? 0 : 1);
}

await run("send");
await run("track");
setInterval(() => run("send"), 30_000);
setInterval(() => run("track"), 180_000);
