import { HttpException, Injectable } from "@nestjs/common";

/** Jendela geser dalam memori: cukup untuk satu proses hub; untuk beberapa proses pakai Redis. */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  /** Dapat diganti di tes. Bukan parameter konstruktor: Nest tak bisa menyuntikkan tipe Function. */
  now: () => number = Date.now;

  reset() { this.hits.clear(); }

  hit(key: string, max: number, windowMs: number) {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      this.hits.set(key, arr);
      throw new HttpException(`Too many messages. Please wait ${Math.ceil((windowMs - (t - arr[0])) / 1000)} seconds.`, 429);
    }
    arr.push(t);
    this.hits.set(key, arr);
    // Kebersihan sederhana: buang kunci yang sudah kosong agar peta tak tumbuh tanpa batas.
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < windowMs)) this.hits.delete(k);
  }
}
