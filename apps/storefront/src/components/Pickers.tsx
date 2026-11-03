"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bike, ChevronDown, Globe, X } from "lucide-react";
import { clearGarage, setCountry, setGarage } from "@/app/actions";
import type { BikeModel } from "@/lib/types";

function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, close]);
}

export function GaragePicker({ models, label }: { models: BikeModel[]; label: string | null }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => { setOpen(false); setPick(null); };
  useDismiss(open, close);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

  const groups = new Map<string, BikeModel[]>();
  for (const m of models) groups.set(`${m.make} ${m.model}`, [...(groups.get(`${m.make} ${m.model}`) ?? []), m]);
  const gens = pick ? groups.get(pick)! : [];
  const years = gens.flatMap((g) => Array.from({ length: g.year_to - g.year_from + 1 }, (_, i) => ({ y: g.year_from + i, g })))
    .sort((a, b) => b.y - a.y);

  return (
    <>
      <button className="garage" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Bike className="icon l" aria-hidden />
        <span><small>My garage</small><b>{label ?? "Add your bike"}</b></span>
        <ChevronDown className="icon s" aria-hidden />
      </button>
      {open && (
        <div className="scrim" onClick={close}>
          <div className="dlg" role="dialog" aria-modal="true" aria-label="My garage" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
            <div className="dlg-h">
              <b>{pick ? `${pick}: which year?` : "Which bike do you ride?"}</b>
              <button className="btn" aria-label="Close" onClick={close}><X className="icon s" /></button>
            </div>
            <div className="dlg-b" role="listbox" aria-label={pick ? "Year" : "Bike"}>
              {!pick && [...groups.keys()].map((k) => (
                <button key={k} role="option" aria-selected={false} className="opt" onClick={() => setPick(k)}>{k}</button>
              ))}
              {pick && (
                <div className="yrs">
                  {years.map(({ y, g }) => (
                    <button key={y} role="option" aria-selected={false} className="chip" disabled={pending}
                      onClick={() => start(async () => { await setGarage(g.id, y, `${y} ${pick}`); close(); })}>{y}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="dlg-f">
              {pick && <button className="btn" onClick={() => setPick(null)}>Back</button>}
              {label && <button className="btn" onClick={() => start(async () => { await clearGarage(); close(); })}>Remove my bike</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function RegionPicker({ current, options }: { current: string; options: { country: string; label: string; currency: string }[] }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  useDismiss(open, () => setOpen(false));
  const cur = options.find((o) => o.country === current)!;
  return (
    <div style={{ position: "relative" }}>
      <button className="btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Globe className="icon s" aria-hidden /><span>{cur.label} · {cur.currency}</span>
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Region">
          {options.map((o) => (
            <button key={o.country} role="option" aria-selected={o.country === current} className="opt"
              onClick={() => start(async () => { await setCountry(o.country); setOpen(false); })}>
              {o.label} · {o.currency}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
