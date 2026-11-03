import { hub } from "@/lib/hub";
import { ago, money } from "@/lib/format";

type Order = { id: string; source: string; sourceRef: string; currency: string; totalMinor: number; status: string; createdAt: string; customerEmail: string | null; xeroInvoiceId: string | null; lines: number };

export default async function Orders() {
  const orders = await hub<Order[]>("/orders");
  return (
    <>
      <div className="phead"><div><h1>Orders</h1><p>Paid orders from every channel in one ledger.</p></div></div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {orders.length === 0 ? <div className="empty">No orders yet.</div> : (
          <table className="t">
            <thead><tr><th>Order</th><th>Customer</th><th className="n">Lines</th><th className="n">Total</th><th>Status</th><th>Xero</th><th>Placed</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td><b className="mono">{o.sourceRef.length > 16 ? o.sourceRef.slice(0, 16) + "…" : o.sourceRef}</b><div className="muted small">{o.source}</div></td>
                <td className="muted">{o.customerEmail ?? "guest"}</td>
                <td className="n fig">{o.lines}</td>
                <td className="n fig">{money(o.totalMinor, o.currency)}</td>
                <td><span className={`badge ${o.status === "accepted" ? "ok" : o.status === "cannot_fulfil" ? "bad" : ""}`}><i />{o.status === "cannot_fulfil" ? "cannot fulfil" : o.status}</span></td>
                <td>{o.status !== "accepted" ? <span className="muted">n/a</span> : o.xeroInvoiceId ? <span className="badge ok"><i />invoiced</span> : <span className="badge warn"><i />waiting</span>}</td>
                <td className="muted">{ago(o.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
