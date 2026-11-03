import { Injectable, Logger } from "@nestjs/common";

/** Batas ke kanal penjualan eksternal (Shopify). Implementasi nyata menyusul setelah toko dev tersedia. */
export interface ChannelClient {
  /** Set stok sebagai kuantitas ABSOLUT. Idempoten: mengirim nilai yang sama dua kali tidak berbahaya. */
  setQuantity(sku: string, quantity: number, idempotencyKey: string): Promise<void>;
}
export const CHANNEL = Symbol("CHANNEL");

@Injectable()
export class LoggingChannelClient implements ChannelClient {
  private readonly log = new Logger("Channel");
  async setQuantity(sku: string, quantity: number) {
    this.log.log(`(no channel connected) would set ${sku} = ${quantity}`);
  }
}
