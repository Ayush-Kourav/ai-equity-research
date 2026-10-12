import "server-only";

import type {
  Company,
  HistoricalPriceRange,
  MarketIndicator,
  MarketPrice,
  MarketQuote,
} from "@/lib/types/financial";
import type { MarketDataProvider } from "@/lib/providers/market-data-provider";
import { MarketDataError } from "@/lib/providers/market-data-error";
import { getIndiaMarketStatus } from "../market-data/india-market-status";
import {
  parseYahooHistoricalRows,
  validateYahooQuote,
} from "../market-data/yahoo-validation";

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com";
const YAHOO_SOURCE = "Yahoo Finance (unofficial public endpoints)";

const supportedCompanies: { symbol: string; aliases: string[] }[] = [
  { symbol: "HDFCBANK.NS", aliases: ["HDFCBANK", "HDFC BANK", "HDFC BANK LIMITED"] },
  { symbol: "ICICIBANK.NS", aliases: ["ICICIBANK", "ICICI BANK", "ICICI BANK LIMITED"] },
  { symbol: "SBIN.NS", aliases: ["SBIN", "SBI", "STATE BANK OF INDIA"] },
  { symbol: "RELIANCE.NS", aliases: ["RELIANCE", "RELIANCE INDUSTRIES"] },
  { symbol: "TCS.NS", aliases: ["TCS", "TATA CONSULTANCY SERVICES"] },
  { symbol: "INFY.NS", aliases: ["INFY", "INFOSYS"] },
];

const marketSymbols = [
  { symbol: "^NSEI", label: "NIFTY 50" },
  { symbol: "^BSESN", label: "SENSEX" },
  { symbol: "^NSEBANK", label: "NIFTY BANK" },
  { symbol: "^INDIAVIX", label: "INDIA VIX" },
] as const;

const pendingRequests = new Map<string, Promise<unknown>>();
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function supportedCompany(identifier: string) {
  const normalized = identifier.trim().toLocaleUpperCase();

  return supportedCompanies.find(
    (entry) =>
      entry.symbol === normalized ||
      entry.symbol.replace(/\.NS$/, "") === normalized ||
      entry.aliases.includes(normalized),
  );
}

function cacheKey(providerKey: string, suffix: string): string {
  return `${providerKey}:${suffix}`;
}

async function singleFlight<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const pending = pendingRequests.get(key);

  if (pending) {
    return pending as Promise<T>;
  }

  const request = load()
    .finally(() => pendingRequests.delete(key));

  pendingRequests.set(key, request);
  return request;
}

function enqueueFetch(
  url: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const request = requestQueue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    nextRequestAt = Date.now() + 1000;

    try {
      return await fetcher(url, { signal: AbortSignal.timeout(8000) });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MarketDataError(
          "Market-data provider timed out.",
          "timeout",
        );
      }

      throw new MarketDataError(
        "Market-data provider could not be reached.",
        "upstream_error",
      );
    }
  });

  requestQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

async function getJson(
  url: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await enqueueFetch(url, fetcher);

  if (response.status === 429) {
    throw new MarketDataError(
      "Yahoo Finance rate-limited the request. Please retry later.",
      "rate_limited",
    );
  }

  if (!response.ok) {
    throw new MarketDataError(
      `Yahoo Finance returned HTTP ${response.status}.`,
      "upstream_error",
    );
  }

  try {
    return await response.json();
  } catch {
    throw new MarketDataError(
      "Yahoo Finance returned malformed JSON.",
      "malformed_response",
    );
  }
}

function sourceUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;
}

function companyFromSearchResult(
  quote: JsonRecord,
  symbol: string,
  retrievedAt: string,
): Company | null {
  if (quote.symbol !== symbol || quote.quoteType !== "EQUITY") {
    return null;
  }

  const name = text(quote.longname) ?? text(quote.shortname);
  const currency = text(quote.currency) ?? (symbol.endsWith(".NS") ? "INR" : null);

  if (!name || !currency) {
    throw new MarketDataError(
      `Yahoo Finance omitted required company metadata for ${symbol}.`,
      "malformed_response",
    );
  }

  const exchange = text(quote.fullExchangeName) ?? text(quote.exchange);

  if (exchange !== "NSE" && exchange !== "NSI") {
    return null;
  }

  return {
    id: `yahoo:${symbol}`,
    ticker: symbol,
    exchange: "NSE",
    name,
    countryCode: "IN",
    currency,
    instrument: symbol,
    asOf: null,
    marketTimestamp: null,
    provider: "yahoo",
    dataStatus: "UNKNOWN",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus: getIndiaMarketStatus(new Date(retrievedAt)).status,
    isUnofficial: true,
    licenseStatus: "UNKNOWN",
    sector: text(quote.sector),
    industry: text(quote.industry),
    marketCap: finiteNumber(quote.marketCap),
    isActive: true,
    source: YAHOO_SOURCE,
    sourceType: "unofficial",
    sourceUrl: sourceUrl(symbol),
    retrievedAt,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  };
}

