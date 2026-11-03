"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ChevronDown } from "lucide-react";
import { completeOrder, submitDetails } from "@/app/actions";
import { money } from "@/lib/format";

type Opt = { id: string; name: string; amount: number; label: string; description: string };
type Props = {
  currency: string; countries: { code: string; name: string }[]; options: Opt[];
  defaults: { country: string }; summary: { subtotal: number };
};
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");

function Field({ label, value, onChange, type = "text", autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string }) {
  return (
    <label className="fld"><span>{label}</span>
      <input className="inp" style={{ font: "inherit", width: "100%" }} type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function CheckoutForm(p: Props) {
  const [phase, setPhase] = useState<"details" | "pay">("details");
  const [secret, setSecret] = useState<string>("");
  const [total, setTotal] = useState<number | null>(null);
  const [d, setD] = useState({ email: "", first_name: "", last_name: "", address_1: "", city: "", postal_code: "", country_code: p.defaults.country });
  const [opt, setOpt] = useState(p.options[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d) => (v: string) => setD((s) => ({ ...s, [k]: v }));
  const chosen = p.options.find((o) => o.id === opt);
  const shown = useMemo(() => p.summary.subtotal + (chosen?.amount ?? 0), [p.summary.subtotal, chosen]);

  const goPay = () => start(async () => {
    setErr("");
    const r = await submitDetails({ ...d, option_id: opt });
    if (!r.ok) return setErr(r.error);
    setSecret(r.clientSecret); setTotal(r.total); setPhase("pay");
  });

  return (
    <div className="pg">
      <div style={{ display: "grid", gap: 20 }}>
        <div className="steps"><b>1 Details</b><i /><b>2 Delivery</b><i /><span style={phase === "pay" ? { color: "var(--ink)", fontWeight: 700 } : undefined}>3 Payment</span></div>
        <section className="card" aria-disabled={phase === "pay"}>
          <h2>Contact and delivery address</h2>
          <div className="in" style={phase === "pay" ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
            <Field label="Email" type="email" autoComplete="email" value={d.email} onChange={set("email")} />
            <div className="g2"><Field label="First name" autoComplete="given-name" value={d.first_name} onChange={set("first_name")} /><Field label="Last name" autoComplete="family-name" value={d.last_name} onChange={set("last_name")} /></div>
            <Field label="Address" autoComplete="address-line1" value={d.address_1} onChange={set("address_1")} />
            <div className="g2">
              <Field label="City" autoComplete="address-level2" value={d.city} onChange={set("city")} />
              <Field label="Postcode" autoComplete="postal-code" value={d.postal_code} onChange={set("postal_code")} />
            </div>
            <div className="fld" style={{ position: "relative" }}><span>Country</span>
              <button type="button" className="inp" style={{ justifyContent: "space-between", textAlign: "left", font: "inherit" }} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
                <span>{p.countries.find((c) => c.code === d.country_code)?.name}</span><ChevronDown className="icon s" aria-hidden />
              </button>
              {open && (
                <div className="menu" style={{ left: 0, right: "auto", width: "100%" }} role="listbox" aria-label="Country">
                  {p.countries.map((c) => <button type="button" key={c.code} role="option" aria-selected={c.code === d.country_code} className="opt" onClick={() => { set("country_code")(c.code); setOpen(false); }}>{c.name}</button>)}
                </div>
              )}
            </div>
          </div>
        </section>
        <section className="card"><h2>Delivery</h2>
          <div className="in" style={phase === "pay" ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
            <div role="radiogroup" aria-label="Delivery method">
              {p.options.map((o) => (
                <button type="button" key={o.id} role="radio" aria-checked={opt === o.id} className="rad" style={{ width: "100%", textAlign: "left", font: "inherit" }} onClick={() => setOpt(o.id)}>
                  <span className="dot" /><div><b>{o.label}</b><div className="vat">{o.description}</div></div><span className="p fig">{money(o.amount, p.currency)}</span>
                </button>
              ))}
            </div>
            {phase === "details" && (
              <>
                {err && <p role="alert" style={{ color: "var(--no)", marginTop: 8 }}>{err}</p>}
                <button className="cta" style={{ width: "100%", marginTop: 12 }} disabled={pending || !opt} onClick={goPay}>{pending ? "Saving…" : "Continue to payment"}</button>
              </>
            )}
          </div>
        </section>
        {phase === "pay" && secret && (
          <section className="card"><h2>Payment</h2>
            <div className="in">
              <div className="vat" style={{ marginBottom: 12 }}>Test mode: card 4242 4242 4242 4242, any future date and code. For 3-D Secure use 4000 0027 6000 3184.</div>
              <Elements stripe={stripePromise} options={{ clientSecret: secret, appearance: { theme: "stripe", variables: { colorPrimary: "#0E5A6B", fontFamily: "Albert Sans, system-ui, sans-serif", borderRadius: "8px" } } }}>
                <PayBox total={total ?? shown} currency={p.currency} />
              </Elements>
            </div>
          </section>
        )}
      </div>
      <aside className="card sum" aria-label="Order summary">
        <h2>Order summary</h2>
        <dl><dt>Subtotal</dt><dd className="fig">{money(p.summary.subtotal, p.currency)}</dd>
          <dt>Delivery</dt><dd className="fig">{chosen ? money(chosen.amount, p.currency) : "—"}</dd>
          <dt className="tot">Total</dt><dd className="fig">{money(total ?? shown, p.currency)}</dd></dl>
        <div className="vat" style={{ padding: "0 20px 20px" }}>Prices include tax where it applies. The order is created only after your payment is confirmed.</div>
      </aside>
    </div>
  );
}

function PayBox({ total, currency }: { total: number; currency: string }) {
  const stripe = useStripe(); const elements = useElements(); const router = useRouter();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr("");
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: `${location.origin}/checkout/return` } });
    if (error) { setErr(error.message ?? "Payment failed."); setBusy(false); return; }
    const r = await completeOrder();
    if (r.ok) router.push(`/order/${r.orderId}`);
    else { setErr(r.error); setBusy(false); }
  };
  return (
    <>
      <PaymentElement />
      {err && <p role="alert" style={{ color: "var(--no)", marginTop: 10 }}>{err}</p>}
      <button className="cta" style={{ width: "100%", marginTop: 14 }} disabled={busy || !stripe} onClick={pay}>{busy ? "Processing…" : `Pay ${money(total, currency)}`}</button>
    </>
  );
}
