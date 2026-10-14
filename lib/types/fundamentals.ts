import type {
  MarketDataLicenseStatus,
  MarketDataProviderId,
  MarketDataStatus,
} from "@/lib/types/financial";

export type FundamentalUnit =
  | "INR_CRORE"
  | "INR_BILLION"
  | "USD_MILLION"
  | "USD_BILLION"
  | "INR_PER_SHARE"
  | "USD_PER_SHARE"
  | "CURRENCY_PER_SHARE"
  | "CRORE_SHARES"
  | "BILLION_SHARES"
  | "PERCENT"
  | "YEARS";

export type FundamentalPeriodType = "quarterly" | "annual" | "instant";
export type FinancialPeriodType = Exclude<FundamentalPeriodType, "instant">;
export type ReportingBasis = "standalone" | "consolidated";
export type CompanyType = "GENERAL_COMPANY" | "FINANCIAL_INSTITUTION";
export type FundamentalSourceType =
  | "official_company_filing"
  | "calculated";

export interface FundamentalPeriod {
  id: string;
  periodType: FundamentalPeriodType;
  periodStart: string | null;
  periodEnd: string;
  label: string;
  comparisonGroup?: string;
}

export interface FundamentalsReportingPeriod extends FundamentalPeriod {
  periodType: FinancialPeriodType;
  reportingBasis: ReportingBasis;
}

export interface FundamentalSource {
  id: string;
  source: string;
  sourceType: "official_company_filing";
  sourceUrl: string;
  publicationDate: string;
  retrievedAt: string;
  reportingBasis: ReportingBasis;
}

export interface FundamentalProvenance {
  sourceId: string | null;
  source: string;
  sourceType: FundamentalSourceType;
  sourceUrl: string;
  period: FundamentalPeriod;
  publicationDate: string;
  unit: FundamentalUnit;
  currency: string | null;
  retrievedAt: string;
  pageReference: string;
  sectionReference: string;
  reportingBasis: ReportingBasis;
}

export interface FundamentalCalculationInput {
  id: string;
  periodId: string;
  value: number;
  provenance: FundamentalProvenance;
}

interface FundamentalMetricBase {
  id: string;
  periodId: string;
  provenance: FundamentalProvenance;
  formula?: string;
  inputMetricIds?: string[];
  inputs?: FundamentalCalculationInput[];
}

export type FundamentalMetric =
  | (FundamentalMetricBase & {
      value: number;
      status: "reported";
    })
  | (FundamentalMetricBase & {
      value: number;
      status: "calculated";
      formula: string;
      inputMetricIds: string[];
      inputs: FundamentalCalculationInput[];
      calculatedAt: string;
    })
  | (FundamentalMetricBase & {
      value: null;
      status: "unavailable";
      reason: string;
    });

export interface FundamentalsCompany {
  ticker: string;
  companyName: string;
  exchange: string;
  companyType: CompanyType;
  reportingBasis: ReportingBasis;
  currency?: string;
}

export interface FundamentalsHistory {
  company: FundamentalsCompany;
  periods: FundamentalsReportingPeriod[];
  financials: FundamentalMetric[];
  sourceMode?: FundamentalsDataQuality["sourceMode"];
  statements?: FundamentalsStatements;
  bankMetrics: FundamentalMetric[];
  growthMetrics: FundamentalMetric[];
  provenance: FundamentalSource[];
  warnings: string[];
}

export interface FinancialValueInput {
  metricId: string;
  value: number;
  unit: FundamentalUnit | "MULTIPLE";
  currency: string | null;
  period: FundamentalPeriod | null;
  source: string;
  sourceType: "official_company_filing" | "market_data" | "calculated";
  sourceUrl: string | null;
  retrievedAt: string;
  marketData?: {
    provider: MarketDataProviderId;
    dataStatus: MarketDataStatus;
    licenseStatus: MarketDataLicenseStatus;
    delaySeconds: number | null;
  };
}

export type FinancialValueStatus =
  | "available"
  | "calculated"
  | "unavailable"
  | "not_applicable";

export interface FinancialValue {
  id: string;
  value: number | null;
  unit: FundamentalUnit | "MULTIPLE";
  currency: string | null;
  status: FinancialValueStatus;
  period: FundamentalPeriod | null;
  source: string;
  sourceType: "official_company_filing" | "market_data" | "calculated";
  sourceUrl: string | null;
  retrievedAt: string;
  formula?: string;
  inputs?: FinancialValueInput[];
  calculatedAt?: string;
  reason?: string;
  marketData?: FinancialValueInput["marketData"];
}

export interface FinancialMetricApplicability {
  metricId: string;
  status: "not_applicable";
  reason: string;
}

export interface FinancialSnapshot {
  profitability: FundamentalMetric[];
  growth: FundamentalMetric[];
  capital: FundamentalMetric[];
  assetQuality: FundamentalMetric[];
  operatingMetrics: FundamentalMetric[];
}

export interface FundamentalsStatements {
  incomeStatement: FundamentalMetric[];
  balanceSheet: FundamentalMetric[];
  cashFlowStatement: {
    status: "available" | "partial" | "unavailable";
    metrics: FundamentalMetric[];
    reason?: string;
  };
  bankOperatingMetrics: FundamentalMetric[];
}

export interface FundamentalsDataQuality {
  status: "available" | "partial" | "unavailable";
  sourceMode: "CURATED_OFFICIAL_DISCLOSURE_SNAPSHOT" | "SEC_COMPANYFACTS";
  classification: "HISTORICAL";
  metricCounts: {
    reported: number;
    calculated: number;
    unavailable: number;
  };
  reportingPeriodCount: number;
  annualPeriodCount: number;
  sourceCount: number;
  latestRetrievedAt: string | null;
  limitations: string[];
}

export type DcfFoundationFieldId =
  | "revenueGrowthAssumption"
  | "earningsGrowthAssumption"
  | "forecastPeriod"
  | "wacc"
  | "terminalGrowth"
  | "freeCashFlow"
  | "terminalValue"
  | "enterpriseValue"
  | "equityValue"
  | "impliedValuePerShare";

export interface FundamentalsAnalysis extends FundamentalsHistory {
  companyType: CompanyType;
  statements: FundamentalsStatements;
  financialStatements: FundamentalsStatements;
  ratios: FundamentalMetric[];
  trends: FundamentalMetric[];
  valuationInputs: Record<string, FinancialValue>;
  financialSnapshot: FinancialSnapshot;
  notApplicableMetrics: FinancialMetricApplicability[];
  dcfFoundation: Record<DcfFoundationFieldId, FinancialValue>;
  dataStatus: "available" | "partial" | "unavailable";
  dataQuality: FundamentalsDataQuality;
}

export type HdfcBankFundamentals = FundamentalsHistory;
