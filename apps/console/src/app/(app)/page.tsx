import Link from "next/link";
import { hub } from "@/lib/hub";
import { ago } from "@/lib/format";

type Lane = { kind: string; connected: boolean; name: string | null; env: string | null; status: string; lastCheckedAt: string | null; openExceptions: number };
type Overview = {
  env: string; lanes: Lane[]; openExceptions: number; unmappedSkus: number; tape: ("ok" | "warn" | "bad" | "")[];
  stock: { reportId: string; at: string; checked: number; mismatches: number; missingInChannel: number } | null;
  xero: { reportId: string; at: string; checked: number; missingInvoice: number; unpaid: number; amountMismatch: number; voided: number } | null;
};
type Run = { id: string; kind: string; trigger: string; startedAt: string; status: string };
const LABEL: Record<string, string> = { shopify: "Shopify", xero: "Xero" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const [ov, runs] = await Promise.all([hub<Overview>("/overview"), hub<Run[]>("/runs").catch(() => [] as Run[])]);
  const xeroDiffs = ov.xero ? ov.xero.missingInvoice + ov.xero.unpaid + ov.xero.amountMismatch + ov.xero.voided : 0;
  return (
    <>
      {sp.denied && <div className="banner bad" role="alert">Your role cannot open that page.</div>}
      <div className="phead"><div><h1>Overview</h1><p>Every lane, its last run, and what needs a person.</p></div></div>

      <div className="panel" style={{ padding: "12px 16px", marginBottom: "var(--s4)" }}>
        <div className="tapewrap">
          <div className="tape" role="img" aria-label="Runs in the last 24 hours">{ov.tape.map((t, i) => <i key={i} className={t} />)}</div>
          <div className="tapelabels"><span>24 h ago</span><span>12 h ago</span><span>Now</span></div>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>Each tick is 30 minutes. Green: runs succeeded. Amber: retried and recovered. Red: something failed. Grey: nothing ran.</div>
      </div>

      <div className="grid g3" style={{ marginBottom: "var(--s4)" }}>
        {ov.lanes.map((l) => (
          <div className="tile" key={l.kind}>
            <div className="lane">
              <div style={{ flex: 1 }}>
                <h3>{LABEL[l.kind]}</h3>
                <div className="muted small">{l.connected ? `${l.name} · ${l.env}` : "Not connected"}</div>
              </div>
              <span className={`badge ${!l.connected ? "" : l.status === "ok" ? "ok" : "bad"}`}><i />{!l.connected ? "Not set up" : l.status === "ok" ? "Healthy" : "Failing"}</span>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Last checked</dt><dd>{ago(l.lastCheckedAt)}</dd>
              <dt>Open exceptions</dt><dd><Link href="/exceptions">{l.openExceptions}</Link></dd>
            </dl>
          </div>
        ))}
        <div className="tile">
          <div className="lane"><div style={{ flex: 1 }}><h3>Assistant</h3><div className="muted small">Policies and order lookup</div></div><span className="badge"><i />Not set up</span></div>
          <p className="hint" style={{ marginTop: 12 }}>The assistant arrives in a later milestone.</p>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: "var(--s4)" }}>
        <Tile k="Open exceptions" v={ov.openExceptions} href="/exceptions" hot={ov.openExceptions > 0} />
        <Tile k="Stock differences" v={ov.stock?.mismatches ?? "–"} href="/reconciliation" sub={ov.stock ? `checked ${ago(ov.stock.at)}` : "never checked"} />
        <Tile k="Xero differences" v={ov.xero ? xeroDiffs : "–"} href="/reconciliation" sub={ov.xero ? `checked ${ago(ov.xero.at)}` : "never checked"} />
        <Tile k="Unmapped SKUs" v={ov.unmappedSkus} href="/products" />
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        <div className="ph"><h2>Recent runs</h2><div className="r"><Link className="btn sm" href="/runs">All runs</Link></div></div>
        {runs.length === 0 ? <div className="empty">No runs yet.</div> : (
          <table className="t"><tbody>
            {runs.slice(0, 6).map((r) => (
              <tr key={r.id}><td><span className="mono">{r.kind}</span></td><td className="muted">{r.trigger}</td><td className="muted">{ago(r.startedAt)}</td><td style={{ textAlign: "right" }}><span className={`badge ${r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}><i />{r.status}</span></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}

function Tile({ k, v, href, sub, hot }: { k: string; v: number | string; href: string; sub?: string; hot?: boolean }) {
  return (
    <div className="tile"><Link className="cover" href={href}>
      <div className="k">{k}</div><div className="v fig" style={hot ? { color: "var(--red)" } : undefined}>{v}</div>
      {sub && <div className="hint">{sub}</div>}
    </Link></div>
  );
}
