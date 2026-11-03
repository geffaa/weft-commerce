# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
TypeScript: Medusa v2 (store core), Next.js (storefront and operations console), NestJS (integration hub), PostgreSQL with pgvector, Redis. Chosen on 2026-11-03 from market research, not from the author's existing Laravel work. Details in docs/TECH-SPEC.md.

## Users
- Operators and finance staff (assumed) at small and mid-size brands that sell on more than one channel: they check stock and orders across systems each morning and evening on desktop, and turn paid orders into invoices.
- Support staff (assumed) who receive hand-offs from the assistant and review its answers.
- Shoppers in the US, UK, EU and Australia (assumed target), mostly on phones, paying in their own currency and asking questions before buying.
- Client developers who install and extend it.
- Buyer of the portfolio: global Upwork clients hiring for headless commerce, Shopify and Xero integration, or RAG assistants.

## Product Purpose
A configurable commerce layer: a headless store, an integration hub that keeps stock and orders correct across the store and Shopify and pushes paid orders to Xero, and a retrieval-based shopping assistant whose answers are checked against live data. Portfolio product (project 7), demonstrated entirely on sandbox accounts with synthetic data.

## Positioning
One trustworthy ledger of orders and stock, installed by a developer rather than rented per month, with an assistant that is measured and cannot invent a price or promise.

## Operating Context
Orders arrive from the store checkout (Stripe) and from Shopify webhooks. Every outgoing action passes through a transactional outbox with retries; failures land in an exceptions queue with a readable cause. A nightly job compares stock per channel and orders against Xero and reports differences. The assistant answers from the catalog and policy documents, looks up orders with number and email, and hands over to a person when unsure.

## Capabilities and Constraints
- MVP: markets and multi-currency, storefront, Shopify import and stock sync, unified order ledger, Xero invoices, outbox and exceptions, reconciliation, operations console, assistant with evaluation harness, roles and audit.
- Later: WooCommerce, QuickBooks, returns, Stripe Tax, multi-language, semantic search, AI product copy, outbound webhooks. Much later: Amazon, Etsy, TikTok Shop, Tokopedia, Shopee, B2B, marketplace, multi-tenant.
- Unverified and flagged in the docs: Shopify API rate limits and mutation names, Xero tiers and limits, Stripe fees, EU AI Act chatbot disclosure date, accessibility and PCI scope.
- Works with free accounts only: Shopify development store, Stripe test mode, Xero demo company, a local WooCommerce.

## Evidence on Hand
None from real merchants. Brand, products, customers, orders and conversations are synthetic. No testimonials, customers or benchmarks exist; do not fabricate them. The only evidence will be produced by the project itself: test results and the assistant evaluation report.

## Product Principles
1. A number shown anywhere can be traced to its source.
2. Never write to a live account by accident: sandbox and live are always visible.
3. Failures are visible and fixable, never silent.
4. The assistant says what it knows from sources and tools, and otherwise hands over.
