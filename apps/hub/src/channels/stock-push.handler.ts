import type { InventoryService } from "../ledger/inventory.service";
import type { ChannelClient } from "./channel";
import type { Handler } from "../outbox/outbox.worker";

/**
 * Membaca stok TERKINI saat mengirim (bukan nilai saat tugas dibuat), sehingga kuantitas basi
 * tidak pernah menimpa kanal. Kuantitas absolut + idempoten = aman diulang.
 */
export const stockPushHandler = (inventory: InventoryService, channel: ChannelClient): Handler => async (job) => {
  const { sku } = job.payload as { sku: string };
  const quantity = await inventory.stock(sku);
  // Kunci idempotensi Shopify menolak pemakaian ulang dengan parameter berbeda, dan mengembalikan hasil
  // lama bila parameternya sama. Maka kunci = tugas + kuantitas: retry yang sama aman, nilai baru = kunci baru.
  await channel.setQuantity(sku, quantity, `${job.id}:${quantity}`);
};
