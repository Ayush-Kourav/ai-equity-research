import type { Company } from "../types/financial.ts";
import type { FundamentalsHistory } from "../types/fundamentals.ts";
import { getIndiaMarketStatus } from "../market-data/india-market-status.ts";

function countryCodeFor(
  exchange: string,
  sourceMode: FundamentalsHistory["sourceMode"],
): string | null {
  const normalizedExchange = exchange.trim().toLocaleUpperCase("en-US");
  if (normalizedExchange === "NSE" || normalizedExchange === "BSE") {
    return "IN";
  }
  if (
    sourceMode === "SEC_COMPANYFACTS" ||
    ["NASDAQ", "NASDAQ GLOBAL SELECT", "NYSE", "NYSE AMERICAN", "AMEX", "OTC"].includes(
      normalizedExchange,
    )
  ) {
    return "US";
  }
  return null;
}

function currencyFor(history: FundamentalsHistory): string | null {
  const observedCurrencies = new Set(
    history.financials.flatMap((metric) =>
      metric.status !== "unavailable" && metric.provenance.currency
        ? [metric.provenance.currency]
        : [],
    ),
  );
  const reportedCurrency = history.company.currency
    ?.trim()
    .toLocaleUpperCase("en-US");
  if (reportedCurrency) {
    observedCurrencies.add(reportedCurrency);
  }
  if (observedCurrencies.size !== 1) {
    return null;
  }
  return observedCurrencies.values().next().value ?? null;
}

export function buildCompanyWithoutMarketData(
  history: FundamentalsHistory,
): Company | null {
  const source = history.provenance[0];
  const retrievedAt =
    source?.retrievedAt ??
    history.financials.find((metric) => metric.status !== "unavailable")
      ?.provenance.retrievedAt;
  const currency = currencyFor(history);
  const countryCode = countryCodeFor(
    history.company.exchange,
    history.sourceMode,
  );
  if (!source || !retrievedAt || !currency || !countryCode) {
    return null;
  }

  return {
    id: `fundamentals:${history.company.ticker}`,
    ticker: history.company.ticker,
    exchange: history.company.exchange,
    name: history.company.companyName,
    countryCode,
    currency,
    sector: null,
    industry: null,
    marketCap: null,
    isActive: true,
    provider: "unavailable",
    instrument: history.company.ticker,
    asOf: null,
    marketTimestamp: null,
    dataStatus: "UNAVAILABLE",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus:
      countryCode === "IN"
        ? getIndiaMarketStatus(new Date(retrievedAt)).status
        : "UNKNOWN",
    isUnofficial: false,
    licenseStatus: "UNKNOWN",
    source: source.source,
    sourceType: "official_filing",
    sourceUrl: source.sourceUrl,
    retrievedAt,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  };
}
