import pg from "pg";

const HUB = "http://localhost:3101";
const post = async (path: string, token: string | null, body: unknown) => {
  const r = await fetch(HUB + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
};

export default async function setup() {
  const { token } = await post("/auth/login", null, { email: "owner@example.com", password: "owner-password-123" });
  for (const role of ["ops", "finance", "support"]) await post("/members", token, { email: `${role}@example.com`, password: `${role}-password-123`, role });

  const db = new pg.Client({ connectionString: "postgres://weft:weft@localhost:54330/hub_e2e" });
  await db.connect();
  const [stockRun] = (await db.query("insert into hub.run(kind,trigger,status,finished_at,stats) values ('reconcile.stock','seed','done',now(),'{}') returning id")).rows;
  const [xeroRun] = (await db.query("insert into hub.run(kind,trigger,status,finished_at,stats) values ('reconcile.xero','seed','done',now(),'{}') returning id")).rows;
  await db.query("insert into hub.run(kind,trigger,status,stats) values ('import','seed','failed','{\"error\":\"Shopify down\"}')");
  const stockDiffs = [{ sku: "HM-BP-0196", variantId: "v1", productTitle: "Sintered front brake pads", weft: 38, channel: 41, difference: 3, pendingPush: false, kind: "mismatch" }];
  const xeroDiffs = [
    { orderId: "00000000-0000-0000-0000-000000000001", source: "shopify", sourceRef: "SH-7731", currency: "USD", orderTotalMinor: 14875, invoiceId: null, invoiceStatus: null, invoiceTotalMinor: null, amountDueMinor: null, kind: "missing_invoice", pendingJob: false, fixable: true },
    { orderId: "00000000-0000-0000-0000-000000000002", source: "shopify", sourceRef: "SH-7740", currency: "USD", orderTotalMinor: 5000, invoiceId: "inv", invoiceStatus: "VOIDED", invoiceTotalMinor: 5000, amountDueMinor: 0, kind: "voided", pendingJob: false, fixable: false },
  ];
  await db.query("insert into hub.reconciliation_report(kind,run_id,diffs,summary) values ('stock',$1,$2,$3)", [stockRun.id, JSON.stringify(stockDiffs), JSON.stringify({ checked: 4, mismatches: 1, missingInChannel: 0 })]);
  await db.query("insert into hub.reconciliation_report(kind,run_id,diffs,summary) values ('xero',$1,$2,$3)", [xeroRun.id, JSON.stringify(xeroDiffs), JSON.stringify({ checked: 5, missingInvoice: 1, unpaid: 0, amountMismatch: 0, voided: 1 })]);
  await db.query(`insert into hub.exception_item(error_class,message,payload) values
    ('validation','Organisation is not subscribed to currency GBP','{"topic":"xero.invoice","idempotencyKey":"xero.invoice:o1","payload":{"orderId":"o1"},"attempts":1}'),
    ('stock','Insufficient stock: HM-BP-0196 1 left, 2 requested','{"shortages":[]}'),
    ('auth','Invalid access token','{"topic":"stock.push","idempotencyKey":"stock.push:A","payload":{"sku":"A"},"attempts":1}')`);
  await db.query("insert into hub.ledger_order(source,source_ref,currency,total_minor,status,customer_email) values ('shopify','SH-7731','USD',14875,'accepted','anna@example.com'),('shopify','SH-7740','USD',5000,'cannot_fulfil',null)");
  await db.query("insert into hub.sku_map(channel,channel_variant_id,inventory_item_id,weft_sku,product_title,variant_title,state,conflict_reason) values ('shopify','v1','i1','HM-BP-0196','Sintered front brake pads','Default','mapped',null),('shopify','v2','i2',null,'Gift Card','$10','missing','Variant has no SKU'),('shopify','v3','i3','DUP-1','Chain','A','conflict','SKU \"DUP-1\" is used by 2 variants')");
  await db.end();
}
