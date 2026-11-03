const BASE = process.env.MEDUSA_URL ?? "http://localhost:9000";
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";

export class MedusaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function medusa<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? "GET",
    headers: { "x-publishable-api-key": KEY, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new MedusaError(res.status, json.message ?? res.statusText);
  return json as T;
}
