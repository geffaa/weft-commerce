import Link from "next/link";
import { hub } from "@/lib/hub";

type Row = { id: string; weftSku: string | null; productTitle: string; variantTitle: string; state: string; conflictReason: string | null };
const STATES = [["all", "All"], ["mapped", "Mapped"], ["conflict", "Conflicts"], ["missing", "No SKU"]] as const;

export default async function Products({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const sp = await searchParams;
  const rows = await hub<Row[]>("/sku-map");
  const state = STATES.some(([k]) => k === sp.state) ? sp.state! : "all";
  const shown = rows.filter((r) => state === "all" || r.state === state);
  const n = (k: string) => rows.filter((r) => k === "all" || r.state === k).length;
  return (
    <>
      <div className="phead"><div><h1>Products</h1><p>How each Shopify variant maps to a Weft SKU. Only mapped variants take part in stock sync.</p></div></div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="linkseg" role="group" aria-label="Mapping state">
          {STATES.map(([k, l]) => <Link key={k} href={k === "all" ? "/products" : `/products?state=${k}`} aria-current={state === k || undefined}>{l}<span className="c">{n(k)}</span></Link>)}
        </div>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {shown.length === 0 ? <div className="empty">{rows.length ? "No variants in this state." : "Nothing imported yet. Import from Connections."}</div> : (
          <table className="t">
            <thead><tr><th>Product</th><th>SKU</th><th>State</th><th></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td>{r.productTitle}<div className="muted small">{r.variantTitle}</div></td>
                <td>{r.weftSku ? <b className="mono">{r.weftSku}</b> : <span className="muted">none</span>}</td>
                <td><span className={`badge ${r.state === "mapped" ? "ok" : r.state === "conflict" ? "bad" : "warn"}`}><i />{r.state === "missing" ? "no SKU" : r.state}</span></td>
                <td className="muted small">{r.conflictReason && r.state !== "mapped" ? r.conflictReason : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
