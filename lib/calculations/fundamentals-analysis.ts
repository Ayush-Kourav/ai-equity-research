import type { MarketQuote } from "@/lib/types/financial";
import type {
  FinancialMetricApplicability,
  FinancialSnapshot,
  FinancialValue,
  FinancialValueInput,
  DcfFoundationFieldId,
  FundamentalMetric,
  FundamentalPeriod,
  FundamentalProvenance,
  FundamentalsAnalysis,
  FundamentalsHistory,
} from "@/lib/types/fundamentals";
import { calculateCagr } from "./fundamentals.ts";

const RATIO_IDS = new Set([
  "roa",
  "roe",
  "netInterestMargin",
  "grossNpaRatio",
  "netNpaRatio",
  "casaRatio",
  "capitalAdequacyRatio",
  "cet1Ratio",
]);

const NOT_APPLICABLE_METRICS: FinancialMetricApplicability[] = [
  {
    metricId: "ebitda",
    status: "not_applicable",
    reason:
      "EBITDA is not a meaningful operating metric for a deposit-taking bank.",
  },
  {
    metricId: "ebit",
    status: "not_applicable",
    reason:
      "EBIT is not a meaningful operating metric for a deposit-taking bank.",
  },
  {
    metricId: "industrialFreeCashFlow",
    status: "not_applicable",
    reason:
      "Industrial-company free cash flow is not applied to a bank's operating cash flows.",
  },
  {
    metricId: "debtToEquity",
    status: "not_applicable",
    reason:
      "Deposits and borrowings are operating funding for a bank; industrial debt/equity interpretation is not appropriate.",
  },
  {
    metricId: "interestCoverage",
    status: "not_applicable",
    reason:
      "Interest expense is a core operating cost for a bank, so industrial interest coverage is not meaningful.",
  },
  {
    metricId: "roce",
    status: "not_applicable",
    reason:
      "Industrial return on capital employed is not applied to a regulated bank.",
  },
  {
    metricId: "assetTurnover",
    status: "not_applicable",
    reason:
      "Industrial asset turnover is not a meaningful bank operating-efficiency measure.",
  },
  {
    metricId: "operatingMargin",
    status: "not_applicable",
    reason:
      "Bank profitability is represented with NIM, ROA and ROE rather than industrial operating margin.",
  },
  {
    metricId: "netProfitMargin",
    status: "not_applicable",
    reason:
      "Bank profitability is represented with NIM, ROA and ROE rather than industrial net margin.",
  },
];

function findMetric(
  metrics: FundamentalMetric[],
  id: string,
  periodId: string,
): FundamentalMetric | undefined {
  return metrics.find(
    (metric) => metric.id === id && metric.periodId === periodId,
  );
}

function currencyForUnit(unit: FinancialValue["unit"]): string | null {
  if (
    unit === "USD_BILLION" ||
    unit === "USD_MILLION" ||
    unit === "USD_PER_SHARE"
  ) {
    return "USD";
  }
  if (
    unit === "PERCENT" ||
    unit === "CURRENCY_PER_SHARE" ||
    unit === "CRORE_SHARES" ||
    unit === "BILLION_SHARES" ||
    unit === "YEARS"
  ) {
    return null;
  }
  return "INR";
}

function unavailableValue(
  id: string,
  unit: FinancialValue["unit"],
  reason: string,
  source: string,
  sourceType: FinancialValue["sourceType"],
  sourceUrl: string | null,
  retrievedAt: string,
  period: FundamentalPeriod | null = null,
  currencyOverride?: string | null,
): FinancialValue {
  return {
    id,
    value: null,
    unit,
    currency: currencyOverride ?? currencyForUnit(unit),
    status: "unavailable",
    period,
    source,
    sourceType,
    sourceUrl,
    retrievedAt,
    reason,
  };
}

function fundamentalInput(metric: FundamentalMetric): FinancialValueInput | null {
  if (metric.status === "unavailable") {
    return null;
  }
  return {
    metricId: metric.id,
    value: metric.value,
    unit: metric.provenance.unit,
    currency: metric.provenance.currency,
    period: metric.provenance.period,
    source: metric.provenance.source,
    sourceType:
      metric.provenance.sourceType === "calculated"
        ? "calculated"
        : "official_company_filing",
    sourceUrl: metric.provenance.sourceUrl,
    retrievedAt: metric.provenance.retrievedAt,
  };
}

