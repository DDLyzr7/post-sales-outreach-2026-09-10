#!/usr/bin/env node
/**
 * Applies a .sql file to the hosted Supabase project using psql.
 * Falls back to instructions if psql or SUPABASE_DB_URL is unavailable.
 *
 *   npm run db:seed
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error(`Usage: node --env-file=.env.local scripts/apply-sql.mjs <file.sql>`);
  process.exit(1);
}

const dbUrl = process.env.SUPABASE_DB_URL;
const hasPsql = spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;

if (!dbUrl || !hasPsql) {
  console.log(
    [
      `Cannot run ${file} automatically:`,
      dbUrl ? "" : "  - SUPABASE_DB_URL is not set in .env.local",
      hasPsql ? "" : "  - psql is not installed",
      "",
      `Open your Supabase project -> SQL Editor, paste the contents of ${file}, and run it.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  process.exit(0);
}

const result = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
