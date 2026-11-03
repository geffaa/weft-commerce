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
  // Anggota khusus untuk tes ganti peran, agar tes lain tidak ikut berubah.
  await post("/members", token, { email: "rolechange@example.com", password: "rolechange-password-123", role: "support" });

  const db = new pg.Client({ connectionString: `postgres://weft:weft@localhost:${process.env.E2E_PG_PORT ?? "54330"}/hub_e2e` });
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
  // Asisten: dua percakapan, dokumen pengetahuan, dan satu run evaluasi yang belum memenuhi target.
  const conv = async (state: string, summary: string | null) => (await db.query("insert into hub.conversation(anon_id,handoff_state,handoff_summary,region) values ($1,$2,$3,'UK') returning id", [`anon-${state}`, state, summary])).rows[0].id as string;
  const msg = (c: string, role: string, text: string, outcome: string | null, sources: unknown = null, tools: unknown = null) =>
    db.query("insert into hub.message(conversation_id,role,text,outcome,sources,tool_calls) values ($1,$2,$3,$4,$5,$6)", [c, role, text, outcome, sources && JSON.stringify(sources), tools && JSON.stringify(tools)]);
  const c1 = await conv("none", null);
  await msg(c1, "assistant", "Hi, I'm an AI assistant for Halden Moto Parts.", "disclosure");
  await msg(c1, "visitor", "How long do I have to return a part?", null);
  await msg(c1, "assistant", "You can return a part within 30 days of delivery.", "answered", [{ title: "Returns and refunds", kind: "policy" }]);
  await msg(c1, "visitor", "How much is HM-BP-0196?", null);
  await msg(c1, "assistant", "Sintered front brake pads, pair (HM-BP-0196): £24.90 in the UK store. 38 in stock.", "answered", null, [{ tool: "get_price_stock", args: { sku: "HM-BP-0196", region: "UK" }, result: { found: true, stock: 38 } }]);
  const c2 = await conv("requested", 'Visitor asked: "I want to talk to a real person". Reason: Visitor asked for a person.');
  await msg(c2, "visitor", "I want to talk to a real person", null);
  await msg(c2, "assistant", "I've passed this to a person.", "handoff");
  await db.query("insert into hub.doc(title,kind,source_key,source_hash,body) values ('Returns and refunds','policy','policy:returns.md','h1','b'),('Sintered front brake pads, pair (HM-BP-0196)','catalog','catalog:HM-BP-0196','h2','b')");
  const cases = (await db.query(`insert into hub.eval_case(key,question,category,expect) values
    ('returns-window','How long do I have to return a part?','answerable','{}'),
    ('price-pads','How much are the sintered front brake pads?','needs_tool','{}') returning id,key`)).rows;
  const scores = { total: { passed: 59, total: 60, rate: 0.983 }, byCategory: { answerable: { passed: 24, total: 24, rate: 1 }, needs_tool: { passed: 13, total: 14, rate: 0.929 }, must_refuse: { passed: 10, total: 10, rate: 1 }, must_handoff: { passed: 12, total: 12, rate: 1 } }, numbersWithoutTool: 1, meetsTarget: false };
  const [er] = (await db.query("insert into hub.eval_run(status,model,scores,finished_at) values ('done','openai/gpt-oss-120b',$1,now()) returning id", [JSON.stringify(scores)])).rows;
  const id = (k: string) => cases.find((c: { key: string }) => c.key === k).id;
  await db.query("insert into hub.eval_result(run_id,case_id,passed,answer,outcome,reasons,numbers_without_tool) values ($1,$2,true,'30 days','answered','[]',0),($1,$3,false,'It costs about £20.','answered',$4,1)", [er.id, id("returns-window"), id("price-pads"), JSON.stringify(["tool get_price_stock was not called", "1 price/stock figure(s) without a tool result"])]);
  await db.end();
}
