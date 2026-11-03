import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHmac(raw: Buffer, secret: string, given: string | undefined, encoding: "base64" | "hex"): boolean {
  if (!given) return false;
  const expected = createHmac("sha256", secret).update(raw).digest(encoding);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
