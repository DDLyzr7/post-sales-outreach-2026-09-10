/** Fail loudly at startup rather than with a confusing Supabase error later. */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("YOUR-")) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill in your Supabase project values.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
};
