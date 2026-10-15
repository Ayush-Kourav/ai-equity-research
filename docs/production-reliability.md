# Production reliability runbook

## Gemini AI analysis

`GET /api/ai/analyze` confirms only that a server-side key is present; it is not a live provider health check. `POST /api/ai/analyze` is the live test and returns a structured failure category without returning raw Google errors.

| API category | Meaning | Operator check |
| --- | --- | --- |
| `GEMINI_NOT_CONFIGURED` | No server key is set. | Configure `GEMINI_API_KEY` in the server environment and restart/redeploy. |
| `GEMINI_AUTHENTICATION_FAILED` | Google rejected the key. | Confirm the key belongs to the intended Google AI Studio project; never paste it into logs or chat. |
| `GEMINI_PERMISSION_DENIED` | The key/project cannot access the API. | Review project/API enablement and key restrictions. |
| `GEMINI_QUOTA_EXCEEDED` / `GEMINI_RATE_LIMITED` | Billing/quota or request-rate restriction. | Check the project quota and wait for applicable resets; do not add automatic model fallbacks. |
| `GEMINI_UNSUPPORTED_MODEL` / `GEMINI_INVALID_REQUEST` | The selected model or request configuration is rejected. | Compare `GEMINI_MODEL` and generation settings with current official model/API documentation. |
| `GEMINI_TIMEOUT` / `GEMINI_NETWORK_ERROR` | The request timed out or the server could not connect. | Check server outbound DNS/network and provider latency. |
| `GEMINI_UNAVAILABLE` | Google returned a transient/provider-side failure or an unclassified SDK error. | Retry later and inspect only the sanitized server category, HTTP status, and allow-listed provider code. |
| `GEMINI_INVALID_RESPONSE` | The returned content did not satisfy the application schema. | Review schema compatibility; never replace it with synthetic analysis. |

The route's in-process throttle is a local safeguard only, not deployment-grade abuse prevention. Send public, non-confidential company information only, consistent with the current Google terms and the project's data-source policy.

## Supabase database health

`GET /api/system/database` uses a server-only privileged client for a bounded read of `companies`. It tests endpoint access and table presence; it does not test anonymous-user RLS behavior or write access. It does not change RLS.

| Health code | Meaning | Operator check |
| --- | --- | --- |
| `not_configured` | Required server settings are absent. | Configure the project URL and server-only secret key in the deployment environment. |
| `invalid_configuration` | The project URL is not a valid HTTP(S) URL. | Compare the deployment URL with the project's API URL in the Supabase dashboard. |
| `upstream_unavailable` | Network/DNS, timeout, rate limit, or Supabase 5xx prevented the probe. | From the deployed server, verify DNS and outbound HTTPS to the configured project; confirm the project is not paused and the URL is current. Do not disclose the URL or key in support output. |
| `access_denied` | The credential or database grants rejected the read. | Verify that the server-only key is the intended project credential and has the expected server-side access. Keep RLS enabled. |
| `migration_not_applied` | `companies` is missing from the API schema/database. | Compare the remote migration history with `supabase/migrations/20260928000000_phase2_foundation.sql`. Review that migration and its RLS design before applying it through the project's normal migration process. |
| `query_failed` | The failure did not match a known category. | Use sanitized logs' error category, status, and diagnostic field names; never log raw errors, request headers, or credentials. |

The repository has one migration file, but its presence does not establish whether it was applied remotely. That migration enables RLS on its tables and defines no policies. Do not add public grants or disable RLS to make health checks pass. The privileged health read is not a substitute for a separate least-privilege policy review and database policy tests.

## Verification record (2026-10-15)

The rebuilt production application passed the local test, lint, type-check, and build commands. The smoke-test outcomes were:

| Check | Result |
| --- | --- |
| Dashboard | HTTP 200 |
| MSFT company search | HTTP 200; the provider's market-data license gate remains in effect. |
| MSFT fundamentals | HTTP 200; SEC-sourced USD, consolidated statements, six annual periods. |
| HDFC Bank fundamentals | HTTP 200; issuer-sourced INR, standalone statements, six periods (annual and quarterly). |
| Reliance fundamentals | HTTP 404, `fundamentals_not_supported`; no substitute data was returned. |
| MSFT valuation | HTTP 200; USD-denominated DCF remains unavailable until required WACC assumptions are supplied. |
| HDFC Bank valuation | HTTP 200; bank classification prevents applying standard industrial FCFF. |
| Gemini configuration (`GET /api/ai/analyze`) | HTTP 200, configured. This checks key presence only. |
| Gemini analysis (`POST /api/ai/analyze`) | Latest request HTTP 503, `gemini_quota_exceeded` / `GEMINI_QUOTA_EXCEEDED`. Earlier requests included a successful structured response and failures classified as provider-unavailable or invalid-response; live availability is therefore not reliable. |
| Supabase health | HTTP 503, `upstream_unavailable`. A local DNS probe of the configured project endpoint failed with `ENOTFOUND`; this does not distinguish an incorrect project URL from an environment DNS problem. |

Gemini's latest failure is evidence of an exhausted provider quota or billing limit, not proof that earlier `invalid_response` and generic `unavailable` failures had the same cause. The original upstream response was intentionally not retained, so those earlier causes remain unverified. Review Google AI Studio quota/billing for the configured project and retry after resolving the limit; do not add a fabricated or automatic fallback.

No remote Supabase migration-history query was possible. The local migration's presence does not prove it was applied remotely. Verify the project URL and DNS from the deployment environment first; then check the remote migration history and database access without weakening RLS or applying an unreviewed schema change.
