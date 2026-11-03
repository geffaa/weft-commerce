/** Kegagalan terklasifikasi: menentukan retry atau langsung dead-letter, dan kelas di Exceptions. */
export type ErrorClass = "validation" | "auth" | "rate_limit" | "transient" | "stock";

export class ChannelError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ErrorClass,
    /** Untuk rate_limit: tunggu minimal sekian ms (mis. dari header Retry-After). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  /** validation dan auth tidak membaik dengan mencoba ulang; butuh perbaikan manusia. */
  get permanent() {
    return this.errorClass === "validation" || this.errorClass === "auth";
  }
}
