import Link from "next/link";
import { CircleHelp } from "lucide-react";
import Header from "@/components/Header";
import { FitChip } from "@/components/Fit";
import { QtyStepper, RemoveLine } from "@/components/AddToCart";
import { fitmentFor } from "@/lib/catalog";
import { getCart, getGarage } from "@/lib/state";
import { imageFor, money } from "@/lib/format";

export default async function CartPage() {
  const cart = await getCart();
  const garage = await getGarage();
  const items = cart?.items ?? [];
  const skus = items.map((i) => i.variant_sku).filter((s): s is string => !!s);
  const fit = await fitmentFor(garage?.bikeId, skus);
  const cur = cart?.currency_code ?? "gbp";
  const misfit = garage ? items.filter((i) => i.variant_sku && fit[i.variant_sku] === "no_fit") : [];

  return (
    <>
      <Header />
      <div className="wrap">
        <div className="crumb">Home / Cart</div>
        <h1>Your cart</h1>
        <p className="sub">{items.reduce((n, i) => n + i.quantity, 0)} items · prices in {cur.toUpperCase()}</p>
        {!items.length ? (
          <div className="card" style={{ marginTop: 20 }}><div className="in">Your cart is empty. <Link href="/c/brakes" style={{ textDecoration: "underline", fontWeight: 650 }}>Browse parts</Link></div></div>
        ) : (
          <div className="pg">
            <div className="card">
              {misfit.length > 0 && garage && (
                <div className="warn" role="alert" style={{ marginTop: 18 }}>
                  <CircleHelp className="icon" aria-hidden />
                  <div><b>{misfit.length === 1 ? "One part does not fit your bike." : `${misfit.length} parts do not fit your bike.`}</b> {misfit.map((i) => i.variant_sku).join(", ")} {misfit.length === 1 ? "is" : "are"} not listed for your {garage.label}. You can still buy {misfit.length === 1 ? "it" : "them"}, for example for another bike.</div>
                </div>
              )}
              {items.map((i) => {
                const img = imageFor(i.variant_sku ?? "");
                const s = garage && i.variant_sku ? fit[i.variant_sku] ?? "unknown" : null;
                return (
                  <div className="li" key={i.id}>
                    {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt="" /> : <span className="neutral" style={{ gridRow: "1/4" }}>{i.variant_sku?.split("-")[1]}</span>}
                    <div>
                      <div className="pn">{i.title}</div><div className="sku">{i.variant_sku}</div>
                      {s && <div style={{ marginTop: 6 }}><FitChip status={s} bike={garage!.label} /></div>}
                    </div>
                    <div className="price fig" style={{ textAlign: "right" }}>{money(i.total, cur)}</div>
                    <div className="row" style={{ margin: "6px 0 0" }}><QtyStepper itemId={i.id} qty={i.quantity} /><RemoveLine itemId={i.id} /></div><div />
                  </div>
                );
              })}
            </div>
            <aside className="card sum" aria-label="Order summary">
              <h2>Order summary</h2>
              <dl>
                <dt>Subtotal</dt><dd className="fig">{money(cart!.subtotal + cart!.tax_total, cur)}</dd>
                <dt>Delivery</dt><dd>Chosen at checkout</dd>
              </dl>
              <div style={{ padding: "0 20px 20px", display: "grid", gap: 10 }}>
                <Link className="cta" href="/checkout" style={{ display: "grid", placeItems: "center" }}>Go to checkout</Link>
                <div className="vat">Free UK delivery over £60.</div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
