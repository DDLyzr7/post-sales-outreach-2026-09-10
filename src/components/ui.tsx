import type { ReactNode } from "react";

type Tone = "neutral" | "ok" | "warn" | "bad" | "accent" | "cold";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
  cold: "bg-cold-soft text-cold border-transparent",
};

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
      {children}
    </p>
  );
}

export const HEALTH_TONE: Record<string, Tone> = {
  green: "ok",
  yellow: "warn",
  red: "bad",
  unknown: "neutral",
};

// Lifecycle is not health: an existing customer can be red and a churned one
// can be friendly. Prospects share the violet of the cold path they route to.
export const LIFECYCLE_TONE: Record<string, Tone> = {
  existing: "accent",
  churned: "warn",
  prospect: "cold",
};

export const RELATIONSHIP_TONE: Record<string, Tone> = {
  champion: "ok",
  active: "ok",
  dormant: "warn",
  cold: "neutral",
  detractor: "bad",
  unknown: "neutral",
};