function financialValueInput(value: FinancialValue): FinancialValueInput | null {
  if (value.value === null) {
    return null;
  }
  return {
    metricId: value.id,
    value: value.value,
    unit: value.unit,
    currency: value.currency,
    period: value.period,
    source: value.source,
    sourceType: value.sourceType,
    sourceUrl: value.sourceUrl,
    retrievedAt: value.retrievedAt,
    marketData: value.marketData,
  };
}

function quoteInput(
  quote: MarketQuote & { asOf: string },
): FinancialValueInput {
  return {
    metricId: "currentPrice",
    value: quote.price,
    unit: pricePerShareUnit(quote.currency),
    currency: quote.currency,
    period: {
      id: `market-${quote.asOf}`,
      periodType: "instant",
      periodStart: null,
      periodEnd: quote.asOf.slice(0, 10),
      label: `Market price as of ${quote.asOf}`,
    },
    source: quote.source,
    sourceType: "market_data",
    sourceUrl: quote.sourceUrl,
    retrievedAt: quote.retrievedAt,
    marketData: {
      provider: quote.provider,
      dataStatus: quote.dataStatus,
      licenseStatus: quote.licenseStatus,
      delaySeconds: quote.delaySeconds,
    },
  };
}

function quoteIsUsable(
  quote: MarketQuote | null,
): quote is MarketQuote & { asOf: string } {
  return Boolean(
    quote &&
    quote.asOf !== null &&
    quote.dataStatus !== "DEMO" &&
      quote.dataStatus !== "UNAVAILABLE" &&
    quote.currency.trim().length > 0 &&
      Number.isFinite(quote.price) &&
      quote.price > 0,
  );
}

function getLatestAnnualMetric(
  history: FundamentalsHistory,
  metricId: string,
): FundamentalMetric | undefined {
  const latestAnnualPeriod = [...history.periods]
    .filter((period) => period.periodType === "annual")
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
  return latestAnnualPeriod
    ? findMetric(history.financials, metricId, latestAnnualPeriod.id)
    : undefined;
}

function metricValue(
  metric: FundamentalMetric | undefined,
  id: string,
  unit: FinancialValue["unit"],
  unavailableReason: string,
): FinancialValue {
  if (!metric) {
    return unavailableValue(
      id,
      unit,
      unavailableReason,
      "Verified HDFC Bank disclosures",
      "official_company_filing",
      null,
      new Date().toISOString(),
    );
  }
  if (metric.status === "unavailable") {
    return unavailableValue(
      id,
      unit,
      metric.reason,
      metric.provenance.source,
      "official_company_filing",
      metric.provenance.sourceUrl,
      metric.provenance.retrievedAt,
      metric.provenance.period,
    );
  }
  return {
    id,
    value: metric.value,
    unit: metric.provenance.unit,
    currency: metric.provenance.currency,
    status: metric.status === "calculated" ? "calculated" : "available",
    period: metric.provenance.period,
    source: metric.provenance.source,
    sourceType:
      metric.provenance.sourceType === "calculated"
        ? "calculated"
        : "official_company_filing",
    sourceUrl: metric.provenance.sourceUrl,
    retrievedAt: metric.provenance.retrievedAt,
    ...(metric.status === "calculated"
      ? {
          formula: metric.formula,
          inputs: metric.inputs?.map((input) => ({
            metricId: input.id,
            value: input.value,
            unit: input.provenance.unit,
            currency: input.provenance.currency,
            period: input.provenance.period,
            source: input.provenance.source,
            sourceType:
              input.provenance.sourceType === "calculated"
                ? "calculated"
                : "official_company_filing",
            sourceUrl: input.provenance.sourceUrl,
            retrievedAt: input.provenance.retrievedAt,
          })),
          calculatedAt: metric.calculatedAt,
        }
      : {}),
  };
}

function pricePerShareUnit(currency: string | null | undefined) {
  if (currency === "INR" || currency === "USD") {
    return currency === "USD" ? "USD_PER_SHARE" : "INR_PER_SHARE";
  }
  return "CURRENCY_PER_SHARE";
}

