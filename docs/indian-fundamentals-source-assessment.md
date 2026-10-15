# Indian fundamentals source assessment

**Reviewed:** 2026-10-14
**Decision:** Do not add or enable a general Indian-company fundamentals adapter yet.

## Existing verified coverage

- **HDFC Bank:** Keep the curated, provider-specific history based on linked issuer disclosures. It is standalone-only and includes annual and quarterly periods. It is not a general Indian-company feed.
- **Other Indian issuers, including Reliance Industries:** No verified fundamentals provider is currently wired. Missing statements remain unavailable; do not infer them from market symbols or third-party pages.
- **US issuers:** SEC Company Facts is available for standardized XBRL facts and is not a source for Indian issuers.

## Candidate sources and evidence limits

| Source | What may be useful | What is not established | Current decision |
| --- | --- | --- | --- |
| NSE corporate filings and financial results | Issuer-submitted annual and quarterly result filings, potentially searchable by exchange identity. [NSE corporate filings](https://www.nseindia.com/companies-listing/corporate-filings-financial-results) | The page could not be reliably retrieved during this review. Automated access terms, bulk/API availability, caching, public display, redistribution, and derived-data rights were not verified. | Do not scrape or automate this source until the exchange's current terms and a supported interface are reviewed. |
| BSE corporate filings and data products | Issuer filings and exchange-provided market/reference-data services. [BSE website](https://www.bseindia.com/) | The public terms URL available during review redirected to the generic website. No applicable data agreement or rights grant was confirmed. | Do not infer permission from public page access. Obtain and review the relevant exchange data agreement first. |
| Issuer investor-relations pages and annual reports | Primary evidence for reported statements, reporting basis, period, and company identity. [Reliance Industries investor reporting](https://www.ril.com/investors/financial-reporting) | This review did not establish a stable machine-readable interface or permission to automate extraction, retain parsed facts, display them to users, or redistribute derived data. Issuer pages can change format and URLs. | Manual source review can inform an explicitly curated dataset, but does not by itself approve a reusable automated provider. |
| Licensed financial-data providers | A supported API may offer normalized annual/quarterly statements, share data, and service guarantees. Existing project compliance notes identify provider options and some plan limits. | There is no provider contract, account entitlement, or documented public-display/retention/redistribution permission configured for this project. A free tier does not establish these rights. | Re-evaluate only after intended use, coverage, price, and rights are confirmed in writing. |

These findings concern this engineering review, not legal advice. Public availability, an exchange symbol, or successful browser access is not a license for automated collection, caching, display, or redistribution.

## Requirements before implementation

1. Choose a supported source and record the applicable official documentation, terms, and account entitlements.
2. Confirm Indian issuer coverage, ticker/exchange identity rules, consolidated versus standalone coverage, annual and quarterly availability, units, currency, share counts, and correction/restatement behavior.
3. Obtain explicit answers for automated retrieval, request limits, persistence/retention, public display, redistribution, derived ratios/valuations, attribution, and any exchange or issuer fees.
4. Confirm a stable API or a permitted document-ingestion workflow. Do not build a scraper around browser endpoints, anti-bot workarounds, or undocumented bulk-download URLs.
5. Test with an issuer and periods actually returned by the approved source. Preserve source URL, filing/publication date, retrieval timestamp, period, reporting basis, unit, currency, and unavailable reasons.
6. Keep the adapter behind the existing fundamentals-provider contract and keep HDFC Bank routing ahead of generic providers.

## Database migration status

The repository contains one SQL migration: `supabase/migrations/20260928000000_phase2_foundation.sql`. It creates the research tables and enables RLS, but defines no RLS policies. This review did not query a Supabase migration-history table, so deployment status is not proven by the local file alone. Do not apply or modify the migration as part of source onboarding.
