import { hub, getSession } from "@/lib/hub";
import { ago } from "@/lib/format";
import { Flash } from "@/components/Flash";
import { RolePicker } from "@/components/RolePicker";
import { createMember, setRole } from "../../actions";

type Member = { id: string; email: string; role: string; createdAt: string };
type Audit = { id: string; actor: string; action: string; subject: string; at: string; meta: Record<string, unknown> | null };
const ROLES = ["owner", "ops", "finance", "support"] as const;
const DESC: Record<string, string> = { owner: "Everything, including members and audit log.", ops: "Connections, imports, reconciliation, exceptions.", finance: "Read orders, exceptions and reconciliation.", support: "Overview only." };

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const [me, members, audit] = await Promise.all([getSession(), hub<Member[]>("/members"), hub<Audit[]>("/audit-log")]);
  return (
    <>
      <div className="phead"><div><h1>Settings</h1><p>Who can do what, and a record of what they did.</p></div></div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="stack">
        <div className="panel" style={{ overflow: "hidden" }}>
          <div className="ph"><h2>Members</h2></div>
          <table className="t"><tbody>{members.map((m) => (
            <tr key={m.id}>
              <td><b>{m.email}</b>{m.email === me.email && <span className="muted small"> (you)</span>}<div className="muted small">{DESC[m.role]}</div></td>
              <td style={{ textAlign: "right" }}>
                <div className="linkseg" role="group" aria-label={`Role for ${m.email}`} style={{ background: "var(--hover)" }}>
                  {ROLES.map((r) => (
                    <form className="inline" key={r} action={setRole.bind(null, m.id, r)}>
                      <button className="btn sm ghost" aria-pressed={m.role === r} disabled={m.role === r} style={m.role === r ? { background: "var(--surface)", borderColor: "var(--line)" } : undefined}>{r}</button>
                    </form>
                  ))}
                </div>
              </td>
            </tr>
          ))}</tbody></table>
          <details className="pb" style={{ borderTop: "1px solid var(--line)" }}>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Add a member</summary>
            <form action={createMember} style={{ marginTop: 12, maxWidth: 420 }}>
              <label className="field"><span>Email</span><input className="input" name="email" type="email" required /></label>
              <label className="field"><span>Password (12+ characters)</span><input className="input" name="password" type="password" minLength={12} required autoComplete="new-password" /></label>
              <div className="field"><span>Role</span><RolePicker roles={ROLES.filter((r) => r !== "owner")} initial="support" /></div>
              <button className="btn primary">Create member</button>
            </form>
          </details>
        </div>
        <div className="panel" style={{ overflow: "hidden" }}>
          <div className="ph"><h2>Audit log</h2><span className="muted small">Latest 200 actions</span></div>
          {audit.length === 0 ? <div className="empty">Nothing recorded yet.</div> : (
            <table className="t"><tbody>{audit.map((a) => (
              <tr key={a.id}><td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(a.at)}</td><td>{a.actor}</td><td><span className="mono">{a.action}</span></td><td className="muted">{a.subject.length > 40 ? a.subject.slice(0, 40) + "…" : a.subject}</td></tr>
            ))}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