function chartResult(payload: unknown, symbol: string): JsonRecord {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw new MarketDataError(
      "Yahoo Finance returned an invalid chart response.",
      "malformed_response",
    );
  }

  const chart = payload.chart;
  const results = chart.result;

  if (Array.isArray(results) && isRecord(results[0])) {
    return results[0];
  }

  const error = isRecord(chart.error) ? text(chart.error.description) : null;

  if (error) {
    throw new MarketDataError(
      `Yahoo Finance could not return data for ${symbol}.`,
      "not_found",
    );
  }

  throw new MarketDataError(
    `Yahoo Finance returned no chart data for ${symbol}.`,
    "not_found",
  );
}

function quoteFromChart(
  result: JsonRecord,
  companyId: string,
  symbol: string,
  expectedCurrency: string,
  retrievedAt: string,
): MarketQuote {
  if (!isRecord(result.meta)) {
    throw new MarketDataError(
      `Yahoo Finance omitted quote metadata for ${symbol}.`,
      "malformed_response",
    );
  }

  const meta = result.meta;
  const price = finiteNumber(meta.regularMarketPrice);
  const previousClose = finiteNumber(meta.chartPreviousClose);
  const timestamp = finiteNumber(meta.regularMarketTime);
  const currency = text(meta.currency);
  const exchange =
    text(meta.fullExchangeName) ?? text(meta.exchangeName) ?? "NSE";

  validateYahooQuote(
    {
      price,
      previousClose,
      timestamp,
      currency,
      open: meta.regularMarketOpen,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
    },
    symbol,
    expectedCurrency,
  );
  if (
    price === null ||
    previousClose === null ||
    timestamp === null ||
    !currency
  ) {
    throw new MarketDataError(
      `Yahoo Finance omitted required quote fields for ${symbol}.`,
      "malformed_response",
      "yahoo",
    );
  }

  const asOf = new Date(timestamp * 1000).toISOString();
  const change = price - previousClose;

  return {
    companyId,
    ticker: symbol,
    symbol,
    exchange,
    instrument: symbol,
    asOf,
    marketTimestamp: asOf,
    open: finiteNumber(meta.regularMarketOpen),
    high: finiteNumber(meta.regularMarketDayHigh),
    low: finiteNumber(meta.regularMarketDayLow),
    price,
    previousClose,
    change,
    changePercent: (change / previousClose) * 100,
    dayHigh: finiteNumber(meta.regularMarketDayHigh),
    dayLow: finiteNumber(meta.regularMarketDayLow),
    volume: finiteNumber(meta.regularMarketVolume),
    currency,
    source: YAHOO_SOURCE,
    sourceType: "unofficial",
    sourceUrl: sourceUrl(symbol),
    retrievedAt,
    provider: "yahoo",
    dataStatus: "UNKNOWN",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus: getIndiaMarketStatus(new Date(retrievedAt)).status,
    isUnofficial: true,
    licenseStatus: "UNKNOWN",
  };
}

export class YahooFinanceProvider implements MarketDataProvider {
  readonly id = "yahoo";
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async searchCompanies(query: string): Promise<Company[]> {
    const normalized = query.trim().toLocaleUpperCase();

    if (!normalized || normalized.length > 80) {
      throw new MarketDataError(
        "Search query must contain between 1 and 80 characters.",
        "invalid_symbol",
      );
    }

    const matches = supportedCompanies.filter(
      (entry) =>
        entry.symbol.includes(normalized) ||
        entry.symbol.replace(/\.NS$/, "").includes(normalized) ||
        entry.aliases.some((alias) => alias.includes(normalized)),
    );

    const companies: Company[] = [];

    for (const match of matches) {
      const company = await this.getCompany(match.symbol);

      if (company) {
        companies.push(company);
      }
    }

    return companies;
  }

  async getCompany(identifier: string): Promise<Company | null> {
    const supported = supportedCompany(identifier);

    if (!supported) {
      return null;
    }

    return singleFlight(
      cacheKey("company", supported.symbol),
      async () => {
        const url = new URL("/v1/finance/search", YAHOO_BASE_URL);
        url.searchParams.set("q", supported.symbol);
        url.searchParams.set("quotesCount", "10");
        url.searchParams.set("newsCount", "0");

        const payload = await getJson(url.toString(), this.fetcher);

        if (!isRecord(payload) || !Array.isArray(payload.quotes)) {
          throw new MarketDataError(
            "Yahoo Finance returned malformed company search data.",
            "malformed_response",
          );
        }

        const retrievedAt = new Date().toISOString();

        for (const item of payload.quotes) {
          if (isRecord(item)) {
            const company = companyFromSearchResult(
              item,
              supported.symbol,
              retrievedAt,
            );

            if (company) {
              return company;
            }
          }
        }

        return null;
      },
    );
  }

