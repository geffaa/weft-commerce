import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BASE = process.env.HUB_URL ?? "http://localhost:3100";
export const TOKEN_COOKIE = "hub_token";

export class HubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Panggil hub dengan token sesi. 401 berarti sesi habis atau dicabut: kembali ke login. */
export async function hub<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const res = await fetch(BASE + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  // 401: tanpa token = belum login; dengan token = sesi habis atau dicabut. Keduanya kembali ke login.
  if (res.status === 401) redirect(token ? "/login?expired=1" : "/login");
  // 403: peran tidak boleh membuka halaman ini. Kembali ke Overview dengan pesan, bukan halaman galat.
  if (res.status === 403) redirect("/?denied=1");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HubError(res.status, typeof json.message === "string" ? json.message : Array.isArray(json.message) ? json.message.join("; ") : res.statusText);
  return json as T;
}

export async function hubLogin(email: string, password: string) {
  const res = await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }), cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HubError(res.status, json.message ?? "Login failed");
  return json as { token: string; expiresIn: number; member: { id: string; email: string; role: Role } };
}

export type Role = "owner" | "ops" | "finance" | "support";
export type Session = { sub: string; email: string; role: Role };
export const getSession = () => hub<Session>("/auth/me");
/** UI hanya menyembunyikan tombol; penegakan sebenarnya ada di hub. Owner boleh semua. */
export const can = (role: Role, ...allowed: Role[]) => role === "owner" || allowed.includes(role);
