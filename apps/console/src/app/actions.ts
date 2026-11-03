"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { HubError, TOKEN_COOKIE, hub, hubLogin } from "@/lib/hub";

const back = (path: string, kind: "error" | "ok", msg: string) => redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Jalankan aksi hub; pesan galat hub (mis. scope kurang) ditampilkan apa adanya. */
async function act(path: string, okMsg: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) {
    if (e instanceof HubError) return back(path, "error", e.message);
    throw e;
  }
  revalidatePath("/", "layout");
  back(path, "ok", okMsg);
}

export async function login(_: unknown, f: FormData) {
  try {
    const r = await hubLogin(text(f, "email"), String(f.get("password") ?? ""));
    (await cookies()).set(TOKEN_COOKIE, r.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: r.expiresIn, secure: process.env.NODE_ENV === "production" });
  } catch (e) {
    return { error: e instanceof HubError && e.status === 401 ? "Invalid email or password." : "Could not sign in. Is the hub running?" };
  }
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect("/login");
}

export const retryException = async (id: string) => act("/exceptions", "Re-queued. The job will run again.", () => hub(`/exceptions/${id}/retry`, { method: "POST" }));
export const ignoreException = async (id: string) => act("/exceptions", "Ignored.", () => hub(`/exceptions/${id}/ignore`, { method: "POST" }));

export const runReconciliation = async (kind: "stock" | "xero") => act("/reconciliation", `${kind === "xero" ? "Xero" : "Stock"} reconciliation finished.`, () => hub("/reconciliation/run", { method: "POST", body: { kind } }));
export const fixReconciliation = async (id: string) => act("/reconciliation", "Fix started. A new run was queued.", () => hub(`/reconciliation/${id}/fix`, { method: "POST", body: {} }));

export const testConnection = async (id: string) => act("/connections", "Connection tested.", () => hub(`/connections/${id}/test`, { method: "POST" }));
export const importShopify = async (id: string) => act("/connections", "Import finished. See Products.", () => hub(`/connections/${id}/import`, { method: "POST" }));

export async function connectShopify(f: FormData) {
  return act("/connections", "Shopify connected.", () => hub("/connections", { method: "POST", body: { shop: text(f, "shop"), clientId: text(f, "clientId"), clientSecret: text(f, "clientSecret"), ...(text(f, "locationName") ? { locationName: text(f, "locationName") } : {}) } }));
}
export async function connectXero(f: FormData) {
  return act("/connections", "Xero connected.", () => hub("/connections/xero", { method: "POST", body: { clientId: text(f, "clientId"), clientSecret: text(f, "clientSecret") } }));
}

export const setRole = async (id: string, role: string) => act("/settings", "Role updated.", () => hub(`/members/${id}`, { method: "PATCH", body: { role } }));
export async function createMember(f: FormData) {
  return act("/settings", "Member created.", () => hub("/members", { method: "POST", body: { email: text(f, "email"), password: String(f.get("password") ?? ""), role: text(f, "role") } }));
}

export const takeoverConversation = async (id: string) => act(`/conversations/${id}`, "You took over. The assistant will stop replying.", () => hub(`/assistant/conversations/${id}/takeover`, { method: "POST" }));
export async function flagMessage(conversationId: string, messageId: string, f: FormData) {
  return act(`/conversations/${conversationId}`, "Marked wrong. It is now an evaluation case.", () => hub(`/assistant/messages/${messageId}/flag`, { method: "POST", body: { category: text(f, "category"), facts: text(f, "facts").split(",").map((x) => x.trim()).filter(Boolean) } }));
}
export const reindexKnowledge = async () => act("/knowledge", "Knowledge reindexed.", () => hub("/knowledge/reindex", { method: "POST" }));
export const runEvals = async () => act("/evals", "Evaluation started. Results appear as it runs.", () => hub("/evals/run", { method: "POST" }));
