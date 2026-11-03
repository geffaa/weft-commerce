import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, CircleHelp, X } from "lucide-react";
import Header from "@/components/Header";
import { stock } from "@/components/Fit";
import { AddToCart } from "@/components/AddToCart";
import { fitmentFor, getProduct } from "@/lib/catalog";
import { getGarage, getRegion } from "@/lib/state";
import { imageFor, money } from "@/lib/format";

const BOX = {
  fits: { cls: "box2", Icon: Check, title: (b: string) => `Fits your ${b}`, body: "Checked against our fitment table." },
  no_fit: { cls: "box2 bad", Icon: X, title: (b: string) => `Does not fit your ${b}`, body: "This part is listed for other models or years. Check the parts that do fit your bike." },
  unknown: { cls: "box2 warn", Icon: CircleHelp, title: () => "Check fitment", body: "We have no fitment data for this part. Confirm with a person before ordering." },
} as const;

export default async function Pdp({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { region, country } = await getRegion();
  const p = await getProduct(handle, region.id, country);
  if (!p) notFound();
  const v = p.variants![0];
  const garage = await getGarage();
  const fit = garage ? (await fitmentFor(garage.bikeId, [v.sku]))[v.sku] ?? "unknown" : null;
  const st = stock(v.inventory_quantity);
  const amount = v.calculated_price?.calculated_amount ?? 0;
  const price = money(amount, region.currency_code);
  const img = imageFor(v.sku);
  const cat = p.categories?.[0];
  const taxNote = country === "us" ? "No sales tax is charged in this demo." : country === "au" ? "Price includes 10% GST." : country === "gb" ? "UK price includes 20% VAT." : "Price includes VAT for your country.";
  const box = fit ? BOX[fit] : null;

  return (
    <>
      <Header active={cat?.handle} />
      <div className="wrap">
        <div className="crumb">Home / {cat ? <Link href={`/c/${cat.handle}`}>{cat.name}</Link> : "Parts"} / {p.title}</div>
        <div className="pdp">
          <div>
            <div className="ph">
              {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt={p.title} /> : <div className="neutral" style={{ width: "100%", height: 360 }}>{v.sku}</div>}
            </div>
          </div>
          <div>
            <div className="sku">{v.sku} · Halden Moto</div>
            <h1 style={{ marginTop: 4 }}>{p.title}</h1>
            {box && garage && (
              <div className={box.cls}><box.Icon className="icon l" aria-hidden /><div><b>{box.title(garage.label)}</b><div style={{ fontSize: 14 }}>{box.body}</div></div></div>
            )}
            {!garage && <p className="vat" style={{ margin: "14px 0" }}>Add your bike (top right) to check that this part fits.</p>}
            <div className="pr fig">{price}</div>
            <div className="vat">{taxNote}</div>
            <AddToCart variantId={v.id} price={price} disabled={st.out} reason={st.out ? "This part is out of stock. Check back soon or choose another part." : undefined} />
            <div className="row" style={{ marginTop: 12, fontSize: 14 }}><span className={`st${st.low ? " low" : ""}`}><i />{st.text}</span></div>
            <table className="spt">
              <thead><tr><th colSpan={2} style={{ textAlign: "left" }}>Specification</th></tr></thead>
              <tbody>
                {p.metadata?.position && <tr><td>Position</td><td>{p.metadata.position}</td></tr>}
                {p.metadata?.spec && <tr><td>Detail</td><td>{p.metadata.spec}</td></tr>}
                <tr><td>Part number</td><td>{v.sku}</td></tr>
                {cat && <tr><td>Category</td><td>{cat.name}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <p className="syn">Synthetic demo store. Fitment data is fictional. Photos: see img/credits.json.</p>
      </div>
    </>
  );
}