function marketPriceValue(
  quote: MarketQuote | null,
  unavailableReason: string,
  fallbackCurrency: string | null | undefined,
): FinancialValue {
  const currency = quote?.currency ?? fallbackCurrency;
  const unit = pricePerShareUnit(currency);
  if (!quote || !quoteIsUsable(quote)) {
    return unavailableValue(
      "currentPrice",
      unit,
      quote?.dataStatus === "DEMO"
        ? "Synthetic demo prices are excluded from valuation calculations."
        : unavailableReason,
      quote?.source ?? "Market data provider",
      "market_data",
      quote?.sourceUrl ?? null,
      quote?.retrievedAt ?? new Date().toISOString(),
      null,
      currency,
    );
  }
  return {
    id: "currentPrice",
    value: quote.price,
    unit,
    currency: quote.currency,
    status: "available",
    period: quoteInput(quote).period,
    source: quote.source,
    sourceType: "market_data",
    sourceUrl: quote.sourceUrl,
    retrievedAt: quote.retrievedAt,
    marketData: {
      provider: quote.provider,
      dataStatus: quote.dataStatus,
      licenseStatus: quote.licenseStatus,
      delaySeconds: quote.delaySeconds,
    },
  };
}

function calculateMultiple(
  id: "pe" | "pb",
  quote: MarketQuote | null,
  denominator: FinancialValue,
  unavailableReason: string,
): FinancialValue {
  const price = quote && quoteIsUsable(quote) ? quote : null;
  const denominatorInput = financialValueInput(denominator);

  if (
    !price ||
    denominator.status === "unavailable" ||
    denominator.status === "not_applicable" ||
    denominator.value === null ||
    !denominatorInput
  ) {
    return unavailableValue(
      id,
      "MULTIPLE",
      !price
        ? unavailableReason
        : denominator.status === "unavailable" ||
            denominator.status === "not_applicable"
          ? denominator.reason ?? unavailableReason
          : unavailableReason,
      denominator.source,
      "calculated",
      denominator.sourceUrl,
      denominator.retrievedAt,
      denominator.period,
    );
  }
  if (
    denominator.unit !== "INR_PER_SHARE" ||
    denominator.currency !== "INR" ||
    price.currency !== denominator.currency ||
    denominator.value <= 0
  ) {
    return unavailableValue(
      id,
      "MULTIPLE",
      "A positive INR-per-share denominator is required.",
      denominator.source,
      "calculated",
      denominator.sourceUrl,
      denominator.retrievedAt,
      denominator.period,
    );
  }

  const priceReference = quoteInput(price);
  return {
    id,
    value: price.price / denominator.value,
    unit: "MULTIPLE",
    currency: null,
    status: "calculated",
    period: denominator.period,
    source: "EquityMind deterministic valuation input calculation",
    sourceType: "calculated",
    sourceUrl: null,
    retrievedAt: new Date().toISOString(),
    formula:
      id === "pe"
        ? "current share price / annual EPS"
        : "current share price / book value per share",
    inputs: [priceReference, denominatorInput],
    calculatedAt: new Date().toISOString(),
  };
}

