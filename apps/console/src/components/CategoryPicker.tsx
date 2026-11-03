"use client";
import { useState } from "react";

/** Pilihan kategori kasus evaluasi sebagai radiogroup ARIA kustom; nilai dikirim lewat input tersembunyi. */
export function CategoryPicker({ options, initial }: { options: string[]; initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <div className="linkseg" role="radiogroup" aria-label="Category">
      <input type="hidden" name="category" value={v} />
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={v === o} onClick={() => setV(o)} className="role-choice"
          style={v === o ? { background: "var(--surface)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(16,24,27,.14)", border: 0 } : { background: "none", border: 0 }}>{o}</button>
      ))}
    </div>
  );
}
