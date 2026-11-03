import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Flash } from "@/components/Flash";
import { hub } from "@/lib/hub";
import { ago } from "@/lib/format";
import { runEvals } from "../../actions";

type Cat = { passed: number; total: number; rate: number };
type Scores = { total: Cat; byCategory: Record<string, Cat>; numbersWithoutTool: number; meetsTarget: boolean; tokens?: { prompt: number; completion: number } };
type Run = { id: string; startedAt: string; finishedAt: string | null; status: string; model: string; scores: Scores | null };
type Result = { id: string; key: string; question: string; category: string; passed: boolean; answer: string; outcome: string; reasons: string[]; expect: Record<string, unknown>; numbersWithoutTool: number };
type Detail = Run & { results: Result[] };
const pct = (r: number) => `${Math.round(r * 100)}%`;

export default async function Evals({ searchParams }: { searchParams: Promise<{ run?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const runs = await hub<Run[]>("/evals/runs");
  const current = sp.run ?? runs[0]?.id;
  const d = current ? await hub<Detail>(`/evals/runs/${current}`) : null;
  const running = d?.status === "running";
  const failed = d?.results.filter((r) => !r.passed) ?? [];
  const s = d?.scores;
  return (
    <>
      <AutoRefresh active={!!running} />
      <div className="phead"><div><h1>Evals</h1><p>60 labelled questions run against the assistant. The figure that matters most: answers with a price or stock level that no tool backed. It must be zero.</p></div>
        <div className="acts"><form action={runEvals}><button className="btn primary" disabled={!!running}>{running ? "Running…" : "Run evaluation"}</button></form></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      {!d ? <div className="panel"><div className="empty">No evaluation has run yet.</div></div> : (
        <>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <div className="tile"><div className="k">Passed</div><div className="v fig">{s ? `${s.total.passed} / ${s.total.total}` : `${d.results.length} / …`}</div><div className="hint">{s ? pct(s.total.rate) : "running"} · target 85%</div></div>
            <div className="tile"><div className="k">Figures without a tool</div><div className="v fig" style={s && s.numbersWithoutTool > 0 ? { color: "var(--red)" } : undefined}>{s ? s.numbersWithoutTool : "…"}</div><div className="hint">must be 0</div></div>
            <div className="tile"><div className="k">Result</div><div className="v">{!s ? "…" : s.meetsTarget ? <span className="badge ok"><i />Meets target</span> : <span className="badge bad"><i />Below target</span>}</div><div className="hint">model {d.model}</div></div>
            <div className="tile"><div className="k">Run</div><div className="v" style={{ fontSize: 16 }}>{ago(d.startedAt)}</div><div className="hint">{d.status}</div></div>
          </div>
          {s && (
            <div className="panel" style={{ marginBottom: 16, overflow: "hidden" }}><div className="ph"><h2>By category</h2></div>
              <table className="t"><tbody>{Object.entries(s.byCategory).map(([k, c]) => (
                <tr key={k}><td><b className="mono">{k}</b></td><td style={{ width: "50%" }}><div style={{ height: 8, background: "var(--hover)", borderRadius: 4 }}><div style={{ width: pct(c.rate), height: 8, background: c.rate >= 0.85 ? "var(--pine)" : "var(--red)", borderRadius: 4 }} /></div></td><td className="n fig">{c.passed} / {c.total}</td><td className="n fig">{pct(c.rate)}</td></tr>
              ))}</tbody></table></div>
          )}
          <div className="panel" style={{ marginBottom: 16, overflow: "hidden" }}><div className="ph"><h2>Failed cases</h2><span className="muted small">{failed.length}</span></div>
            {failed.length === 0 ? <div className="empty">{running ? "Running…" : "Every case passed."}</div> : (
              <table className="t"><tbody>{failed.map((r) => (
                <tr key={r.id}><td style={{ width: "34%" }}><b>{r.question}</b><div className="muted small"><span className="mono">{r.key}</span> · {r.category}</div></td>
                  <td><div className="small">{r.answer}</div><div className="small" style={{ color: "var(--red)", marginTop: 4 }}>{r.reasons.join("; ")}</div></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </>
      )}
      {runs.length > 1 && (
        <div className="panel" style={{ overflow: "hidden" }}><div className="ph"><h2>Earlier runs</h2></div>
          <table className="t"><tbody>{runs.map((r) => (
            <tr key={r.id}><td><Link href={`/evals?run=${r.id}`}>{ago(r.startedAt)}</Link></td><td className="muted">{r.model}</td><td className="n fig">{r.scores ? `${r.scores.total.passed} / ${r.scores.total.total}` : r.status}</td><td className="n fig">{r.scores ? `${r.scores.numbersWithoutTool} unbacked` : ""}</td></tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
