import { ChannelError } from "../outbox/errors";

export const SHOPIFY_API_VERSION = "2026-10"; // stabil terbaru per 2026-11-03 (publicApiVersions); jadikan konfigurasi

export type ShopifyCreds = { shop: string; clientId: string; clientSecret: string };
export type ShopifyVariant = {
  variantId: string; sku: string | null; productTitle: string; variantTitle: string;
  inventoryItemId: string; tracked: boolean; available: number | null;
};
type Fetch = typeof fetch;

/**
 * Klien Admin GraphQL Shopify. Token ditukar lewat client_credentials (berlaku 24 jam) dan diperbarui
 * otomatis; kegagalan diklasifikasi (auth/validation/rate_limit/transient) agar worker tahu apakah
 * harus mengulang.
 */
export class ShopifyClient {
  private token?: { value: string; expiresAt: number };
  constructor(
    private readonly creds: ShopifyCreds,
    private readonly opts: { fetch?: Fetch; apiVersion?: string; now?: () => number } = {},
  ) {}

  private get f() { return this.opts.fetch ?? fetch; }
  private now() { return (this.opts.now ?? Date.now)(); }
  private get base() { return `https://${this.creds.shop}`; }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.f(`${this.base}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.creds.clientId, client_secret: this.creds.clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const msg = body.error_description ?? body.error ?? `HTTP ${res.status}`;
      throw new ChannelError(`Shopify rejected the credentials: ${msg}${res.status < 500 ? " (check the client ID and secret)" : ""}`, res.status >= 500 ? "transient" : "auth");
    }
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 86_400) * 1000 };
    return body.access_token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}, retried = false): Promise<T> {
    const res = await this.f(`${this.base}/admin/api/${this.opts.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": await this.accessToken() },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && !retried) { this.token = undefined; return this.graphql<T>(query, variables, true); }
    if (res.status === 401 || res.status === 403) throw new ChannelError(`Shopify denied access (HTTP ${res.status})`, "auth");
    if (res.status === 429) throw new ChannelError("Shopify rate limit", "rate_limit", Number(res.headers.get("retry-after") ?? 2) * 1000);
    if (res.status >= 500) throw new ChannelError(`Shopify error HTTP ${res.status}`, "transient");
    const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (body.errors?.length) {
      const e = body.errors[0];
      if (e.extensions?.code === "THROTTLED") throw new ChannelError("Shopify query cost throttled", "rate_limit", 2_000);
      if (e.extensions?.code === "ACCESS_DENIED") throw new ChannelError(e.message, "auth");
      throw new ChannelError(e.message, "validation");
    }
    return body.data as T;
  }

  /** Uji koneksi: nama toko, scope yang diberikan, dan scope yang kurang. */
  async testConnection(required: string[]) {
    const d = await this.graphql<{ shop: { name: string; currencyCode: string }; currentAppInstallation: { accessScopes: { handle: string }[] } }>(
      `{ shop { name currencyCode } currentAppInstallation { accessScopes { handle } } }`);
    const granted = d.currentAppInstallation.accessScopes.map((s) => s.handle);
    // Scope write_X mencakup read_X.
    const has = (s: string) => granted.includes(s) || (s.startsWith("read_") && granted.includes("write_" + s.slice(5)));
    return { shopName: d.shop.name, currency: d.shop.currencyCode, granted, missing: required.filter((s) => !has(s)) };
  }

  async locations() {
    const d = await this.graphql<{ locations: { nodes: { id: string; name: string; isActive: boolean }[] } }>(`{ locations(first: 20) { nodes { id name isActive } } }`);
    return d.locations.nodes.filter((l) => l.isActive);
  }

  /** Semua varian beserta stok di satu lokasi (paginasi kursor). */
  async *variants(locationId: string): AsyncGenerator<ShopifyVariant> {
    let after: string | null = null;
    for (;;) {
      const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: {
        id: string; sku: string | null; title: string; product: { title: string };
        inventoryItem: { id: string; tracked: boolean; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null };
      }[] } } = await this.graphql(
        `query($after: String, $loc: ID!) { productVariants(first: 100, after: $after) {
           pageInfo { hasNextPage endCursor }
           nodes { id sku title product { title }
             inventoryItem { id tracked inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } } } }`,
        { after, loc: locationId });
      for (const v of d.productVariants.nodes) {
        yield {
          variantId: v.id, sku: v.sku?.trim() || null, productTitle: v.product.title, variantTitle: v.title,
          inventoryItemId: v.inventoryItem.id, tracked: v.inventoryItem.tracked,
          available: v.inventoryItem.inventoryLevel?.quantities.find((q) => q.name === "available")?.quantity ?? null,
        };
      }
      if (!d.productVariants.pageInfo.hasNextPage) return;
      after = d.productVariants.pageInfo.endCursor;
    }
  }

  /**
   * Set stok ABSOLUT. changeFromQuantity: null = tanpa pembanding, karena Weft sumber kebenaran
   * (sejak 2026-04 field compareQuantity/ignoreCompareQuantity dihapus).
   */
  async setQuantity(inventoryItemId: string, locationId: string, quantity: number, idempotencyKey: string) {
    const d = await this.graphql<{ inventorySetQuantities: { userErrors: { code?: string; message: string; field?: string[] }[] } }>(
      `mutation($input: InventorySetQuantitiesInput!, $key: String!) {
         inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { code message field } } }`,
      { key: idempotencyKey, input: { name: "available", reason: "correction", referenceDocumentUri: `weft://stock/${idempotencyKey}`,
        quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity: null }] } });
    const errs = d.inventorySetQuantities.userErrors;
    if (errs.length) throw new ChannelError(errs.map((e) => e.message).join("; "), "validation");
  }

  /** Daftarkan webhook order terbayar. Idempoten: yang sudah ada dengan callback sama dilewati. */
  async ensureWebhook(topic: "ORDERS_PAID", callbackUrl: string): Promise<"created" | "exists"> {
    const d = await this.graphql<{ webhookSubscriptions: { nodes: { topic: string; endpoint: { callbackUrl?: string } }[] } }>(
      `{ webhookSubscriptions(first: 50) { nodes { topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`);
    if (d.webhookSubscriptions.nodes.some((n) => n.topic === topic && n.endpoint.callbackUrl === callbackUrl)) return "exists";
    const r = await this.graphql<{ webhookSubscriptionCreate: { userErrors: { message: string }[] } }>(
      `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) {
         webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) { userErrors { message } } }`,
      { topic, url: callbackUrl });
    const errs = r.webhookSubscriptionCreate.userErrors;
    if (errs.length) throw new ChannelError(errs.map((e) => e.message).join("; "), "validation");
    return "created";
  }
}
