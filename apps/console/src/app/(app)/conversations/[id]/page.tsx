import Link from "next/link";
import { Bot } from "lucide-react";
import { Flash } from "@/components/Flash";
import { CategoryPicker } from "@/components/CategoryPicker";
import { hub } from "@/lib/hub";
import { ago } from "@/lib/format";
import { flagMessage, takeoverConversation } from "../../../actions";

type Msg = { id: string; role: string; text: string; outcome: string | null; toolCalls: { tool: string; args: Record<string, string>; result: unknown }[] | null; sources: { title: string; kind: string }[] | null; flagged: boolean; createdAt: string };
type Conv = { id: string; handoffState: string; handoffSummary: string | null; region: string | null; messages: Msg[] };
const CATS = ["answerable", "needs_tool", "must_refuse", "must_handoff"];

export default async function Transcript({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const c = await hub<Conv>(`/assistant/conversations/${id}`);
  return (
    <>
      <div className="phead"><div><h1>Conversation</h1><p><Link href="/conversations">All conversations</Link> · region {c.region ?? "UK"}</p></div>
        <div className="acts">{c.handoffState !== "taken" && <form action={takeoverConversation.bind(null, c.id)}><button className="btn primary">Take over</button></form>}</div></div>
      <Flash error={sp.error} ok={sp.ok} />
      {c.handoffSummary && <div className="banner ok" role="status"><b>Handed over.</b> {c.handoffSummary}</div>}
      <div className="stack" style={{ maxWidth: 760 }}>
        {c.messages.map((m) => (
          <div key={m.id} style={{ justifySelf: m.role === "visitor" ? "start" : "end", maxWidth: "88%" }}>
            <div className="muted small" style={{ textAlign: m.role === "visitor" ? "left" : "right" }}>
              {m.role === "visitor" ? "Visitor" : <><Bot className="icon s" aria-hidden style={{ verticalAlign: "-2px" }} /> Assistant{m.outcome ? ` · ${m.outcome}` : ""}</>} · {ago(m.createdAt)}
            </div>
            <div style={{ background: m.role === "visitor" ? "var(--hover)" : "var(--pine-soft)", padding: "10px 12px", borderRadius: 10 }}>
              {m.text}
              {m.sources && m.sources.length > 0 && <div className="small" style={{ marginTop: 8, color: "var(--pine-strong)" }}>Sources: {m.sources.map((s) => s.title).join(" · ")}</div>}
            </div>
            {m.toolCalls?.map((t, i) => (
              <div key={i} className="mono muted" style={{ marginTop: 6, borderLeft: "2px solid var(--line-strong)", paddingLeft: 8, fontSize: 12 }}>
                {t.tool}({Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join(", ")}) → {JSON.stringify(t.result).slice(0, 160)}
              </div>
            ))}
            {m.role === "assistant" && m.outcome !== "disclosure" && (
              m.flagged ? <div className="small" style={{ marginTop: 6 }}><span className="badge bad"><i />Flagged wrong</span></div> : (
                <details style={{ marginTop: 6 }}>
                  <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Mark wrong</summary>
                  <form action={flagMessage.bind(null, c.id, m.id)} style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    <div className="small muted">The visitor's question becomes an evaluation case, so this mistake is tested from now on.</div>
                    <CategoryPicker options={CATS} initial="answerable" />
                    <label className="field" style={{ marginBottom: 0 }}><span>Facts a correct answer must contain (comma separated, optional)</span><input className="input" name="facts" placeholder="30 days, original packaging" /></label>
                    <div><button className="btn sm">Add as evaluation case</button></div>
                  </form>
                </details>
              )
            )}
          </div>
        ))}
      </div>
    </>
  );
}
