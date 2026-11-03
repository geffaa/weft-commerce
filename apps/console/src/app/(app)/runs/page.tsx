import { hub } from "@/lib/hub";
import { ago, when } from "@/lib/format";

type Run = { id: string; kind: string; trigger: string; startedAt: string; finishedAt: string | null; status: string; stats: Record<string, unknown> | null; parentId: string | null };
const dur = (r: Run) => (r.finishedAt ? `${Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 100) / 10)} s` : "running");
const brief = (s: Run["stats"]) => (s ? Object.entries(s).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(" · ") : "");

export default async function Runs() {
  const runs = await hub<Run[]>("/runs");
  return (
    <>
      <div className="phead"><div><h1>Runs</h1><p>Every import, reconciliation and fix, newest first.</p></div></div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {runs.length === 0 ? <div className="empty">No runs yet.</div> : (
          <table className="t">
            <thead><tr><th>Kind</th><th>Started</th><th>By</th><th>Result</th><th className="n">Duration</th><th></th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <td><b className="mono">{r.kind}</b>{r.parentId && <div className="muted small">fix of an earlier run</div>}</td>
                <td className="muted" title={when(r.startedAt)}>{ago(r.startedAt)}</td>
                <td className="muted">{r.trigger}</td>
                <td className="small">{brief(r.stats)}</td>
                <td className="n fig muted">{dur(r)}</td>
                <td style={{ textAlign: "right" }}><span className={`badge ${r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}><i />{r.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
