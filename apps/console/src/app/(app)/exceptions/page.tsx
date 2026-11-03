import Link from "next/link";
import { can, getSession, hub } from "@/lib/hub";
import { ago } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { ignoreException, retryException } from "../../actions";

type Ex = { id: string; errorClass: string; message: string; state: string; createdAt: string; payload: { topic?: string; attempts?: number; shortages?: unknown } | null };
const SOURCES = [["all", "All"], ["xero", "Xero"], ["shopify", "Shopify"], ["stock", "Stock"]] as const;
const sourceOf = (e: Ex) => (e.payload?.topic === "xero.invoice" ? "xero" : e.payload?.topic === "stock.push" ? "shopify" : e.errorClass === "stock" ? "stock" : "shopify");
const CAUSE: Record<string, string> = { validation: "Rejected by validation", auth: "Credentials or permission", rate_limit: "Rate limited", transient: "Temporary failure", stock: "Cannot fulfil" };
const HELP: Record<string, string> = { validation: "Needs a fix in the other system, then retry.", auth: "Reconnect or fix permissions, then retry.", rate_limit: "Self-healing.", transient: "Usually self-heals; retry if it persists.", stock: "Decision needed: a person decides what to do with the order." };

export default async function Exceptions({ searchParams }: { searchParams: Promise<{ src?: string; state?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const state = sp.state === "all" ? "all" : "open";
  const [me, open, ignored, resolved] = await Promise.all([getSession(), hub<Ex[]>("/exceptions?state=open"), hub<Ex[]>("/exceptions?state=ignored"), hub<Ex[]>("/exceptions?state=resolved")]);
  const list = state === "open" ? open : [...open, ...ignored, ...resolved].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const src = SOURCES.some(([k]) => k === sp.src) ? sp.src! : "all";
  const rows = list.filter((e) => src === "all" || sourceOf(e) === src);
  const count = (k: string) => open.filter((e) => k === "all" || sourceOf(e) === k).length;
  const canAct = can(me.role, "ops");
  const q = (patch: Record<string, string>) => { const p = new URLSearchParams({ ...(sp.src ? { src: sp.src } : {}), ...(sp.state ? { state: sp.state } : {}), ...patch }); return `/exceptions?${p}`; };
  const groups = new Map<string, Ex[]>();
  for (const e of rows.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) groups.set(e.errorClass, [...(groups.get(e.errorClass) ?? []), e]);

  return (
    <>
      <div className="phead"><div><h1>Exceptions</h1><p>Work that failed or needs a person. Everything else is running.</p></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="toolbar" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div className="linkseg" role="group" aria-label="Source">
          {SOURCES.map(([k, l]) => <Link key={k} href={q({ src: k })} aria-current={src === k || undefined}>{l}<span className="c">{count(k)}</span></Link>)}
        </div>
        <div className="linkseg" role="group" aria-label="State">
          <Link href={q({ state: "open" })} aria-current={state === "open" || undefined}>Open only</Link>
          <Link href={q({ state: "all" })} aria-current={state === "all" || undefined}>Include resolved</Link>
        </div>
      </div>
      {rows.length === 0 ? <div className="panel"><div className="empty">Nothing needs attention.</div></div> : (
        <div className="panel" style={{ overflow: "hidden" }}><table className="t"><tbody>
          {[...groups.entries()].map(([cls, items]) => (
            <GroupRows key={cls} cls={cls} items={items} canAct={canAct} />
          ))}
        </tbody></table></div>
      )}
    </>
  );
}

function GroupRows({ cls, items, canAct }: { cls: string; items: Ex[]; canAct: boolean }) {
  return (
    <>
      <tr><td colSpan={5} style={{ background: "var(--surface-2)", padding: "8px 12px", borderBottom: "1px solid var(--line)", fontWeight: 650 }}>
        {CAUSE[cls] ?? cls} <span className="muted" style={{ fontWeight: 500 }}>· {items.length}</span>
        <span className="muted small" style={{ float: "right", fontWeight: 500 }}>{HELP[cls]}</span>
      </td></tr>
      {items.map((e) => {
        const retryable = canAct && e.state === "open" && !!e.payload?.topic;
        return (
          <tr key={e.id}>
            <td style={{ width: 34 }}><span className="ch" title={sourceOf(e)}>{{ xero: "X", shopify: "S", stock: "W" }[sourceOf(e)]}</span></td>
            <td><div>{e.message}</div><div className="muted small">{e.payload?.topic ?? "order"}{e.payload?.attempts ? ` · ${e.payload.attempts} attempt${e.payload.attempts > 1 ? "s" : ""}` : ""}</div></td>
            <td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(e.createdAt)}</td>
            <td><span className={`badge ${e.state === "open" ? "bad" : e.state === "resolved" ? "ok" : ""}`}><i />{e.state}</span></td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {e.state === "open" && canAct && (
                <>
                  {retryable && <form className="inline" action={retryException.bind(null, e.id)}><button className="btn sm">Retry</button></form>}{" "}
                  <form className="inline" action={ignoreException.bind(null, e.id)}><button className="btn sm ghost">Ignore</button></form>
                </>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
