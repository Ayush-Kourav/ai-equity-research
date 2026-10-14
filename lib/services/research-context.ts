import type {
  Company,
  CompanyMarketSnapshot,
  MarketPrice,
} from "@/lib/types/financial";
import type {
  FundamentalMetric,
  FundamentalsAnalysis,
} from "@/lib/types/fundamentals";
import type {
  ResearchContext,
  ResearchMetricContext,
} from "@/lib/types/research";

const AI_NON_FINANCIAL_METRIC_IDS = new Set([
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
]);

const AI_FINANCIAL_INSTITUTION_METRIC_IDS = new Set([
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

const MAX_PRICE_SAMPLES = 5;

function samplePriceHistory(
  prices: MarketPrice[],
): Array<{ date: string; close: number }> {
  if (prices.length <= MAX_PRICE_SAMPLES) {
    return prices.map(({ date, close }) => ({ date, close }));
  }

  return Array.from({ length: MAX_PRICE_SAMPLES }, (_, index) => {
    const sampleIndex = Math.round(
      (index * (prices.length - 1)) / (MAX_PRICE_SAMPLES - 1),
    );
    const price = prices[sampleIndex];
    if (!price) {
      throw new Error("Unable to sample market-price history.");
    }
    return { date: price.date, close: price.close };
  });
}

function compactMetric(metric: FundamentalMetric): ResearchMetricContext {
  const provenance = metric.provenance;
  if (metric.status === "unavailable") {
    return {
      id: metric.id,
      periodId: metric.periodId,
      status: "unavailable",
      reason: metric.reason,
    };
  }

  const sourceId = provenance.sourceId;
  const common = {
    id: metric.id,
    periodId: metric.periodId,
    value: metric.value,
    unit: provenance.unit,
    currency: provenance.currency,
    sourceId,
  };
  return metric.status === "calculated"
    ? {
        ...common,
        status: "calculated",
        formula: metric.formula,
        inputs: metric.inputs.map((input) => ({
          id: input.id,
          periodId: input.periodId,
          value: input.value,
          unit: input.provenance.unit,
        })),
      }
    : { ...common, status: "reported" };
}

function compactFundamentals(
  fundamentals: FundamentalsAnalysis | null,
): ResearchContext["fundamentals"] {
  if (!fundamentals) {
    return null;
  }

  const selectedMetrics = [
    ...fundamentals.financials,
    ...fundamentals.bankMetrics,
    ...fundamentals.growthMetrics,
  ].filter((metric) =>
    (fundamentals.companyType === "FINANCIAL_INSTITUTION"
      ? AI_FINANCIAL_INSTITUTION_METRIC_IDS
      : AI_NON_FINANCIAL_METRIC_IDS
    ).has(metric.id),
  );
  const seen = new Set<string>();
  const metrics = selectedMetrics.filter((metric) => {
    const key = `${metric.periodId}:${metric.id}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate AI research metric: ${key}`);
    }
    seen.add(key);
    return true;
  });
  const sourceMap = new Map<
    string,
    NonNullable<ResearchContext["fundamentals"]>["sources"][number]
  >();
  for (const metric of metrics) {
    if (metric.status === "unavailable") {
      continue;
    }
    const provenance = metric.provenance;
    if (provenance.sourceId && !sourceMap.has(provenance.sourceId)) {
      sourceMap.set(provenance.sourceId, {
        id: provenance.sourceId,
        source: provenance.source,
        publicationDate: provenance.publicationDate,
        retrievedAt: provenance.retrievedAt,
        reportingBasis: provenance.reportingBasis,
      });
    }
  }

  const compactMetrics = metrics.map(compactMetric);

  return {
    ticker: fundamentals.company.ticker,
    companyType: fundamentals.companyType,
    reportingBasis: fundamentals.company.reportingBasis,
    dataStatus: fundamentals.dataStatus,
    periods: fundamentals.periods.map((period) => ({
      id: period.id,
      label: period.label,
      periodType: period.periodType,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      reportingBasis: period.reportingBasis,
    })),
    metrics: compactMetrics,
    sources: [...sourceMap.values()],
    warnings: fundamentals.warnings,
    limitations: fundamentals.dataQuality.limitations,
  };
}

export function buildResearchContext(
  company: Company,
  snapshot: CompanyMarketSnapshot | null,
  historicalPrices: MarketPrice[],
  fundamentals: FundamentalsAnalysis | null,
  marketUnavailableReason: string,
): ResearchContext {
  const firstPrice = historicalPrices[0];
  const latestPrice = historicalPrices.at(-1);

  return {
    schemaVersion: "2.0",
    company: {
      ticker: company.ticker,
      name: company.name,
      exchange: company.exchange,
      countryCode: company.countryCode,
      currency: company.currency,
      sector: company.sector,
      industry: company.industry,
    },
    market: snapshot
      ? {
          quote: {
            ticker: snapshot.quote.ticker,
            price: snapshot.quote.price,
            change: snapshot.quote.change,
            changePercent: snapshot.quote.changePercent,
            currency: snapshot.quote.currency,
            marketTimestamp: snapshot.quote.marketTimestamp,
            dataStatus: snapshot.quote.dataStatus,
            delayStatus: snapshot.quote.delayStatus,
            delaySeconds: snapshot.quote.delaySeconds,
          },
          provider: snapshot.quote.provider,
          source: snapshot.quote.source,
          sourceType: snapshot.quote.sourceType,
          retrievedAt: snapshot.quote.retrievedAt,
        }
      : null,
    priceHistory:
      firstPrice && latestPrice
        ? {
            samples: samplePriceHistory(historicalPrices),
            source: firstPrice.source,
            provider: firstPrice.provider,
            retrievedAt: latestPrice.retrievedAt,
            observationCount: historicalPrices.length,
          }
        : null,
    fundamentals: compactFundamentals(fundamentals),
    unavailableSections: {
      marketData: snapshot
        ? "Market quote supplied with provider provenance."
        : marketUnavailableReason,
      historicalPrices:
        historicalPrices.length > 0
          ? "A compact sample of sourced historical prices was supplied."
          : "No historical price observations were supplied.",
      filings: "Company filings ingestion is not connected.",
      earnings: "Earnings data is not connected.",
      news: "Financial news ingestion is not connected.",
      risks: "No deterministic risk engine is implemented.",
      catalysts: "Catalysts are not derived from a connected sourced dataset.",
      valuation:
        "A verified bank-appropriate DCF model and assumptions are unavailable.",
    },
  };
}
