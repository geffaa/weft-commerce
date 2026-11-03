"use client";
import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { addToCart, updateLine } from "@/app/actions";

export function AddToCart({ variantId, price, disabled, reason }: { variantId: string; price: string; disabled?: boolean; reason?: string }) {
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  return (
    <>
      <div className="row">
        <div className="qty">
          <button aria-label="Fewer" onClick={() => setQty(Math.max(1, qty - 1))} disabled={disabled}><Minus className="icon s" aria-hidden /></button>
          <span className="fig" aria-live="polite">{qty}</span>
          <button aria-label="More" onClick={() => setQty(Math.min(20, qty + 1))} disabled={disabled}><Plus className="icon s" aria-hidden /></button>
        </div>
        <button className="cta" disabled={disabled || pending} onClick={() => start(() => addToCart(variantId, qty))}>
          {disabled ? "Out of stock" : pending ? "Adding…" : `Add to cart · ${price}`}
        </button>
      </div>
      {disabled && reason && <p className="vat" style={{ marginTop: 8 }}>{reason}</p>}
    </>
  );
}

export function QtyStepper({ itemId, qty }: { itemId: string; qty: number }) {
  const [pending, start] = useTransition();
  return (
    <div className="qty" aria-busy={pending}>
      <button aria-label="Fewer" disabled={pending} onClick={() => start(() => updateLine(itemId, qty - 1))}><Minus className="icon s" aria-hidden /></button>
      <span className="fig">{qty}</span>
      <button aria-label="More" disabled={pending} onClick={() => start(() => updateLine(itemId, qty + 1))}><Plus className="icon s" aria-hidden /></button>
    </div>
  );
}

export function RemoveLine({ itemId }: { itemId: string }) {
  const [pending, start] = useTransition();
  return <button className="rm" disabled={pending} onClick={() => start(() => updateLine(itemId, 0))}>Remove</button>;
}

export function QuickAdd({ variantId, disabled }: { variantId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn pri" style={{ height: 34 }} disabled={disabled || pending} onClick={() => start(() => addToCart(variantId, 1))}>
      {pending ? "…" : "Add"}
    </button>
  );
}