function valuationInputs(
  history: FundamentalsHistory,
  quote: MarketQuote | null,
  marketUnavailableReason: string,
): Record<string, FinancialValue> {
  const latestAnnualEps = getLatestAnnualMetric(history, "basicEps");
  const latestPeriod = [...history.periods].sort((left, right) =>
    right.periodEnd.localeCompare(left.periodEnd),
  )[0];
  const latestNetWorth = latestPeriod
    ? findMetric(history.bankMetrics, "totalNetWorth", latestPeriod.id)
    : undefined;
  const sharesOutstanding = latestPeriod
    ? findMetric(history.financials, "sharesOutstanding", latestPeriod.id) ??
      findMetric(history.bankMetrics, "sharesOutstanding", latestPeriod.id)
    : undefined;
  const netWorthAndSharesMatch =
    latestNetWorth?.status !== "unavailable" &&
    sharesOutstanding?.status !== "unavailable" &&
    latestNetWorth?.provenance.reportingBasis ===
      sharesOutstanding?.provenance.reportingBasis &&
    latestNetWorth?.provenance.period.periodType ===
      sharesOutstanding?.provenance.period.periodType &&
    latestNetWorth?.provenance.period.periodStart ===
      sharesOutstanding?.provenance.period.periodStart &&
    latestNetWorth?.provenance.period.periodEnd ===
      sharesOutstanding?.provenance.period.periodEnd;
  const bookValuePerShare: FinancialValue =
    !latestNetWorth ||
    latestNetWorth.status === "unavailable" ||
    !sharesOutstanding ||
    sharesOutstanding.status === "unavailable" ||
    sharesOutstanding.value <= 0 ||
    !netWorthAndSharesMatch ||
    latestNetWorth.provenance.unit !== "INR_CRORE" ||
    sharesOutstanding.provenance.unit !== "CRORE_SHARES"
      ? unavailableValue(
          "bookValuePerShare",
          "INR_PER_SHARE",
          sharesOutstanding?.status === "unavailable"
            ? sharesOutstanding.reason
            : "Verified shares outstanding and closing net worth for the same balance date are required.",
          latestNetWorth?.provenance.source ?? "Verified HDFC Bank disclosures",
          "official_company_filing",
          latestNetWorth?.provenance.sourceUrl ?? null,
          latestNetWorth?.provenance.retrievedAt ?? new Date().toISOString(),
          latestNetWorth?.provenance.period ?? null,
        )
      : {
          id: "bookValuePerShare",
          value: latestNetWorth.value / sharesOutstanding.value,
          unit: "INR_PER_SHARE",
          currency: "INR",
          status: "calculated" as const,
          period: latestNetWorth.provenance.period,
          source: "EquityMind deterministic valuation input calculation",
          sourceType: "calculated" as const,
          sourceUrl: latestNetWorth.provenance.sourceUrl,
          retrievedAt: new Date().toISOString(),
          formula: "closing shareholders' net worth / shares outstanding",
          inputs: [latestNetWorth, sharesOutstanding].flatMap((metric) => {
            const input = fundamentalInput(metric);
            return input ? [input] : [];
          }),
          calculatedAt: new Date().toISOString(),
        };
  const quoteUsable = Boolean(quote && quoteIsUsable(quote));
  const currentPrice = marketPriceValue(
    quote,
    marketUnavailableReason,
    history.company.currency,
  );
  const eps = metricValue(
    latestAnnualEps,
    "eps",
    "INR_PER_SHARE",
    "Latest annual EPS is not available from a verified source.",
  );
  const pe = calculateMultiple(
    "pe",
    quoteUsable ? quote : null,
    eps,
    "A current INR market price and verified latest annual EPS are required; quarterly EPS is not treated as TTM EPS.",
  );
  const pb = calculateMultiple(
    "pb",
    quoteUsable ? quote : null,
    bookValuePerShare,
    bookValuePerShare.reason ??
      "A current INR market price and verified book value per share are required.",
  );
  const latestRoe = latestPeriod
    ? findMetric(history.bankMetrics, "roe", latestPeriod.id)
    : undefined;
  return {
    currentPrice,
    eps,
    bookValuePerShare,
    pe,
    pb,
    roe: metricValue(
      latestRoe,
      "roe",
      "PERCENT",
      "ROE is not available from verified inputs for the latest reporting period.",
    ),
    costOfEquity: unavailableValue(
      "costOfEquity",
      "PERCENT",
      "Cost of equity requires an explicitly specified, sourced methodology and assumptions; none are configured.",
      "EquityMind valuation assumptions",
      "calculated",
      null,
      new Date().toISOString(),
    ),
  };
}

