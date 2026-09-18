import { safeEqual } from "@/lib/crypto";
import { runSendJob } from "@/lib/jobs/send";
import { runSkottJob } from "@/lib/jobs/skott";
import { runSyncJob } from "@/lib/jobs/sync";
import { runTrackJob } from "@/lib/jobs/track";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The only entry point to the send, tracking, Cortex sync and Skott feed jobs. Called by a scheduler
 * (`npm run jobs` locally; Vercel Cron once hosted) with
 * `Authorization: Bearer $CRON_SECRET`. Without a matching secret it refuses, and
 * without CRON_SECRET set at all it refuses everything.
 */

export const dynamic = "force-dynamic";

const JOBS = {
  send: runSendJob,
  track: runTrackJob,
  sync: runSyncJob,
  skott: runSkottJob,
} as const;

async function handle(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(header, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  if (!(job in JOBS)) return Response.json({ error: "unknown job" }, { status: 404 });

  const service = createServiceClient();
  const { data: run } = await service.from("job_run").insert({ job }).select("id").single();

  try {
    const summary = await JOBS[job as keyof typeof JOBS](service);
    if (run) {
      await service.from("job_run").update({ finished_at: new Date().toISOString(), ok: true, summary }).eq("id", run.id);
    }
    return Response.json({ job, ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`job ${job} failed:`, message);
    if (run) {
      await service
        .from("job_run")
        .update({ finished_at: new Date().toISOString(), ok: false, summary: { error: message } })
        .eq("id", run.id);
    }
    return Response.json({ job, ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
