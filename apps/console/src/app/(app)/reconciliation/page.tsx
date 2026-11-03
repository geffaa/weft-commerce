import { can, getSession, hub } from "@/lib/hub";
import { ago, money } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { fixReconciliation, runReconciliation } from "../../actions";

type StockDiff = { sku: string; productTitle: string; weft: number; channel: number | null; difference: number; pendingPush: boolean; kind: string };
type XeroDiff = { orderId: string; source: string; sourceRef: string; currency: string; orderTotalMinor: number; invoiceStatus: string | null; invoiceTotalMinor: number | null; kind: string; pendingJob: boolean; fixable: boolean };
type Report = { id: string; kind: "stock" | "xero"; generatedAt: string; diffs: (StockDiff | XeroDiff)[]; summary: Record<string, number> };

const XERO_KIND: Record<string, string> = { missing_invoice: "No invoice in Xero", unpaid: "Invoice not fully paid", amount_mismatch: "Amount differs", voided: "Invoice voided or deleted" };

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const [me, reports] = await Promise.all([getSession(), hub<Report[]>("/reconciliation")]);
  const latest = (k: Report["kind"]) => reports.find((r) => r.kind === k);
  const canRun = can(me.role, "ops");
  return (
    <>
      <div className="phead"><div><h1>Reconciliation</h1><p>Weft is the source of truth. This page shows where a channel or Xero disagrees, and fixes it from Weft.</p></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="stack">
        <StockPanel r={latest("stock")} canRun={canRun} />
        <XeroPanel r={latest("xero")} canRun={canRun} />
      </div>
    </>
  );
}

function Head({ title, r, kind, canRun, fixable }: { title: string; r?: Report; kind: "stock" | "xero"; canRun: boolean; fixable: number }) {
  return (
    <div className="ph">
      <h2>{title}</h2><span className="muted small">{r ? `Checked ${ago(r.generatedAt)}` : "Never checked"}</span>
      {canRun && (
        <div className="r">
          <form className="inline" action={runReconciliation.bind(null, kind)}><button className="btn sm">Run now</button></form>
          {r && fixable > 0 && <form className="inline" action={fixReconciliation.bind(null, r.id)}><button className="btn sm primary">{kind === "stock" ? `Set ${fixable} from Weft` : `Fix ${fixable}`}</button></form>}
        </div>
      )}
    </div>
  );
}

function StockPanel({ r, canRun }: { r?: Report; canRun: boolean }) {
  const diffs = (r?.diffs ?? []) as StockDiff[];
  const fixable = diffs.filter((d) => d.kind === "mismatch").length;
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <Head title="Stock: Weft vs Shopify" r={r} kind="stock" canRun={canRun} fixable={fixable} />
      {!r ? <div className="empty">Run a reconciliation to compare stock.</div> : diffs.length === 0 ? <div className="empty">All {r.summary.checked} compared variants match.</div> : (
        <table className="t">
          <thead><tr><th>Variant</th><th className="n">Weft</th><th className="n">Shopify</th><th className="n">Difference</th><th></th></tr></thead>
          <tbody>{diffs.map((d) => (
            <tr key={d.sku}>
              <td><b className="mono">{d.sku}</b><div className="muted small">{d.productTitle}</div></td>
              <td className="n fig">{d.weft}</td><td className="n fig">{d.channel ?? "missing"}</td>
              <td className="n fig">{d.kind === "mismatch" ? <span className="badge warn">{d.difference > 0 ? "+" : ""}{d.difference}</span> : <span className="badge bad">gone</span>}</td>
              <td className="muted small">{d.pendingPush ? "A push is still queued; may fix itself." : d.kind === "missing_in_channel" ? "Variant no longer exists in Shopify." : "Edited outside Weft."}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function XeroPanel({ r, canRun }: { r?: Report; canRun: boolean }) {
  const diffs = (r?.diffs ?? []) as XeroDiff[];
  const fixable = diffs.filter((d) => d.fixable).length;
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <Head title="Orders: Weft vs Xero" r={r} kind="xero" canRun={canRun} fixable={fixable} />
      {!r ? <div className="empty">Run a reconciliation to compare paid orders with invoices.</div> : diffs.length === 0 ? <div className="empty">All {r.summary.checked} paid orders have a matching, paid invoice.</div> : (
        <table className="t">
          <thead><tr><th>Order</th><th>Problem</th><th className="n">Order total</th><th className="n">Invoice total</th><th></th></tr></thead>
          <tbody>{diffs.map((d) => (
            <tr key={d.orderId}>
              <td><b className="mono">{d.sourceRef.length > 18 ? d.sourceRef.slice(0, 18) + "…" : d.sourceRef}</b><div className="muted small">{d.source}</div></td>
              <td><span className={`badge ${d.fixable ? "warn" : "bad"}`}><i />{XERO_KIND[d.kind] ?? d.kind}</span></td>
              <td className="n fig">{money(d.orderTotalMinor, d.currency)}</td>
              <td className="n fig">{d.invoiceTotalMinor === null ? "–" : money(d.invoiceTotalMinor, d.currency)}</td>
              <td className="muted small">{d.pendingJob ? "Invoice job is queued; may fix itself." : d.fixable ? "Can be fixed from Weft." : "Needs a person in Xero."}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
