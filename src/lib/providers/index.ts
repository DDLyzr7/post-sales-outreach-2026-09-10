/**
 * Provider seams.
 *
 * Phase 1 ships the interfaces only - there are no implementations yet, and
 * nothing in the app calls them. They exist now so that Phase 2 (enrichment)
 * and Phase 3 (sending) drop a concrete provider in behind these types without
 * any other file learning which vendor we picked.
 *
 * The two send paths are separate implementations of one interface, never one
 * implementation with a flag: warm goes out of an owner's real mailbox on our
 * real domain, cold goes out of dedicated bought domains.
 */
import type { BusinessFunction, EmailType, SendPath } from "@/lib/types";

export type OutboundMessage = {
  emailActivityId: string;
  accountId: string;
  toEmail: string;
  toName: string | null;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  emailType: EmailType;
  campaignId: string | null;
};

export type SendResult =
  | { ok: true; providerMessageId: string; provider: string; sentAt: string }
  | { ok: false; provider: string; error: string; retryable: boolean };

export interface SendProvider {
  /** Which path this implementation serves. */
  readonly path: SendPath;
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

export type EnrichmentQuery = {
  accountId: string;
  companyName: string;
  companyDomain: string | null;
  /** Which functional leaders to look for, e.g. ["hr", "marketing"]. */
  functions: BusinessFunction[];
};

export type EnrichedContact = {
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
  findCommitteeContacts(query: EnrichmentQuery): Promise<EnrichedContact[]>;
}
