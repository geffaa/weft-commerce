import Link from "next/link";
import { hub } from "@/lib/hub";
import { ago } from "@/lib/format";

type Conv = { id: string; lastMessageAt: string; handoffState: string; handoffSummary: string | null; first: string | null; messages: number; flagged: number };

export default async function Conversations() {
  const list = await hub<Conv[]>("/assistant/conversations");
  return (
    <>
      <div className="phead"><div><h1>Conversations</h1><p>What visitors asked the assistant, how it answered, and which ones need a person.</p></div></div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {list.length === 0 ? <div className="empty">No conversations yet.</div> : (
          <table className="t"><thead><tr><th>Visitor asked</th><th>Status</th><th className="n">Messages</th><th>Last message</th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/conversations/${c.id}`}>{c.first ?? "(no question)"}</Link>{c.handoffSummary && <div className="muted small">{c.handoffSummary}</div>}</td>
                <td>
                  {c.handoffState === "taken" ? <span className="badge ok"><i />Taken over</span> : c.handoffState === "requested" ? <span className="badge warn"><i />Handed over</span> : <span className="badge ok"><i />Answered by AI</span>}
                  {c.flagged > 0 && <> <span className="badge bad"><i />Flagged wrong</span></>}
                </td>
                <td className="n fig">{c.messages}</td><td className="muted">{ago(c.lastMessageAt)}</td>
              </tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
