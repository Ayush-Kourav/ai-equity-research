import assert from "node:assert/strict";
import test from "node:test";
import { buildEquityAnalysisPrompt } from "../lib/ai/prompts/equity-analysis.ts";
import { buildFundamentalsAnalysis } from "../lib/calculations/fundamentals-analysis.ts";
import { HdfcBankFundamentalsProvider } from "../lib/providers/hdfc-bank-fundamentals-provider.ts";
import { buildCompanyWithoutMarketData } from "../lib/services/fundamentals-company.ts";
import { buildResearchContext } from "../lib/services/research-context.ts";
import type { Company, MarketPrice } from "../lib/types/financial.ts";
import type {
  FundamentalMetric,
  FundamentalsHistory,
} from "../lib/types/fundamentals.ts";

const company: Company = {
  id: "test:hdfcbank",
  ticker: "HDFCBANK.NS",
  exchange: "NSE",
  name: "HDFC Bank Limited",
  countryCode: "IN",
  currency: "INR",
  sector: null,
  industry: null,
  marketCap: null,
  isActive: true,
  provider: "unavailable",
  instrument: "HDFCBANK.NS",
  asOf: null,
  marketTimestamp: null,
  dataStatus: "UNAVAILABLE",
  delaySeconds: null,
  delayStatus: "UNKNOWN",
  marketStatus: "UNKNOWN",
  isUnofficial: false,
  licenseStatus: "UNKNOWN",
  source: "Official company filing",
  sourceType: "official_filing",
  sourceUrl: "https://example.invalid/source",
  retrievedAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function makePrice(index: number): MarketPrice {
  const date = new Date(Date.UTC(2026, 0, index + 1))
    .toISOString()
    .slice(0, 10);
  return {
    id: `price-${index}`,
    companyId: company.id,
    date,
    asOf: `${date}T10:00:00.000Z`,
    marketTimestamp: `${date}T10:00:00.000Z`,
    instrument: company.instrument,
    exchange: "NSE",
    currency: "INR",
    open: null,
    high: null,
    low: null,
    close: 100 + index,
    adjustedClose: null,
    volume: null,
    source: "FYERS API",
    sourceType: "public_api",
    sourceUrl: "https://example.invalid/market",
    retrievedAt: "2026-10-01T00:00:00.000Z",
    provider: "fyers",
    dataStatus: "UNKNOWN",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus: "UNKNOWN",
    isUnofficial: false,
    licenseStatus: "REQUIRES_REVIEW",
  };
}

function makeSecMetric(
  id: string,
  value: number | null,
  status: "reported" | "unavailable",
): FundamentalMetric {
  const period = {
    id: "fy2025",
    periodType: "annual" as const,
    periodStart: "2024-07-01",
    periodEnd: "2025-06-30",
    label: "FY 2025",
  };
  const provenance = {
    sourceId: "sec-msft-2025",
    source: "SEC EDGAR XBRL company facts",
    sourceType: "official_company_filing" as const,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/",
    period,
    publicationDate: "2025-07-30",
    unit: id === "dilutedShares" ? "BILLION_SHARES" as const : "USD_BILLION" as const,
    currency: id === "dilutedShares" ? null : "USD",
    retrievedAt: "2026-10-01T00:00:00.000Z",
    pageReference: "SEC XBRL facts",
    sectionReference: id,
    reportingBasis: "consolidated" as const,
  };
  if (status === "unavailable") {
    if (value !== null) {
      throw new Error("Unavailable SEC test metrics must be null.");
    }
    return {
      id,
      periodId: period.id,
      value: null,
      status,
      provenance,
      reason: `No annual ${id} observation was reported.`,
    };
  }
  if (value === null) {
    throw new Error("Reported SEC test metrics require a value.");
  }
  return {
    id,
    periodId: period.id,
    value,
    status,
    provenance,
  };
}

test("builds compact AI context without sending duplicated dashboard payloads", async () => {
  const history = await new HdfcBankFundamentalsProvider().getFundamentals(
    "HDFCBANK.NS",
  );
  assert.ok(history);
  const fundamentals = buildFundamentalsAnalysis(history, null);
  const context = buildResearchContext(
    company,
    null,
    Array.from({ length: 30 }, (_, index) => makePrice(index)),
    fundamentals,
    "Market data is unavailable.",
  );
  const prompt = buildEquityAnalysisPrompt(context);
  const promptData = JSON.parse(prompt) as {
    suppliedData: Record<string, unknown>;
  };
  const suppliedData = promptData.suppliedData;
  const suppliedFundamentals = suppliedData.fundamentals as {
    periods: unknown[];
    metrics: Array<{ id: string; status: string }>;
  };
  const allowedMetrics = new Set([
    "revenue",
    "ebit",
    "depreciation",
    "depreciationExpense",
    "amortizationExpense",
    "interestExpense",
    "profitBeforeTax",
    "incomeTaxExpense",
    "netIncome",
    "operatingCashFlow",
    "capex",
    "cash",
    "shortTermDebt",
    "longTermDebt",
    "debt",
    "equity",
    "dilutedShares",
    "sharesOutstanding",
    "workingCapital",
    "changeInWorkingCapital",
    "accountsReceivable",
    "inventory",
    "accountsPayable",
    "otherCurrentAssets",
    "otherCurrentLiabilities",
    "profitAfterTax",
    "netInterestIncome",
    "totalDeposits",
    "grossAdvances",
    "roa",
    "roe",
    "grossNpaRatio",
    "netNpaRatio",
    "casaRatio",
    "capitalAdequacyRatio",
    "cet1Ratio",
    "basicEps",
    "profitAfterTaxGrowthYoY",
    "netInterestIncomeGrowthYoY",
    "depositGrowthYoY",
    "grossAdvancesGrowthYoY",
  ]);

  assert.equal(suppliedFundamentals.periods.length, 6);
  assert.ok(
    suppliedFundamentals.metrics.every((metric) =>
      allowedMetrics.has(metric.id),
    ),
  );
  assert.ok(
    suppliedFundamentals.metrics.some((metric) => metric.status === "reported"),
  );
  assert.ok(
    suppliedFundamentals.metrics.some(
      (metric) => metric.status === "calculated",
    ),
  );
  const calculatedMetric = suppliedFundamentals.metrics.find(
    (metric) => metric.status === "calculated",
  );
  assert.ok(calculatedMetric);
  assert.ok("formula" in calculatedMetric && calculatedMetric.formula);
  assert.ok(
    "inputs" in calculatedMetric &&
      Array.isArray(calculatedMetric.inputs) &&
      calculatedMetric.inputs.length > 0,
  );
  assert.ok(
    suppliedFundamentals.metrics.some(
      (metric) => metric.status === "unavailable",
    ),
  );
  assert.equal(
    (suppliedData.priceHistory as { samples: unknown[] }).samples.length,
    5,
  );
  assert.equal("financialSnapshot" in suppliedFundamentals, false);
  assert.equal("valuationInputs" in suppliedFundamentals, false);
  assert.equal(prompt.includes('"sourceUrl"'), false);
  assert.equal("unavailableData" in promptData, false);
  assert.ok(
    prompt.length < 25_000,
    `AI context should stay bounded: ${prompt.length} characters`,
  );
});

test("supplies sourced SEC operating-company financials and unavailable reasons to Gemini", () => {
  const period = {
    id: "fy2025",
    periodType: "annual" as const,
    periodStart: "2024-07-01",
    periodEnd: "2025-06-30",
    label: "FY 2025",
    reportingBasis: "consolidated" as const,
  };
  const source = {
    id: "sec-msft-2025",
    source: "SEC EDGAR Form 10-K XBRL filing",
    sourceType: "official_company_filing" as const,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/",
    publicationDate: "2025-07-30",
    retrievedAt: "2026-10-01T00:00:00.000Z",
    reportingBasis: "consolidated" as const,
  };
  const history: FundamentalsHistory = {
    company: {
      ticker: "MSFT",
      companyName: "Microsoft Corporation",
      exchange: "NASDAQ",
      companyType: "GENERAL_COMPANY",
      reportingBasis: "consolidated",
      currency: "USD",
    },
    periods: [period],
    financials: [
      makeSecMetric("revenue", 281.7, "reported"),
      makeSecMetric("ebit", 128.5, "reported"),
      makeSecMetric("netIncome", 101.8, "reported"),
      makeSecMetric("cash", 94.6, "reported"),
      makeSecMetric("debt", 78.4, "reported"),
      makeSecMetric("dilutedShares", 7.5, "reported"),
      makeSecMetric("operatingCashFlow", 136.2, "reported"),
      makeSecMetric("changeInWorkingCapital", null, "unavailable"),
    ],
    bankMetrics: [],
    growthMetrics: [],
    provenance: [source],
    sourceMode: "SEC_COMPANYFACTS",
    warnings: ["Only standardized SEC XBRL facts are included."],
  };
  const fundamentals = buildFundamentalsAnalysis(history);
  const context = buildResearchContext(
    { ...company, ticker: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", countryCode: "US", currency: "USD" },
    null,
    [],
    fundamentals,
    "Market data is unavailable.",
  );
  const promptData = JSON.parse(buildEquityAnalysisPrompt(context)) as {
    suppliedData: {
      fundamentals: {
        ticker: string;
        reportingBasis: string;
        periods: Array<{ periodEnd: string; reportingBasis: string }>;
        metrics: Array<{
          id: string;
          status: string;
          value?: number;
          unit?: string;
          currency?: string | null;
          sourceId?: string | null;
          reason?: string;
        }>;
        sources: Array<{ id: string; source: string }>;
      };
    };
  };
  const supplied = promptData.suppliedData.fundamentals;
  const metric = (id: string) => supplied.metrics.find((item) => item.id === id);

  assert.equal(supplied.ticker, "MSFT");
  assert.equal(supplied.reportingBasis, "consolidated");
  assert.equal(supplied.periods[0]?.periodEnd, "2025-06-30");
  assert.equal(supplied.periods[0]?.reportingBasis, "consolidated");
  assert.equal(metric("revenue")?.value, 281.7);
  assert.equal(metric("revenue")?.unit, "USD_BILLION");
  assert.equal(metric("revenue")?.currency, "USD");
  assert.equal(metric("revenue")?.sourceId, "sec-msft-2025");
  assert.equal(metric("changeInWorkingCapital")?.status, "unavailable");
  assert.match(metric("changeInWorkingCapital")?.reason ?? "", /No annual/);
  assert.deepEqual(supplied.sources, [
    {
      id: "sec-msft-2025",
    source: "SEC EDGAR XBRL company facts",
      publicationDate: "2025-07-30",
      retrievedAt: "2026-10-01T00:00:00.000Z",
      reportingBasis: "consolidated",
    },
  ]);
});

test("fundamentals-only company identity preserves SEC currency and US market status", () => {
  const history: FundamentalsHistory = {
    company: {
      ticker: "MSFT",
      companyName: "Microsoft Corporation",
      exchange: "NASDAQ",
      companyType: "GENERAL_COMPANY",
      reportingBasis: "consolidated",
      currency: "USD",
    },
    periods: [],
    financials: [],
    bankMetrics: [],
    growthMetrics: [],
    provenance: [
      {
        id: "sec-msft",
        source: "SEC EDGAR Form 10-K/20-F XBRL filing",
        sourceType: "official_company_filing",
        sourceUrl: "https://www.sec.gov/Archives/edgar/data/",
        publicationDate: "2026-07-01",
        retrievedAt: "2026-10-01T00:00:00.000Z",
        reportingBasis: "consolidated",
      },
    ],
    sourceMode: "SEC_COMPANYFACTS",
    warnings: [],
  };

  const company = buildCompanyWithoutMarketData(history);
  assert.ok(company);
  assert.equal(company.ticker, "MSFT");
  assert.equal(company.countryCode, "US");
  assert.equal(company.currency, "USD");
  assert.equal(company.exchange, "NASDAQ");
  assert.equal(company.dataStatus, "UNAVAILABLE");
  assert.equal(company.marketStatus, "UNKNOWN");
});

test("fundamentals-only company identity derives Indian currency from metric provenance", async () => {
  const history = await new HdfcBankFundamentalsProvider().getFundamentals(
    "HDFCBANK.NS",
  );
  assert.ok(history);
  const company = buildCompanyWithoutMarketData(history);
  assert.ok(company);
  assert.equal(company.ticker, "HDFCBANK.NS");
  assert.equal(company.countryCode, "IN");
  assert.equal(company.currency, "INR");
  assert.equal(company.exchange, "NSE");
});

test("fundamentals-only company identity is unavailable when currency conflicts", async () => {
  const sourceHistory = await new HdfcBankFundamentalsProvider().getFundamentals(
    "HDFCBANK.NS",
  );
  assert.ok(sourceHistory);
  const history: FundamentalsHistory = {
    ...sourceHistory,
    company: { ...sourceHistory.company, currency: "USD" },
  };
  assert.equal(buildCompanyWithoutMarketData(history), null);
});
