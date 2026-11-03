import { Flash } from "@/components/Flash";
import { hub } from "@/lib/hub";
import { ago } from "@/lib/format";
import { reindexKnowledge } from "../../actions";

type Doc = { id: string; title: string; kind: string; sourceKey: string; updatedAt: string; chunks: number };

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const docs = await hub<Doc[]>("/knowledge/docs");
  const policies = docs.filter((d) => d.kind === "policy"); const catalog = docs.filter((d) => d.kind === "catalog");
  return (
    <>
      <div className="phead"><div><h1>Knowledge</h1><p>What the assistant is allowed to answer from. Catalog entries carry fitment but never a price or stock level.</p></div>
        <div className="acts"><form action={reindexKnowledge}><button className="btn primary">Reindex now</button></form></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="tile"><div className="k">Policy documents</div><div className="v fig">{policies.length}</div></div>
        <div className="tile"><div className="k">Catalog parts</div><div className="v fig">{catalog.length}</div></div>
        <div className="tile"><div className="k">Chunks</div><div className="v fig">{docs.reduce((n, d) => n + d.chunks, 0)}</div></div>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {docs.length === 0 ? <div className="empty">Nothing indexed yet. Press Reindex now.</div> : (
          <table className="t"><thead><tr><th>Document</th><th>Kind</th><th className="n">Chunks</th><th>Updated</th></tr></thead>
            <tbody>{docs.map((d) => <tr key={d.id}><td>{d.title}<div className="muted small mono">{d.sourceKey}</div></td><td><span className="badge">{d.kind}</span></td><td className="n fig">{d.chunks}</td><td className="muted">{ago(d.updatedAt)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
