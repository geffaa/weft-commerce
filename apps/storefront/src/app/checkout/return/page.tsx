import { redirect } from "next/navigation";
import { completeOrder } from "@/app/actions";

// Tujuan kembali untuk metode bayar berbasis redirect: selesaikan cart setelah Stripe mengonfirmasi.
export default async function Return() {
  const r = await completeOrder();
  if (r.ok) redirect(`/order/${r.orderId}`);
  redirect("/checkout");
}
