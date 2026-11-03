import { Check, CircleHelp, X } from "lucide-react";
import type { FitStatus } from "@/lib/types";

export function FitChip({ status, bike }: { status: FitStatus; bike?: string }) {
  if (status === "fits") return <span className="fit y"><Check className="icon s" aria-hidden />{bike ? `Fits your ${bike}` : "Fits"}</span>;
  if (status === "no_fit") return <span className="fit n"><X className="icon s" aria-hidden />{bike ? `Does not fit your ${bike}` : "Does not fit"}</span>;
  return <span className="fit q"><CircleHelp className="icon s" aria-hidden />Check fitment</span>;
}

export function stock(qty: number | undefined) {
  const q = qty ?? 0;
  if (q <= 0) return { text: "Out of stock", low: true, out: true };
  if (q <= 5) return { text: `${q} left`, low: true, out: false };
  return { text: `${q} in stock`, low: false, out: false };
}
