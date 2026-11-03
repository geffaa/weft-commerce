"use client";
import { useState } from "react";

/** Pilihan peran sebagai radiogroup ARIA kustom (panah kiri/kanan berpindah); nilai dikirim lewat input tersembunyi. */
export function RolePicker({ roles, initial }: { roles: string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  const move = (d: number) => setValue(roles[(roles.indexOf(value) + d + roles.length) % roles.length]);
  return (
    <div className="linkseg" role="radiogroup" aria-label="Role"
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); } if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); } }}>
      <input type="hidden" name="role" value={value} />
      {roles.map((r) => (
        <button type="button" key={r} role="radio" aria-checked={value === r} tabIndex={value === r ? 0 : -1} onClick={() => setValue(r)}
          className="role-choice" style={value === r ? { background: "var(--surface)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(16,24,27,.14)", border: 0 } : { background: "none", border: 0 }}>{r}</button>
      ))}
    </div>
  );
}