function buildDcfFoundation(
  retrievedAt: string,
  reason =
    "A bank-appropriate valuation method and verified supporting assumptions have not been specified. No valuation value is calculated.",
  amountUnit: FinancialValue["unit"] = "INR_CRORE",
  perShareUnit: FinancialValue["unit"] = "INR_PER_SHARE",
): Record<DcfFoundationFieldId, FinancialValue> {
  const unavailable = (
    id: DcfFoundationFieldId,
    unit: FinancialValue["unit"],
  ) =>
    unavailableValue(
      id,
      unit,
      reason,
      "EquityMind valuation inputs",
      "calculated",
      null,
      retrievedAt,
    );
  return {
    revenueGrowthAssumption: unavailable("revenueGrowthAssumption", "PERCENT"),
    earningsGrowthAssumption: unavailable("earningsGrowthAssumption", "PERCENT"),
    forecastPeriod: unavailable("forecastPeriod", "YEARS"),
    wacc: unavailable("wacc", "PERCENT"),
    terminalGrowth: unavailable("terminalGrowth", "PERCENT"),
    freeCashFlow: unavailable("freeCashFlow", amountUnit),
    terminalValue: unavailable("terminalValue", amountUnit),
    enterpriseValue: unavailable("enterpriseValue", amountUnit),
    equityValue: unavailable("equityValue", amountUnit),
    impliedValuePerShare: unavailable("impliedValuePerShare", perShareUnit),
  };
}

function buildSnapshot(
  history: FundamentalsHistory,
  trends: FundamentalMetric[],
): FinancialSnapshot {
  const latest = [...history.periods].sort((left, right) =>
    right.periodEnd.localeCompare(left.periodEnd),
  )[0];
  const metricAtLatest = (id: string, collection: "financials" | "bankMetrics") =>
    latest ? findMetric(history[collection], id, latest.id) : undefined;
  const latestMetric = (
    id: string,
    collection: "financials" | "bankMetrics",
  ) => metricAtLatest(id, collection);
  const metricTrend = (id: string) =>
    trends.find((metric) => metric.id === id && metric.periodId === latest?.id);
  return {
    profitability: [
      latestMetric("netRevenue", "financials"),
      latestMetric("totalIncome", "financials"),
      latestMetric("profitBeforeTax", "financials"),
      latestMetric("profitAfterTax", "financials"),
      latestMetric("netInterestIncome", "bankMetrics"),
      latestMetric("roa", "bankMetrics"),
      latestMetric("roe", "bankMetrics"),
      latestMetric("netInterestMargin", "bankMetrics"),
    ].filter((metric): metric is FundamentalMetric => metric !== undefined),
    growth: [
      metricTrend("netRevenueGrowthYoY"),
      metricTrend("totalIncomeGrowthYoY"),
      metricTrend("profitAfterTaxGrowthYoY"),
      metricTrend("netInterestIncomeGrowthYoY"),
      metricTrend("depositGrowthYoY"),
      metricTrend("grossAdvancesGrowthYoY"),
      metricTrend("basicEpsGrowthYoY"),
    ].filter((metric): metric is FundamentalMetric => metric !== undefined),
    capital: [
      latestMetric("capitalAdequacyRatio", "bankMetrics"),
      latestMetric("cet1Ratio", "bankMetrics"),
    ].filter((metric): metric is FundamentalMetric => metric !== undefined),
    assetQuality: [
      latestMetric("grossNpaRatio", "bankMetrics"),
      latestMetric("netNpaRatio", "bankMetrics"),
    ].filter((metric): metric is FundamentalMetric => metric !== undefined),
    operatingMetrics: [
      latestMetric("totalDeposits", "bankMetrics"),
      latestMetric("grossAdvances", "bankMetrics"),
      latestMetric("casaRatio", "bankMetrics"),
    ].filter((metric): metric is FundamentalMetric => metric !== undefined),
  };
}

function buildStatements(history: FundamentalsHistory) {
  if (history.statements) {
    return history.statements;
  }
  const incomeStatementIds = new Set([
    "netRevenue",
    "interestEarned",
    "interestExpended",
    "totalIncome",
    "profitBeforeTax",
    "profitAfterTax",
    "basicEps",
    "dilutedEps",
  ]);
  const balanceSheetIds = new Set([
    "totalAssets",
    "totalNetWorth",
    "totalDeposits",
    "grossAdvances",
    "balanceSheetAdvances",
    "cashAndBalancesWithRbi",
    "balancesWithBanksAndCall",
    "borrowings",
    "sharesOutstanding",
  ]);
  return {
    incomeStatement: history.financials.filter((metric) =>
      incomeStatementIds.has(metric.id),
    ),
    balanceSheet: [
      ...history.bankMetrics.filter((metric) => balanceSheetIds.has(metric.id)),
      ...history.financials.filter((metric) => metric.id === "sharesOutstanding"),
    ],
    cashFlowStatement: {
      status: "unavailable" as const,
      metrics: [],
      reason:
        "No cash-flow observations have been curated into the verified HDFC Bank fundamentals dataset.",
    },
    bankOperatingMetrics: history.bankMetrics.filter(
      (metric) => !balanceSheetIds.has(metric.id),
    ),
  };
}

