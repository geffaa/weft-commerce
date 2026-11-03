import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import Header from "@/components/Header";
import { FitChip, stock } from "@/components/Fit";
import { QuickAdd } from "@/components/AddToCart";
import { fitmentFor, listCategories, listProducts } from "@/lib/catalog";
import { getGarage, getRegion } from "@/lib/state";
import { imageFor, money } from "@/lib/format";

type SP = { sort?: string; fits?: string; pos?: string; instock?: string };
const SORTS = [["fit", "Best fit"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"]] as const;
const RANK = { fits: 0, unknown: 1, no_fit: 2 } as const;

export default async function Collection({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<SP> }) {
  const { handle } = await params;
  const sp = await searchParams;
  const cats = await listCategories();
  const cat = cats.find((c) => c.handle === handle);
  if (!cat) notFound();
  const { region, country } = await getRegion();
  const garage = await getGarage();
  const products = await listProducts(region.id, country, cat.id);
  const fit = await fitmentFor(garage?.bikeId, products.flatMap((p) => p.variants?.map((v) => v.sku) ?? []));
  const status = (p: (typeof products)[number]) => (garage ? fit[p.variants?.[0]?.sku ?? ""] ?? "unknown" : null);
  const price = (p: (typeof products)[number]) => p.variants?.[0]?.calculated_price?.calculated_amount ?? 0;

  let rows = products;
  if (sp.fits && garage) rows = rows.filter((p) => status(p) === "fits");
  if (sp.pos) rows = rows.filter((p) => p.metadata?.position === sp.pos);
  if (sp.instock) rows = rows.filter((p) => (p.variants?.[0]?.inventory_quantity ?? 0) > 0);
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : garage ? "fit" : "price-asc";
  rows = [...rows].sort((a, b) =>
    sort === "price-asc" ? price(a) - price(b)
    : sort === "price-desc" ? price(b) - price(a)
    : (RANK[status(a) ?? "unknown"] - RANK[status(b) ?? "unknown"]) || a.title.localeCompare(b.title));

  const href = (patch: Partial<SP>) => {
    const q = new URLSearchParams();
    const next: Record<string, string | undefined> = { ...sp, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return `/c/${handle}${s ? `?${s}` : ""}`;
  };
  const toggle = (k: keyof SP, v = "1") => href({ [k]: sp[k] === v ? undefined : v });

  return (
    <>
      <Header active={handle} />
      <div className="wrap">
        <div className="crumb">Home / {cat.name}</div>
        <h1>{cat.name}</h1>
        <p className="sub">{garage ? `Showing parts for your ${garage.label} first.` : "Add your bike to see which parts fit."}</p>
        <div className="layout">
          <aside className="f" aria-label="Filters">
            {garage && (
              <section><h2>My bike</h2>
                <Link href={toggle("fits")} className={`swt${sp.fits ? "" : " off"}`} role="switch" aria-checked={!!sp.fits}>
                  <span className="tr" />Only parts that fit
                </Link>
              </section>
            )}
            <section><h2>Position</h2>
              {(["front", "rear"] as const).map((p) => (
                <Link key={p} href={toggle("pos", p)} className="cbx" role="checkbox" aria-checked={sp.pos === p}>
                  <span className="box">{sp.pos === p && <Check className="icon s" aria-hidden />}</span>{p[0].toUpperCase() + p.slice(1)}
                </Link>
              ))}
            </section>
            <section><h2>Availability</h2>
              <Link href={toggle("instock")} className="cbx" role="checkbox" aria-checked={!!sp.instock}>
                <span className="box">{sp.instock && <Check className="icon s" aria-hidden />}</span>In stock
              </Link>
            </section>
          </aside>
          <div>
            <div className="bar">
              {garage && <span className="chip">{garage.label}</span>}
              <span style={{ color: "var(--ink-3)" }}>{rows.length} parts</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Sort">
                {SORTS.filter(([k]) => k !== "fit" || garage).map(([k, l]) => (
                  <Link key={k} className="chip" href={href({ sort: k })} aria-current={sort === k || undefined}>{l}</Link>
                ))}
              </div>
            </div>
            <div className="tw">
              <table>
                <thead><tr><th></th><th>Part</th><th>Fitment</th><th>Part no.</th><th>Stock</th><th className="n">Price</th><th></th></tr></thead>
                <tbody>
                  {rows.map((p) => {
                    const v = p.variants?.[0];
                    const st = stock(v?.inventory_quantity);
                    const img = imageFor(v?.sku ?? "");
                    const s = status(p);
                    return (
                      <tr key={p.id}>
                        <td className="img" style={{ width: 92 }}>
                          {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="thumb" src={img} alt="" /> : <span className="neutral">{v?.sku.split("-")[1]}</span>}
                        </td>
                        <td className="nm"><Link className="pn" href={`/p/${p.handle}`}>{p.title}</Link><div className="spec">{p.metadata?.spec}</div></td>
                        <td className="ft">{s ? <FitChip status={s} /> : <span className="muted">—</span>}</td>
                        <td className="sk"><span className="sku">{v?.sku}</span></td>
                        <td className="sto"><span className={`st${st.low ? " low" : ""}`}><i />{st.text}</span></td>
                        <td className="pc n"><span className="price fig">{money(price(p), region.currency_code)}</span></td>
                        <td className="ad" style={{ width: 110, textAlign: "right" }}>{v && <QuickAdd variantId={v.id} disabled={st.out} />}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-3)" }}>No parts match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <p className="syn">Synthetic demo store. Fitment data is fictional. Photos: see img/credits.json.</p>
      </div>
    </>
  );
}
