import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

const HUB = process.env.MEDUSA_HUB_URL ?? process.env.HUB_URL ?? "http://localhost:3100";
const REGION: Record<string, string> = { gb: "UK", us: "US", de: "EU", au: "AU" };

/**
 * Proxy ke hub: URL hub tidak terbuka ke browser, dan IP pengunjung diteruskan lewat X-Forwarded-For
 * (hub dijalankan dengan HUB_TRUST_PROXY=true dan hanya terjangkau lewat proxy ini).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: string; conversationId?: string } | null;
  if (!body || typeof body.message !== "string") return NextResponse.json({ message: "message is required" }, { status: 400 });
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const country = (await cookies()).get("country")?.value ?? "gb";
  try {
    const res = await fetch(`${HUB}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ message: body.message, conversationId: body.conversationId, region: REGION[country] ?? "UK" }),
      cache: "no-store",
    });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch {
    return NextResponse.json({ message: "The assistant is not reachable right now. Please try again later or email support@haldenmoto.example." }, { status: 503 });
  }
}