  async getQuote(company: Company): Promise<MarketQuote> {
    return singleFlight(
      cacheKey("quote", company.ticker),
      async () => {
        const url = new URL(
          `/v8/finance/chart/${encodeURIComponent(company.ticker)}`,
          YAHOO_BASE_URL,
        );
        url.searchParams.set("range", "5d");
        url.searchParams.set("interval", "1d");

        const result = chartResult(
          await getJson(url.toString(), this.fetcher),
          company.ticker,
        );
        return quoteFromChart(
          result,
          company.id,
          company.ticker,
          company.currency,
          new Date().toISOString(),
        );
      },
    );
  }

  async getQuotes(companies: Company[]): Promise<MarketQuote[]> {
    return Promise.all(companies.map((company) => this.getQuote(company)));
  }

  async getMarketOverview(): Promise<MarketIndicator[]> {
    return singleFlight(
      "market-overview",
      async () => {
        const indicators: MarketIndicator[] = [];

        for (const item of marketSymbols) {
          const url = new URL(
            `/v8/finance/chart/${encodeURIComponent(item.symbol)}`,
            YAHOO_BASE_URL,
          );
          url.searchParams.set("range", "5d");
          url.searchParams.set("interval", "1d");

          const retrievedAt = new Date().toISOString();
          const result = chartResult(
            await getJson(url.toString(), this.fetcher),
            item.symbol,
          );
          const quote = quoteFromChart(
            result,
            item.symbol,
            item.symbol,
            text(isRecord(result.meta) ? result.meta.currency : null) ?? "",
            retrievedAt,
          );

          indicators.push({
            symbol: item.symbol,
            label: item.label,
            value: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
            currency: quote.currency,
            asOf: quote.asOf,
            marketTimestamp: quote.marketTimestamp,
            instrument: item.symbol,
            exchange: quote.exchange,
            source: quote.source,
            sourceType: quote.sourceType,
            sourceUrl: quote.sourceUrl,
            retrievedAt,
            provider: "yahoo",
            dataStatus: "UNKNOWN",
            delaySeconds: null,
            delayStatus: "UNKNOWN",
            marketStatus: getIndiaMarketStatus(new Date(retrievedAt)).status,
            isUnofficial: true,
            licenseStatus: "UNKNOWN",
          });
        }

        return indicators;
      },
    );
  }

  async getHistoricalPrices(
    company: Company,
    range: HistoricalPriceRange,
  ): Promise<MarketPrice[]> {
    return singleFlight(
      cacheKey("history", `${company.ticker}:${range}`),
      async () => {
        const url = new URL(
          `/v8/finance/chart/${encodeURIComponent(company.ticker)}`,
          YAHOO_BASE_URL,
        );
        const providerRange = range === "1w" ? "5d" : range;
        url.searchParams.set("range", providerRange);
        url.searchParams.set("interval", "1d");

        const result = chartResult(
          await getJson(url.toString(), this.fetcher),
          company.ticker,
        );

        if (
          !Array.isArray(result.timestamp) ||
          !isRecord(result.meta) ||
          !isRecord(result.indicators) ||
          !Array.isArray(result.indicators.quote) ||
          !isRecord(result.indicators.quote[0])
        ) {
          throw new MarketDataError(
            `Yahoo Finance returned malformed historical prices for ${company.ticker}.`,
            "malformed_response",
          );
        }
        const timestamps = result.timestamp;
        const prices = result.indicators.quote[0];
        const adjustedClose =
          Array.isArray(result.indicators.adjclose) &&
          isRecord(result.indicators.adjclose[0]) &&
          Array.isArray(result.indicators.adjclose[0].adjclose)
            ? result.indicators.adjclose[0].adjclose
            : [];
        const retrievedAt = new Date().toISOString();
        const opens = Array.isArray(prices.open) ? prices.open : [];
        const highs = Array.isArray(prices.high) ? prices.high : [];
        const lows = Array.isArray(prices.low) ? prices.low : [];
        const closes = Array.isArray(prices.close) ? prices.close : [];
        const volumes = Array.isArray(prices.volume) ? prices.volume : [];

        return parseYahooHistoricalRows({
          timestamps,
          opens,
          highs,
          lows,
          closes,
          adjustedCloses: adjustedClose,
          volumes,
          symbol: company.ticker,
          currency: result.meta.currency,
          expectedCurrency: company.currency,
        }).map((row) => {
          const asOf = new Date(row.epoch * 1000).toISOString();
          return {
            id: `${company.ticker}:${asOf}`,
            companyId: company.id,
            date: asOf.slice(0, 10),
            asOf,
            marketTimestamp: asOf,
            instrument: company.ticker,
            exchange: company.exchange,
            currency: company.currency,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            adjustedClose: row.adjustedClose,
            volume: row.volume,
            source: YAHOO_SOURCE,
            sourceType: "unofficial",
            sourceUrl: sourceUrl(company.ticker),
            retrievedAt,
            provider: "yahoo",
            dataStatus: "EOD",
            delaySeconds: null,
            delayStatus: "NOT_APPLICABLE",
            marketStatus: "CLOSED",
            isUnofficial: true,
            licenseStatus: "UNKNOWN",
          };
        });
      },
    );
  }
}
