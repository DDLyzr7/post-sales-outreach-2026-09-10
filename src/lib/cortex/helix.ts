/**
 * Helix, the Cortex subtool that holds clients and projects. Server-only: the key
 * never reaches the browser, and only the sync job (src/lib/jobs/sync.ts) calls this.
 *
 *   GET /api/v3/workspace  clients[] -> projects[] (status, health, project manager)
 *   GET /api/v3/projects   per-project detail, including contacts[] (Lyzr staff and
 *                          client people mixed, told apart only by email domain)
 *
 * Auth is an `x-api-key` header. The same API backs Comms Tracker's adapter.
 */

export type HelixPerson = { name: string; email: string };

export type HelixProject = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  projectPhase?: string | null;
  healthStatus?: string | null;
  healthNote?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  projectManager?: HelixPerson | null;
  updatedAt?: string | null;
};

export type HelixClient = {
  id: string;
  name: string;
  industry?: string | null;
  status?: string | null;
  domain?: string | null;
  segment?: string | null;
  region?: string | null;
  updatedAt?: string | null;
  projects: HelixProject[];
};

export type HelixContact = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isSponsor: boolean;
  isPrimary: boolean;
};

export type HelixProjectDetail = { id: string; contacts?: HelixContact[] };

type Page<T> = { success: boolean; data: T; meta: { page: number; totalPages: number; limit: number } };

const MAX_PAGES = 50;

export function helixConfigured(): boolean {
  return !!process.env.HELIX_API_KEY && !!process.env.HELIX_BASE_URL;
}

async function helixGet<T>(path: string, params: Record<string, string | number>): Promise<Page<T>> {
  const url = new URL(path, process.env.HELIX_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { "x-api-key": process.env.HELIX_API_KEY ?? "", accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Helix ${path} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as Page<T>;
  if (!json.success) throw new Error(`Helix ${path} reported failure.`);
  return json;
}

async function allPages<T>(path: string, limit: number, params: Record<string, string | number>): Promise<T[]> {
  const pages: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await helixGet<T>(path, { ...params, limit, offset: page * limit });
    pages.push(result.data);
    if (result.meta.page >= result.meta.totalPages) break;
  }
  return pages;
}

export async function fetchHelix(): Promise<{ clients: HelixClient[]; contactsByProject: Map<string, HelixContact[]> }> {
  if (!helixConfigured()) throw new Error("HELIX_BASE_URL and HELIX_API_KEY must be set.");

  const [workspacePages, projectPages] = await Promise.all([
    allPages<{ clients: HelixClient[] }>("/api/v3/workspace", 500, { tasks: "false" }),
    allPages<HelixProjectDetail[]>("/api/v3/projects", 200, { fields: "team,sponsors" }),
  ]);

  // A client can span pages; merge its projects by id.
  const clients = new Map<string, HelixClient>();
  for (const client of workspacePages.flatMap((page) => page.clients)) {
    const seen = clients.get(client.id);
    if (!seen) {
      clients.set(client.id, { ...client, projects: [...(client.projects ?? [])] });
      continue;
    }
    const ids = new Set(seen.projects.map((p) => p.id));
    seen.projects.push(...(client.projects ?? []).filter((p) => !ids.has(p.id)));
  }

  const contactsByProject = new Map<string, HelixContact[]>();
  for (const detail of projectPages.flat()) contactsByProject.set(detail.id, detail.contacts ?? []);

  return { clients: [...clients.values()], contactsByProject };
}
