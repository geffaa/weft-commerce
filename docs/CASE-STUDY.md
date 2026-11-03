# Case study: keeping a store, Shopify and Xero honest, and an assistant that cannot invent a price

## The problem

A global merchant sells through more than one channel and keeps books in Xero. Three things quietly go wrong: stock drifts between channels, an order is invoiced twice or never, and a chat assistant states a price it made up. None of these fail loudly. They are found by an angry customer or an accountant.

Weft is the operations layer that makes each of them either impossible or visible. The demo store, Halden Moto Parts, sells motorcycle parts where "does it fit my bike?" matters as much as the price.

## What I built

A Medusa v2 store with a custom fitment module and a Next.js storefront; a NestJS hub (ledger, outbox, Shopify and Xero connections, reconciliation, roles); an operations console; and an AI assistant with a measured evaluation. About 130 hub tests run against a real Postgres, and the integrations were verified against a real Shopify dev store, the Xero Demo Company, Stripe test mode and a real model.

## Decisions that mattered

1. **A ledger and an outbox, not "update the number".** Stock is a sum of events with unique event ids, reserved under row locks. Outbound work is written in the same transaction as the change and drained by a worker with leases, backoff and dead-letter. Killing the worker mid-batch finishes every job exactly once.
2. **Make the failure state a feature.** An order that cannot be fulfilled, a rejected invoice, and a stock mismatch all land in a console page with a classified cause, a retry where retry is safe, and "needs a person" where it is not.
3. **Let code, not the model, decide when tools run.** The assistant classifies intent, then code calls the tool. Price and stock answers are templates over tool results, so there is no sentence for the model to get wrong. A guard in code rejects any unbacked price or stock figure.

## What testing against the real services found

Unit tests with fakes passed every time. The real services found three things they could not:

- **Shopify rejects an idempotency key reused with different parameters.** My key was per SKU, so the second stock push failed. Keys are now per job and quantity.
- **Xero stores the result per idempotency key, including failures.** After the operator fixed the cause and retried, the old key replayed the old failure, so the fix looked like it did not work. A fake that mimics this now fails the old scheme.
- **My first similarity threshold was a guess.** With real embeddings it let an out-of-scope question through and threw away two relevant passages. Calibrating on real scores, then moving to a gate on the top score, fixed both.

Mutation checks (breaking a guarantee on purpose) confirmed the tests could fail; one of them showed that a test I had written would have passed without the lock it claimed to test, so I gave the fake realistic latency.

## Results

The assistant's first live run scored 51/60 (85.0%). After general fixes it scored 59/60 on that set and 23/24 on a holdout written without looking at the failures. In every run, **zero** answers contained a price or stock figure that no tool backed. A deliberately poisoned document triggered no tool calls.

## What I would do next

Register Shopify webhooks through a tunnel, add multi-turn memory and multi-intent questions to the assistant, split tax in the Xero invoices, put the E2E suites that need Stripe keys into CI with secrets, and deploy a hosted demo.
