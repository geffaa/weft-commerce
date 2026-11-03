import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { LogoMark } from "./Logo";
import { GaragePicker, RegionPicker } from "./Pickers";
import { COUNTRY_LABEL, getBikeModels, getCart, getGarage, getRegion } from "@/lib/state";
import { listCategories } from "@/lib/catalog";

export default async function Header({ active }: { active?: string }) {
  const [{ regions, country }, garage, cart, cats, models] = await Promise.all([
    getRegion(), getGarage(), getCart(), listCategories(), getBikeModels(),
  ]);
  const count = cart?.items?.reduce((n, i) => n + i.quantity, 0) ?? 0;
  const options = regions.map((r) => {
    const c = r.countries.some((x) => x.iso_2 === country) ? country : r.countries[0].iso_2;
    return { country: c, label: COUNTRY_LABEL[c] ?? c.toUpperCase(), currency: r.currency_code.toUpperCase() };
  });
  return (
    <>
      <div className="util"><span>Free UK delivery over £60</span><span>Duties and VAT shown at checkout for EU and US</span><span>Trade accounts: net 30</span></div>
      <header className="h">
        <div className="hr">
          <Link className="logo" href="/"><LogoMark size={30} />Halden Moto</Link>
          <div style={{ flex: 1 }} />
          <GaragePicker models={models} label={garage?.label ?? null} />
          <div className="r">
            <RegionPicker current={country} options={options} />
            <Link className="btn" href="/cart" aria-label={`Cart, ${count} items`}>
              <ShoppingBag className="icon s" aria-hidden /><span>Cart</span> {count}
            </Link>
          </div>
        </div>
        <nav className="nav" aria-label="Categories">
          {cats.map((c) => (
            <Link key={c.id} href={`/c/${c.handle}`} aria-current={active === c.handle ? "page" : undefined}>{c.name}</Link>
          ))}
        </nav>
      </header>
    </>
  );
}