export function buildFundamentalsAnalysis(
  history: FundamentalsHistory,
  quote: MarketQuote | null = null,
  marketUnavailableReason = "Current market price is unavailable from the configured market-data provider.",
): FundamentalsAnalysis {
  if (history.company.companyType !== "FINANCIAL_INSTITUTION") {
    const allMetrics = [
      ...history.financials,
      ...history.bankMetrics,
      ...history.growthMetrics,
    ];
    const availableCount = allMetrics.filter(
      (metric) => metric.status !== "unavailable",
    ).length;
    const unavailableCount = allMetrics.length - availableCount;
    const dataStatus =
      availableCount === 0
        ? "unavailable"
        : unavailableCount > 0
          ? "partial"
          : "available";
    const latestRetrievedAt =
      allMetrics
        .map((metric) => metric.provenance.retrievedAt)
        .sort()
        .at(-1) ?? null;
    const financialStatements = buildStatements(history);
    const retrievedAt =
      latestRetrievedAt ?? history.provenance[0]?.retrievedAt;
    if (!retrievedAt) {
      throw new Error(
        "Verified fundamentals source retrieval timestamp is missing.",
      );
    }
    return {
      ...history,
      companyType: history.company.companyType,
      statements: financialStatements,
      financialStatements,
      ratios: [],
      trends: history.growthMetrics,
      valuationInputs: {},
      dcfFoundation: buildDcfFoundation(
        retrievedAt,
        "Operating-company DCF outputs are produced by the deterministic valuation service; no valuation is calculated from fundamentals alone.",
        history.company.currency === "USD" ? "USD_BILLION" : "INR_CRORE",
        history.company.currency === "USD"
          ? "USD_PER_SHARE"
          : "INR_PER_SHARE",
      ),
      financialSnapshot: {
        profitability: financialStatements.incomeStatement,
        growth: history.growthMetrics,
        capital: financialStatements.balanceSheet,
        assetQuality: [],
        operatingMetrics: financialStatements.cashFlowStatement.metrics,
      },
      notApplicableMetrics: [],
      dataStatus,
      dataQuality: {
        status: dataStatus,
        sourceMode:
          history.sourceMode ?? "CURATED_OFFICIAL_DISCLOSURE_SNAPSHOT",
        classification: "HISTORICAL",
        metricCounts: {
          reported: allMetrics.filter((metric) => metric.status === "reported")
            .length,
          calculated: allMetrics.filter(
            (metric) => metric.status === "calculated",
          ).length,
          unavailable: unavailableCount,
        },
        reportingPeriodCount: history.periods.length,
        annualPeriodCount: history.periods.filter(
          (period) => period.periodType === "annual",
        ).length,
        sourceCount: new Set(history.provenance.map((source) => source.id))
          .size,
        latestRetrievedAt,
        limitations: [...history.warnings],
      },
    };
  }

  const trends = [...history.growthMetrics];
  const annualPeriods = history.periods
    .filter((period) => period.periodType === "annual")
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
  const latestComparisonGroup =
    annualPeriods[annualPeriods.length - 1]?.comparisonGroup;
  const comparableAnnualPeriods = (
    latestComparisonGroup
      ? annualPeriods.filter(
          (period) => period.comparisonGroup === latestComparisonGroup,
        )
      : annualPeriods
  ).slice(-3);
  for (const [sourceMetricId, cagrId] of [
    ["profitAfterTax", "profitAfterTaxCagr"],
    ["netRevenue", "incomeCagr"],
    ["basicEps", "basicEpsCagr"],
  ] as const) {
    const annualMetrics = comparableAnnualPeriods.map((period) =>
      findMetric(history.financials, sourceMetricId, period.id),
    );
    if (annualMetrics.length < 2 || annualMetrics.some((metric) => !metric)) {
      continue;
    }
    const completeAnnualMetrics = annualMetrics.filter(
      (metric): metric is FundamentalMetric => metric !== undefined,
    );
    const lastPeriodId =
      completeAnnualMetrics[completeAnnualMetrics.length - 1]?.periodId ??
      history.periods[history.periods.length - 1]?.id;
    const period = history.periods.find(
      (candidate) => candidate.id === lastPeriodId,
    );
    if (!period || annualMetrics.length < 2) {
      continue;
    }
    const sourceMetric =
      completeAnnualMetrics[completeAnnualMetrics.length - 1];
    if (!sourceMetric) {
      continue;
    }
    const provenance: FundamentalProvenance = {
      ...sourceMetric.provenance,
      sourceId: null,
      source: "EquityMind deterministic calculation from official HDFC Bank disclosures",
      sourceType: "calculated",
      period,
      unit: "PERCENT",
      currency: null,
      pageReference: "Calculated from cited inputs",
      sectionReference: `${cagrId} calculated from consecutive comparable annual observations`,
    };
    trends.push(calculateCagr(cagrId, completeAnnualMetrics, provenance));
  }

  const ratios = [
    ...history.bankMetrics.filter((metric) => RATIO_IDS.has(metric.id)),
    ...history.growthMetrics.filter((metric) =>
      RATIO_IDS.has(metric.id),
    ),
  ];
  const notApplicableMetrics = [...NOT_APPLICABLE_METRICS];
  const snapshot = buildSnapshot(history, trends);
  const allMetrics = [
    ...history.financials,
    ...history.bankMetrics,
    ...history.growthMetrics,
  ];
  const cagrMetrics = trends.filter((metric) =>
    metric.id.endsWith("Cagr"),
  );
  const qualityMetrics = [...allMetrics, ...cagrMetrics];
  const hasData = qualityMetrics.some(
    (metric) => metric.status === "reported" || metric.status === "calculated",
  );
  const hasUnavailable = qualityMetrics.some(
    (metric) => metric.status === "unavailable",
  );
  const dataStatus = !hasData
    ? "unavailable"
    : hasUnavailable
      ? "partial"
      : "available";
  const latestRetrievedAt = qualityMetrics
    .map((metric) => metric.provenance.retrievedAt)
    .sort()
    .at(-1) ?? null;
  const financialStatements = buildStatements(history);
  const valuationRetrievedAt = history.provenance[0]?.retrievedAt;
  if (!valuationRetrievedAt) {
    throw new Error(
      "Verified fundamentals source retrieval timestamp is missing.",
    );
  }
  const limitations = [...history.warnings];
  if (financialStatements.cashFlowStatement.status === "unavailable") {
    if (financialStatements.cashFlowStatement.reason) {
      limitations.push(financialStatements.cashFlowStatement.reason);
    }
  }
  if (comparableAnnualPeriods.length < 3) {
    limitations.push(
      `Only ${comparableAnnualPeriods.length} comparable annual reporting period(s) are available for CAGR; three-year trend coverage is incomplete.`,
    );
  }
  return {
    ...history,
    companyType: history.company.companyType,
    statements: financialStatements,
    financialStatements,
    ratios,
    trends,
    valuationInputs: valuationInputs(
      history,
      quote,
      marketUnavailableReason,
    ),
    dcfFoundation: buildDcfFoundation(valuationRetrievedAt),
    financialSnapshot: snapshot,
    notApplicableMetrics,
    dataStatus,
    dataQuality: {
      status: dataStatus,
      sourceMode:
        history.sourceMode ?? "CURATED_OFFICIAL_DISCLOSURE_SNAPSHOT",
      classification: "HISTORICAL",
      metricCounts: {
        reported: qualityMetrics.filter((metric) => metric.status === "reported")
          .length,
        calculated: qualityMetrics.filter(
          (metric) => metric.status === "calculated",
        ).length,
        unavailable: qualityMetrics.filter(
          (metric) => metric.status === "unavailable",
        ).length,
      },
      reportingPeriodCount: history.periods.length,
      annualPeriodCount: annualPeriods.length,
      sourceCount: new Set(history.provenance.map((source) => source.id)).size,
      latestRetrievedAt,
      limitations,
    },
  };
}
