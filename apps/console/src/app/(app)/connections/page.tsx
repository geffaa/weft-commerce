import { can, getSession, hub } from "@/lib/hub";
import { ago } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { connectShopify, connectXero, importShopify, testConnection } from "../../actions";

type Conn = { id: string; kind: string; shop: string; env: string; status: string; secretHint: string; scopes: string[]; locationName: string | null; settings: Record<string, string> | null; lastCheckedAt: string | null };

export default async function Connections({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const [me, conns] = await Promise.all([getSession(), hub<Conn[]>("/connections")]);
  const canEdit = can(me.role, "ops");
  return (
    <>
      <div className="phead"><div><h1>Connections</h1><p>Secrets are encrypted and never shown again. A connection is tested before it is saved.</p></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid g2">
        <Card kind="shopify" title="Shopify" conn={conns.find((c) => c.kind === "shopify")} canEdit={canEdit} />
        <Card kind="xero" title="Xero" conn={conns.find((c) => c.kind === "xero")} canEdit={canEdit} />
      </div>
    </>
  );
}

function Card({ kind, title, conn, canEdit }: { kind: "shopify" | "xero"; title: string; conn?: Conn; canEdit: boolean }) {
  return (
    <div className="panel">
      <div className="ph"><h2>{title}</h2>{conn && <span className={`badge ${conn.status === "ok" ? "ok" : "bad"}`}><i />{conn.status === "ok" ? "Connected" : "Failing"}</span>}{conn && <span className="badge">{conn.env}</span>}</div>
      <div className="pb">
        {conn ? (
          <>
            <dl className="kv">
              <dt>{kind === "shopify" ? "Store" : "Organisation"}</dt><dd>{conn.shop}</dd>
              <dt>Secret</dt><dd className="mono">{conn.secretHint}</dd>
              {kind === "shopify" && <><dt>Location</dt><dd>{conn.locationName}</dd></>}
              {kind === "xero" && conn.settings && <><dt>Accounts</dt><dd>Sales {conn.settings.salesAccountCode} · Bank {conn.settings.bankAccountCode} · {conn.settings.baseCurrency}</dd></>}
              <dt>Scopes</dt><dd className="small">{conn.scopes.join(", ")}</dd>
              <dt>Last checked</dt><dd>{ago(conn.lastCheckedAt)}</dd>
            </dl>
            {canEdit && (
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <form className="inline" action={testConnection.bind(null, conn.id)}><button className="btn sm">Test connection</button></form>
                {kind === "shopify" && <form className="inline" action={importShopify.bind(null, conn.id)}><button className="btn sm primary">Import products and stock</button></form>}
              </div>
            )}
            {canEdit && <details style={{ marginTop: 16 }}><summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Replace credentials</summary><div style={{ marginTop: 12 }}><Form kind={kind} /></div></details>}
          </>
        ) : canEdit ? <Form kind={kind} /> : <div className="empty">Not connected.</div>}
      </div>
    </div>
  );
}

function Form({ kind }: { kind: "shopify" | "xero" }) {
  return (
    <form action={kind === "shopify" ? connectShopify : connectXero}>
      {kind === "shopify" && <label className="field"><span>Store domain</span><input className="input" name="shop" placeholder="your-store.myshopify.com" required /></label>}
      <label className="field"><span>Client ID</span><input className="input" name="clientId" autoComplete="off" required /></label>
      <label className="field"><span>Client secret</span><input className="input" name="clientSecret" type="password" autoComplete="off" required /></label>
      {kind === "shopify" && <label className="field"><span>Location name (optional)</span><input className="input" name="locationName" placeholder="Shop location" /></label>}
      <button className="btn primary">Test and save</button>
    </form>
  );
}
