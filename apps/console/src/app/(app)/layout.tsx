import Link from "next/link";
import { Boxes, LogOut } from "lucide-react";
import { can, getSession, hub } from "@/lib/hub";
import { logout } from "../actions";
import Nav from "./Nav";

type Overview = { env: "sandbox" | "live"; openExceptions: number; unmappedSkus: number; stock: { mismatches: number } | null; xero: { missingInvoice: number; unpaid: number; amountMismatch: number; voided: number } | null };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, ov] = await Promise.all([getSession(), hub<Overview>("/overview")]);
  const recon = (ov.stock?.mismatches ?? 0) + (ov.xero ? ov.xero.missingInvoice + ov.xero.unpaid + ov.xero.amountMismatch + ov.xero.voided : 0);
  const ops = can(me.role, "ops", "finance");
  const items = [
    { group: "Overview", links: [{ href: "/", label: "Overview" }] },
    ...(ops ? [
      { group: "Commerce", links: [{ href: "/orders", label: "Orders" }, { href: "/products", label: "Products", n: ov.unmappedSkus || undefined }] },
      { group: "Operations", links: [{ href: "/runs", label: "Runs" }, { href: "/exceptions", label: "Exceptions", n: ov.openExceptions || undefined, hot: true }, { href: "/reconciliation", label: "Reconciliation", n: recon || undefined }] },
    ] : []),
    ...(can(me.role, "support", "ops") ? [{ group: "Assistant", links: [{ href: "/conversations", label: "Conversations" }, ...(me.role === "owner" ? [{ href: "/knowledge", label: "Knowledge" }, { href: "/evals", label: "Evals" }] : [])] }] : []),
    ...(can(me.role, "ops") ? [{ group: "Channels", links: [{ href: "/connections", label: "Connections" }] }] : []),
    ...(me.role === "owner" ? [{ group: "Admin", links: [{ href: "/settings", label: "Settings" }] }] : []),
  ];
  const initials = me.email.slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <header className="top">
        <Link className="brand" href="/"><Boxes className="icon l" aria-hidden />Weft</Link>
        {/* Lingkungan ditentukan oleh koneksi, bukan sakelar: selalu terlihat, tidak bisa tertukar tanpa sengaja. */}
        <div className="env" role="group" aria-label={`Environment: ${ov.env}`}>
          <button aria-pressed={ov.env === "sandbox"} aria-disabled="true" tabIndex={-1}>Sandbox</button>
          <button className="live" aria-pressed={ov.env === "live"} aria-disabled="true" tabIndex={-1}>Live</button>
        </div>
        <span className="muted who" style={{ marginLeft: "auto", color: "#B9C6C3", fontSize: 13 }}>{me.email} · {me.role}</span>
        <span className="me" aria-hidden>{initials}</span>
        <form action={logout}><button className="btn sm ghost" style={{ color: "#EAF0EE" }} aria-label="Sign out"><LogOut className="icon s" aria-hidden /><span className="signout-label">Sign out</span></button></form>
      </header>
      <Nav groups={items} />
      <main className="main"><div className="page">{children}</div></main>
    </div>
  );
}
