import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckoutForm from "@/components/CheckoutForm";
import { countryName, shippingOptions } from "@/app/actions";
import { getCart, getRegion } from "@/lib/state";

export default async function Checkout() {
  const cart = await getCart();
  if (!cart?.items?.length) redirect("/cart");
  const { region, country } = await getRegion();
  const opts = await shippingOptions();
  const countries = await Promise.all(region.countries.map(async (c) => ({ code: c.iso_2, name: await countryName(c.iso_2) })));
  return (
    <>
      <Header />
      <div className="wrap">
        <div className="crumb">Home / Cart / Checkout</div>
        <h1>Checkout</h1>
        <CheckoutForm
          currency={cart.currency_code}
          countries={countries}
          defaults={{ country }}
          summary={{ subtotal: cart.subtotal + cart.tax_total }}
          options={opts.map((o) => ({ id: o.id, name: o.name, amount: o.amount, label: o.type?.label ?? o.name, description: o.type?.description ?? "" }))}
        />
      </div>
    </>
  );
}
