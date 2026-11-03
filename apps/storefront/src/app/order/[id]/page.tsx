import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import Header from "@/components/Header";
import { medusa } from "@/lib/medusa";
import { imageFor, money } from "@/lib/format";

type Order = {
  id: string; display_id: number; email: string; currency_code: string; total: number; created_at: string;
  items: { id: string; title: string; quantity: number; total: number; variant_sku?: string }[];
  shipping_address?: { first_name: string; last_name: string; address_1: string; city: string; postal_code: string; country_code: string };
  shipping_total: number; payment_status?: string;
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await medusa<{ order: Order }>(`/store/orders/${id}?fields=*items,*shipping_address,+email,+total,+shipping_total,+display_id,+payment_status`)
    .then((r) => r.order).catch(() => null);
  if (!order) notFound();
  const cur = order.currency_code;
  const a = order.shipping_address;
  const when = new Date(order.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <Header />
      <div className="wrap">
        <div className="crumb">Home / Orders / HM-{order.display_id}</div>
        <h1>Order HM-{order.display_id}</h1>
        <p className="sub">Placed {when} · {money(order.total, cur)} paid by card</p>
        <div className="pg">
          <div style={{ display: "grid", gap: 20 }}>
            <section className="card"><h2>Where it is</h2><div className="in"><ol className="tl">
              <li><span className="d"><Check className="icon s" aria-hidden /></span><div><div className="t">Order placed</div><div className="m">Confirmation for {order.email}</div></div><span className="m fig">{when}</span></li>
              <li><span className="d"><Check className="icon s" aria-hidden /></span><div><div className="t">Payment confirmed</div><div className="m">Card payment succeeded</div></div><span className="m">Done</span></li>
              <li><span className="d now" /><div><div className="t">Packing</div><div className="m">Your parts are reserved for you</div></div><span className="m">Now</span></li>
              <li><span className="d todo" /><div><div className="t" style={{ color: "var(--ink-3)" }}>Shipped</div><div className="m">A tracking link will appear here</div></div><span className="m" /></li>
              <li><span className="d todo" /><div><div className="t" style={{ color: "var(--ink-3)" }}>Delivered</div></div><span className="m" /></li>
            </ol></div></section>
            <section className="card"><h2>Items</h2>
              {order.items.map((i) => {
                const img = imageFor(i.variant_sku ?? "");
                return (
                  <div className="li" key={i.id}>
                    {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt="" /> : <span className="neutral" style={{ gridRow: "1/4" }}>{i.variant_sku?.split("-")[1]}</span>}
                    <div><div className="pn">{i.title}</div><div className="sku">{i.variant_sku}</div></div>
                    <div className="price fig" style={{ textAlign: "right" }}>{money(i.total, cur)}</div>
                    <div className="vat">Qty {i.quantity}</div><div />
                  </div>
                );
              })}
            </section>
          </div>
          {a && (
            <aside className="card sum"><h2>Delivery to</h2>
              <div className="in" style={{ fontSize: 14.5 }}>{a.first_name} {a.last_name}<br />{a.address_1}, {a.city}<br />{a.postal_code}, {a.country_code.toUpperCase()}</div>
              <dl><dt>Delivery</dt><dd className="fig">{money(order.shipping_total, cur)}</dd><dt className="tot">Total</dt><dd className="fig">{money(order.total, cur)}</dd></dl>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
