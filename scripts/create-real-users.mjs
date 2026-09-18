#!/usr/bin/env node
/**
 * Creates sign-ins for the real account owners and the post-sales lead, each with
 * their own random password (decided 2026-09-18, until Microsoft sign-in is set up).
 *
 * - Owners are everyone waiting in account_pending_owner (written by the Cortex
 *   sync). Creating the user fires app.claim_pending_owners, which turns their
 *   waiting rows into account_assignment, so they see their accounts at once.
 * - The lead gets is_admin through app_metadata, which only the service role writes.
 * - Existing users are left alone (no password reset) unless --reset is passed.
 * - Passwords go to a CSV outside the repo, readable only by you. They're never
 *   printed. Password sign-in only works on localhost (src/lib/auth.ts).
 *
 *   npm run db:real-users -- --lead deepankar.dimri@lyzr.com [--out ~/Desktop/x.csv] [--reset]
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const lead = arg("--lead")?.toLowerCase() ?? null;
const out = (arg("--out") ?? `${homedir()}/Desktop/Post-Sales-Logins.csv`).replace(/^~/, homedir());
const reset = process.argv.includes("--reset");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function password() {
  // 18 characters from an unambiguous set, plus a symbol and a digit.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  return [...bytes].map((b) => chars[b % chars.length]).join("") + "!7";
}

function nameFromEmail(email) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

// Everyone waiting for their first sign-in, with the best name the sync saw.
const { data: pending, error: pendingError } = await admin.from("account_pending_owner").select("email, full_name");
if (pendingError) throw new Error(pendingError.message);
const people = new Map();
for (const row of pending ?? []) {
  const current = people.get(row.email);
  if (!current || (!current.full_name && row.full_name)) people.set(row.email, { email: row.email, full_name: row.full_name });
}
if (lead && !people.has(lead)) people.set(lead, { email: lead, full_name: null });

const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw new Error(listError.message);
const existing = new Map(list.users.map((u) => [u.email?.toLowerCase(), u]));

// Keep earlier passwords in the file when a user is skipped.
const saved = new Map();
if (existsSync(out)) {
  for (const line of readFileSync(out, "utf8").split("\n").slice(1)) {
    const [email, , pwd] = line.split(",");
    if (email && pwd) saved.set(email, pwd);
  }
}

const rows = [];
let created = 0;
let skipped = 0;
for (const person of [...people.values()].sort((a, b) => a.email.localeCompare(b.email))) {
  const fullName = person.full_name || (person.email === lead ? "Deepankar Dimri" : nameFromEmail(person.email));
  const isLead = person.email === lead;
  const user = existing.get(person.email);

  if (user && !reset) {
    skipped += 1;
    rows.push([person.email, fullName, saved.get(person.email) ?? "(unchanged, not in this file)", isLead ? "lead" : "owner"]);
    continue;
  }

  const pwd = password();
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: pwd });
    if (error) throw new Error(`${person.email}: ${error.message}`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email: person.email,
      password: pwd,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { is_admin: isLead },
    });
    if (error) throw new Error(`${person.email}: ${error.message}`);
    created += 1;
  }
  rows.push([person.email, fullName, pwd, isLead ? "lead" : "owner"]);
}

// A lead who existed before this run still gets promoted.
if (lead) {
  const { error } = await admin.from("app_user").update({ is_admin: true }).eq("email", lead);
  if (error) throw new Error(`promote ${lead}: ${error.message}`);
}

writeFileSync(out, ["email,name,password,role", ...rows.map((r) => r.join(","))].join("\n") + "\n", { mode: 0o600 });
chmodSync(out, 0o600);

const { count: waiting } = await admin.from("account_pending_owner").select("email", { count: "exact", head: true });
const { count: assigned } = await admin
  .from("account_assignment")
  .select("account_id", { count: "exact", head: true })
  .is("deleted_at", null)
  .not("source_system", "is", null);

console.log(`Created ${created}, left ${skipped} existing${reset ? " (passwords reset)" : ""}. Lead: ${lead ?? "none"}.`);
console.log(`Synced owner roles now assigned: ${assigned}; still waiting: ${waiting}.`);
console.log(`Logins written to ${out} (readable only by you).`);
