#!/usr/bin/env node
/**
 * Runs the jobs locally, the way a scheduler will once the app is hosted: the send
 * job every 30 seconds, the tracking job every 3 minutes, the Cortex sync every
 * hour and the Skott feed every 6 hours. All go through /api/jobs/<job> with CRON_SECRET, so the dev server must be up.
 *
 *   npm run jobs                       (keeps running)
 *   npm run jobs -- --once             (one pass of each, then exits)
 *   npm run sync                       (one Cortex sync, then exits)
 *   npm run skott                      (one Skott feed, then exits)
 */
const base = (process.env.APP_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local.");
  process.exit(1);
}

const SCHEDULE = { send: 30_000, track: 180_000, sync: 3_600_000, skott: 21_600_000 };
const onlyIndex = process.argv.indexOf("--only");
const jobs = onlyIndex > -1 ? [process.argv[onlyIndex + 1]] : Object.keys(SCHEDULE);
if (!jobs.every((job) => job in SCHEDULE)) {
  console.error(`Unknown job. Choose from: ${Object.keys(SCHEDULE).join(", ")}.`);
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
  let ok = true;
  for (const job of jobs) ok = (await run(job)) && ok;
  process.exit(ok ? 0 : 1);
}

for (const job of jobs) {
  await run(job);
  setInterval(() => run(job), SCHEDULE[job]);
}
