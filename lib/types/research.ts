import type { FundamentalMetric } from "@/lib/types/fundamentals";

interface ResearchMetricContextBase {
  id: string;
  periodId: string;
  status: FundamentalMetric["status"];
}

export type ResearchMetricContext =
  | (ResearchMetricContextBase & {
      status: "unavailable";
      reason: string;
    })
  | (ResearchMetricContextBase & {
      status: "reported";
      value: number;
      unit: string;
      currency: string | null;
      sourceId: string | null;
    })
  | (ResearchMetricContextBase & {
      status: "calculated";
      value: number;
      unit: string;
      currency: string | null;
      sourceId: string | null;
      formula: string;
      inputs: Array<{
        id: string;
        periodId: string;
        value: number;
        unit: string;
      }>;
    });

export interface ResearchContext {
  schemaVersion: "2.0";
  company: {
    ticker: string;
    name: string;
    exchange: string;
    countryCode: string;
    currency: string;
    sector: string | null;
    industry: string | null;
  };
  market: null | {
    quote: {
      ticker: string;
      price: number;
      change: number;
      changePercent: number;
      currency: string;
      marketTimestamp: string | null;
      dataStatus: string;
      delayStatus: string;
      delaySeconds: number | null;
    };
    provider: string;
    source: string;
    sourceType: string;
    retrievedAt: string;
  };
  priceHistory: null | {
    samples: Array<{ date: string; close: number }>;
    source: string;
    provider: string;
    retrievedAt: string;
    observationCount: number;
  };
  fundamentals: null | {
    ticker: string;
    companyType: string;
    reportingBasis: string;
    dataStatus: string;
    periods: Array<{
      id: string;
      label: string;
      periodType: string;
      periodStart: string | null;
      periodEnd: string;
      reportingBasis: string;
    }>;
    metrics: ResearchMetricContext[];
    sources: Array<{
      id: string;
      source: string;
      publicationDate: string;
      retrievedAt: string;
      reportingBasis: string;
    }>;
    warnings: string[];
    limitations: string[];
  };
  unavailableSections: {
    marketData: string;
    historicalPrices: string;
    filings: string;
    earnings: string;
    news: string;
    risks: string;
    catalysts: string;
    valuation: string;
  };
}
