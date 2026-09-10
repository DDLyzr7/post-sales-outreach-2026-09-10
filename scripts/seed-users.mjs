#!/usr/bin/env node
/**
 * Creates the four Phase 1 demo users in Supabase Auth.
 *
 * Uses the service-role key, which bypasses RLS by design - this is the only
 * place in the project that does. Run once, before applying supabase/seed.sql.
 *
 *   npm run db:seed-users
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_USER_PASSWORD ?? "PostSales!2026";

if (!url || !serviceKey || url.startsWith("https://YOUR-")) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill in your Supabase project values.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  {
    email: "pm@example.com",
    full_name: "Riya Kapoor",
    title: "Project Manager",
    default_role: "pm",
    is_admin: false,
    warm_sender_address: "riya.kapoor@example.com",
  },
  {
    email: "cal@example.com",
    full_name: "Marcus Webb",
    title: "Client Account Lead",
    default_role: "cal",
    is_admin: false,
    warm_sender_address: "marcus.webb@example.com",
  },
  {
    email: "csm@example.com",
    full_name: "Elena Ortiz",
    title: "Customer Success Manager",
    default_role: "csm",
    is_admin: false,
    warm_sender_address: "elena.ortiz@example.com",
  },
  {
    email: "lead@example.com",
    full_name: "Dana Whitfield",
    title: "Post-Sales Lead",
    default_role: null,
    is_admin: true,
    warm_sender_address: "dana.whitfield@example.com",
  },
];

async function findByEmail(email) {
  // The admin API has no get-by-email; page through until found.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

let created = 0;
let updated = 0;

for (const user of USERS) {
  const { email, ...meta } = user;
  const existing = await findByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: meta,
      email_confirm: true,
    });
    if (error) throw error;
    updated += 1;
    console.log(`updated  ${email.padEnd(18)} ${meta.full_name}`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (error) throw error;
    created += 1;
    console.log(`created  ${email.padEnd(18)} ${meta.full_name}`);
  }
}

console.log(`\n${created} created, ${updated} updated. Password: ${password}`);
console.log("Next: apply supabase/seed.sql (npm run db:seed, or paste it into the SQL editor).");
