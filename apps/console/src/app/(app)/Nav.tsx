"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AlertTriangle, ArrowLeftRight, BookOpen, Building2, FlaskConical, LayoutDashboard, MessageSquare, Package, Settings, ShoppingCart, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard, "/orders": ShoppingCart, "/products": Package, "/runs": Activity,
  "/exceptions": AlertTriangle, "/conversations": MessageSquare, "/knowledge": BookOpen, "/evals": FlaskConical, "/reconciliation": ArrowLeftRight, "/connections": Building2, "/settings": Settings,
};
type Link_ = { href: string; label: string; n?: number; hot?: boolean };

export default function Nav({ groups }: { groups: { group: string; links: Link_[] }[] }) {
  const path = usePathname();
  const on = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"));
  return (
    <nav className="rail" aria-label="Main">
      {groups.map((g) => (
        <div key={g.group} style={{ display: "contents" }}>
          <div className="grp">{g.group}</div>
          {g.links.map((l) => {
            const Icon = ICONS[l.href] ?? LayoutDashboard;
            return (
              <Link key={l.href} href={l.href} aria-current={on(l.href) ? "page" : undefined}>
                <Icon className="icon" aria-hidden /><span>{l.label}</span>
                {l.n ? <span className={`n${l.hot ? " hot" : ""}`}>{l.n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
