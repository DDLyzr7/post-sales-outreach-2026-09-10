import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-only secrets handling. Microsoft refresh tokens are encrypted here with
 * MAILBOX_TOKEN_KEY (32 random bytes, base64) before they are stored, so the
 * database never holds a usable token on its own.
 */

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.MAILBOX_TOKEN_KEY;
  if (!raw) throw new Error("MAILBOX_TOKEN_KEY is not set.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("MAILBOX_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return bytes;
}

export function tokenKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(ciphertext: string): string {
  const [version, iv, tag, data] = ciphertext.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised token format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Constant-time string comparison that doesn't leak length. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}
