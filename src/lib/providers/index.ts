/**
 * Provider seams.
 *
 * Sending: every path resolves to a provider through
 * app_policy.send_path_routing.providers. Since 2026-09-13 both warm and cold map
 * to "microsoft_graph", the author's own Microsoft 365 mailbox. Keeping the seam
 * means cold can move to a dedicated service later by adding an implementation
 * and editing the policy row, without the send job learning which vendor it is.
 * "dry_run" records a send without contacting anyone.
 *
 * Enrichment: a free search first, then a paid reveal only for the people the
 * owner picks. Apollo is the implementation (src/lib/providers/apollo.ts).
 */
import type { BusinessFunction } from "@/lib/types";

export type OutboundMessage = {
  emailActivityId: string;
  senderId: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  bodyText: string;
};

export type SendResult =
  | { ok: true; provider: string; providerMessageId: string; providerThreadId: string | null; sentAt: string }
  | { ok: false; provider: string; error: string; retryable: boolean; needsReconnect?: boolean };

export interface SendProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

export type EnrichmentQuery = {
  accountId: string;
  companyName: string;
  companyDomain: string;
  /** Which functional leaders to look for, e.g. ["hr", "marketing"]. */
  functions: BusinessFunction[];
  titlesByFunction: Partial<Record<BusinessFunction, string[]>>;
  seniorities: string[];
};

/** A search hit. No email yet: revealing one costs credits. */
export type EnrichmentCandidate = {
  externalId: string;
  displayName: string;
  title: string | null;
  businessFunction: BusinessFunction;
  hasEmail: boolean;
};

export type EnrichedContact = {
  externalId: string;
  fullName: string;
  title: string | null;
  businessFunction: BusinessFunction;
  email: string | null;
  linkedinUrl: string | null;
  /** 0-1. Stored on contact.enrichment_confidence. */
  confidence: number | null;
};

export interface EnrichmentProvider {
  readonly name: string;
  search(query: EnrichmentQuery): Promise<EnrichmentCandidate[]>;
  reveal(externalId: string): Promise<EnrichedContact | null>;
}
