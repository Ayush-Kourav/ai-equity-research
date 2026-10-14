import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCagr,
  calculateGrowth,
  calculateRoa,
  reportedMetric,
  resolveReportedMetric,
  validateFundamentalsHistory,
} from "../lib/calculations/fundamentals.ts";
import { buildFundamentalsAnalysis } from "../lib/calculations/fundamentals-analysis.ts";
import { HdfcBankFundamentalsProvider } from "../lib/providers/hdfc-bank-fundamentals-provider.ts";
import type { MarketQuote } from "../lib/types/financial.ts";
import type {
  FundamentalMetric,
  FundamentalsReportingPeriod,
} from "../lib/types/fundamentals.ts";

async function getHistory() {
  const result = await new HdfcBankFundamentalsProvider().getFundamentals(
    "HDFCBANK.NS",
  );
  assert.ok(result);
  return result;
}

function getMetric(
  metrics: FundamentalMetric[],
  id: string,
  periodId: string,
): FundamentalMetric {
  const metric = metrics.find(
    (candidate) => candidate.id === id && candidate.periodId === periodId,
  );
  assert.ok(metric, `Expected ${id} for ${periodId}`);
  return metric;
}

test("retrieves the verified six-period HDFC standalone fundamentals history", async () => {
  const history = await getHistory();
  assert.deepEqual(
    history.periods.map((period) => period.label),
    [
      "Q1 FY2026-27",
      "Q4 FY2025-26",
      "Q1 FY2025-26",
      "FY2025-26",
      "FY2024-25",
      "FY2023-24",
    ],
  );
  assert.equal(
    getMetric(history.financials, "profitAfterTax", "q1-fy2026-27").value,
    19059.72,
  );
  assert.equal(
    getMetric(history.bankMetrics, "grossNpaRatio", "q1-fy2025-26").value,
    1.4,
  );
  assert.equal(history.company.companyType, "FINANCIAL_INSTITUTION");
  assert.equal(history.company.reportingBasis, "standalone");
  validateFundamentalsHistory(history);
});

test("keeps missing statement metrics null and visibly unavailable", async () => {
  const history = await getHistory();
  const missing = getMetric(
    history.financials,
    "profitBeforeTax",
    "fy2025-26",
  );
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.value, null);
  assert.match(missing.reason, /scanned table/i);
});

test("keeps period ratios attached to quarterly or annual periods, not balance dates", async () => {
  const history = await getHistory();
  const quarterlyRoa = getMetric(
    history.bankMetrics,
    "roa",
    "q1-fy2025-26",
  );
  const annualRoa = getMetric(
    history.bankMetrics,
    "roa",
    "fy2024-25",
  );
  const annualNim = getMetric(
    history.bankMetrics,
    "netInterestMargin",
    "fy2024-25",
  );
  assert.equal(quarterlyRoa.provenance.period.periodType, "quarterly");
  assert.equal(annualRoa.provenance.period.periodType, "annual");
  assert.equal(annualNim.status, "unavailable");
  assert.equal(annualNim.value, null);
});

test("does not calculate quarter growth against a different quarter", async () => {
  const history = await getHistory();
  const q1Growth = getMetric(
    history.growthMetrics,
    "profitAfterTaxGrowthYoY",
    "q1-fy2026-27",
  );
  const q4Growth = getMetric(
    history.growthMetrics,
    "profitAfterTaxGrowthYoY",
    "q4-fy2025-26",
  );
  assert.equal(q1Growth.status, "calculated");
  assert.equal(q4Growth.status, "unavailable");
  if (q1Growth.status === "calculated") {
    assert.equal(q1Growth.inputs?.[1].provenance.period.label, "Q1 FY2025-26");
    assert.equal(
      q1Growth.value,
      ((19059.72 - 18155.21) / 18155.21) * 100,
    );
  }
});

test("rejects annual and quarterly period comparisons", async () => {
  const history = await getHistory();
  const quarter = getMetric(
    history.financials,
    "profitAfterTax",
    "q1-fy2026-27",
  );
  const annual = getMetric(
    history.financials,
    "profitAfterTax",
    "fy2024-25",
  );
  assert.throws(
    () =>
      calculateGrowth(
        "invalid-growth",
        quarter,
        annual,
        history.growthMetrics[0].provenance,
      ),
    /matching periods one year apart/,
  );
});

test("normalizes INR crore and billion amounts only for like-for-like growth", async () => {
  const history = await getHistory();
  const q1Nii = getMetric(
    history.bankMetrics,
    "netInterestIncome",
    "q1-fy2026-27",
  );
  const niiGrowth = getMetric(
    history.growthMetrics,
    "netInterestIncomeGrowthYoY",
    "q1-fy2026-27",
  );
  assert.equal(niiGrowth.status, "calculated");
  assert.equal(niiGrowth.provenance.unit, "PERCENT");
  assert.equal(q1Nii.provenance.unit, "INR_BILLION");

  assert.equal(niiGrowth.status, "calculated");
  if (niiGrowth.status !== "calculated" || !niiGrowth.inputs?.[1]) {
    throw new Error("Test setup expected calculated NII growth inputs.");
  }
  const priorInput = niiGrowth.inputs[1];
  const priorNiiInCrore = reportedMetric(
    "prior-nii-crore",
    priorInput.periodId,
    priorInput.value * 100,
    {
      ...priorInput.provenance,
      unit: "INR_CRORE",
    },
  );
  const convertedGrowth = calculateGrowth(
    "converted-nii-growth",
    q1Nii,
    priorNiiInCrore,
    niiGrowth.provenance,
  );
  assert.equal(convertedGrowth.status, "calculated");
  assert.ok(Math.abs(convertedGrowth.value - niiGrowth.value) < 1e-10);

  const inconsistentPrior = reportedMetric(
    "prior-nii",
    priorInput.periodId,
    priorInput.value,
    {
      ...priorInput.provenance,
      unit: "PERCENT",
      currency: null,
    },
  );
  assert.throws(
    () =>
      calculateGrowth(
        "inconsistent-growth",
        q1Nii,
        inconsistentPrior,
        niiGrowth.provenance,
      ),
    /not an INR amount/,
  );
});

test("preserves official source URL, publication date, period, unit and retrieval timestamp", async () => {
  const history = await getHistory();
  const pat = getMetric(
    history.financials,
    "profitAfterTax",
    "q1-fy2026-27",
  );
  assert.equal(pat.provenance.sourceType, "official_company_filing");
  assert.match(pat.provenance.sourceUrl, /hdfc\.bank\.in/);
  assert.equal(pat.provenance.publicationDate, "2026-07-18");
  assert.equal(pat.provenance.period.periodEnd, "2026-06-30");
  assert.equal(pat.provenance.unit, "INR_CRORE");
  assert.equal(pat.provenance.currency, "INR");
  assert.equal(pat.provenance.pageReference, "1");
  assert.match(pat.provenance.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("rejects duplicate reporting periods", async () => {
  const history = await getHistory();
  assert.throws(
    () =>
      validateFundamentalsHistory({
        ...history,
        periods: [...history.periods, history.periods[0]],
      }),
    /Duplicate reporting period/,
  );
});

test("detects conflicting official source values", async () => {
  const history = await getHistory();
  const first = getMetric(
    history.financials,
    "profitAfterTax",
    "q1-fy2026-27",
  );
  assert.equal(first.status, "reported");
  if (first.status !== "reported") {
    throw new Error("Test setup expected reported PAT.");
  }
  const conflicting: FundamentalMetric = {
    ...first,
    value: first.value + 1,
    provenance: {
      ...first.provenance,
      source: "Conflicting official source",
      sourceUrl: "https://www.hdfc.bank.in/conflicting-source.pdf",
    },
  };
  assert.throws(
    () => resolveReportedMetric(first.id, [first, conflicting]),
    /Conflicting official source values/,
  );
});

test("does not return HDFC history for an unsupported ticker", async () => {
  const result = await new HdfcBankFundamentalsProvider().getFundamentals(
    "ICICIBANK.NS",
  );
  assert.equal(result, null);
});

test("does not calculate a metric with unavailable inputs", async () => {
  const history = await getHistory();
  const roe = getMetric(history.bankMetrics, "roe", "q4-fy2025-26");
  assert.equal(roe.status, "unavailable");
  assert.equal(roe.value, null);
  assert.match(roe.reason, /cannot be calculated/i);
});

test("prevents mismatched period metadata from passing validation", async () => {
  const history = await getHistory();
  const period: FundamentalsReportingPeriod = {
    ...history.periods[0],
    periodEnd: "2026-09-30",
  };
  assert.throws(
    () =>
      validateFundamentalsHistory({
        ...history,
        periods: [period, ...history.periods.slice(1)],
      }),
    /reporting period inconsistent/,
  );
});

test("preserves reported ROA and calculates ROA and ROE only from period-matched inputs", async () => {
  const history = await getHistory();
  const reportedRoa = getMetric(
    history.bankMetrics,
    "roa",
    "q1-fy2026-27",
  );
  const calculatedRoa = getMetric(
    history.bankMetrics,
    "roa",
    "fy2025-26",
  );
  const calculatedRoe = getMetric(
    history.bankMetrics,
    "roe",
    "fy2025-26",
  );
  assert.equal(reportedRoa.status, "reported");
  assert.equal(calculatedRoa.status, "calculated");
  assert.equal(calculatedRoe.status, "calculated");
  if (
    calculatedRoa.status !== "calculated" ||
    calculatedRoe.status !== "calculated"
  ) {
    throw new Error("Expected ROA and ROE to use verified period inputs.");
  }
  assert.match(calculatedRoa.formula, /average opening and closing total assets/i);
  assert.match(calculatedRoe.formula, /average opening and closing net worth/i);
  assert.ok(calculatedRoa.inputs.length >= 3);
  assert.ok(calculatedRoe.inputs.length >= 3);
  assert.ok(Number.isFinite(Date.parse(calculatedRoa.calculatedAt)));
});

test("calculates annual PAT growth and CAGR with explicit unit normalization", async () => {
  const history = await getHistory();
  const annualGrowth = getMetric(
    history.growthMetrics,
    "profitAfterTaxGrowthYoY",
    "fy2025-26",
  );
  assert.equal(annualGrowth.status, "calculated");
  if (annualGrowth.status === "calculated") {
    assert.ok(Math.abs(annualGrowth.value - ((74670 - 67347.36) / 67347.36) * 100) < 1e-10);
    assert.match(annualGrowth.formula, /billion.*converted/i);
  }

  const first = getMetric(history.financials, "profitAfterTax", "fy2024-25");
  const second = getMetric(history.financials, "profitAfterTax", "fy2025-26");
  const cagrProvenance = {
    ...second.provenance,
    sourceId: null,
    source: "EquityMind deterministic test calculation",
    sourceType: "calculated" as const,
    unit: "PERCENT" as const,
    currency: null,
    pageReference: "Calculated from cited inputs",
    sectionReference: "Test CAGR",
  };
  const cagr = calculateCagr(
    "profitAfterTaxCagr",
    [first, second],
    cagrProvenance,
  );
  assert.equal(cagr.status, "calculated");
  if (cagr.status === "calculated") {
    assert.ok(Math.abs(cagr.value - ((74670 / 67347.36) - 1) * 100) < 1e-10);
    assert.equal(cagr.inputs.length, 2);
  }
});

test("returns a bank-appropriate financial snapshot with industrial ratios marked not applicable", async () => {
  const history = await getHistory();
  const analysis = buildFundamentalsAnalysis(history);
  assert.equal(analysis.companyType, "FINANCIAL_INSTITUTION");
  assert.equal(analysis.financialStatements, analysis.statements);
  assert.equal(
    analysis.dataQuality.sourceMode,
    "CURATED_OFFICIAL_DISCLOSURE_SNAPSHOT",
  );
  assert.equal(analysis.dataQuality.classification, "HISTORICAL");
  assert.equal(analysis.dataQuality.reportingPeriodCount, 6);
  assert.equal(analysis.dataQuality.annualPeriodCount, 3);
  assert.equal(analysis.statements.cashFlowStatement.status, "unavailable");
  assert.ok(analysis.statements.cashFlowStatement.reason);
  assert.ok(analysis.ratios.some((metric) => metric.id === "roe"));
  assert.ok(analysis.trends.some((metric) => metric.id === "profitAfterTaxCagr"));
  assert.ok(
    analysis.notApplicableMetrics.some((metric) => metric.metricId === "ebitda"),
  );
  assert.equal(analysis.valuationInputs.currentPrice.status, "unavailable");
  assert.equal(analysis.valuationInputs.pe.status, "unavailable");
  assert.equal(analysis.valuationInputs.pb.status, "unavailable");
  assert.equal(analysis.dataStatus, "partial");
});

test("excludes the merger-transition year from comparable annual CAGR", async () => {
  const history = await getHistory();
  const analysis = buildFundamentalsAnalysis(history);
  const cagr = getMetric(analysis.trends, "profitAfterTaxCagr", "fy2025-26");
  assert.equal(cagr.status, "calculated");
  if (cagr.status !== "calculated") {
    throw new Error("Expected three-period PAT CAGR to be calculated.");
  }
  assert.deepEqual(
    cagr.inputs.map((input) => input.provenance.period.label),
    ["FY2024-25", "FY2025-26"],
  );
  assert.ok(
    analysis.dataQuality.limitations.some((limitation) =>
      /three-year trend coverage is incomplete/i.test(limitation),
    ),
  );
});

test("keeps growth unavailable across structurally non-comparable periods", async () => {
  const history = await getHistory();
  const patGrowth = getMetric(
    history.growthMetrics,
    "profitAfterTaxGrowthYoY",
    "fy2024-25",
  );
  assert.equal(patGrowth.status, "unavailable");
  assert.match(patGrowth.reason, /structurally non-comparable/i);
});

test("calculates P/E and P/B only from supplied market price and verified share inputs", async () => {
  const history = await getHistory();
  const latestAnnualEps = getMetric(
    history.financials,
    "basicEps",
    "fy2025-26",
  );
  const latestNetWorth = getMetric(
    history.bankMetrics,
    "totalNetWorth",
    "q1-fy2026-27",
  );
  assert.equal(latestAnnualEps.status, "unavailable");
  assert.equal(latestNetWorth.status, "reported");
  if (
    latestAnnualEps.status !== "unavailable" ||
    latestNetWorth.status !== "reported"
  ) {
    throw new Error("Expected a missing EPS and reported closing net worth.");
  }
  const annualPeriod = history.periods.find(
    (period) => period.id === "fy2025-26",
  );
  assert.ok(annualPeriod);
  const eps = reportedMetric(
    "basicEps",
    "fy2025-26",
    100,
    {
      ...latestAnnualEps.provenance,
      period: annualPeriod,
    },
  );
  const shares = reportedMetric(
    "sharesOutstanding",
    "q1-fy2026-27",
    760,
    {
      ...latestNetWorth.provenance,
      unit: "CRORE_SHARES",
      currency: null,
    },
  );
  const valuationHistory = {
    ...history,
    financials: [
      ...history.financials.filter(
        (metric) =>
          !(
            (metric.id === "basicEps" && metric.periodId === "fy2025-26") ||
            (metric.id === "sharesOutstanding" &&
              metric.periodId === "q1-fy2026-27")
          ),
      ),
      eps,
      shares,
    ],
  };
  const quote: MarketQuote = {
    source: "Test market quote",
    sourceType: "unofficial",
    sourceUrl: "https://query1.finance.yahoo.com",
    retrievedAt: "2026-09-28T10:00:00Z",
    provider: "yahoo",
    instrument: "HDFCBANK.NS",
    ticker: "HDFCBANK.NS",
    symbol: "HDFCBANK.NS",
    exchange: "NSE",
    asOf: "2026-09-28T10:00:00Z",
    marketTimestamp: "2026-09-28T10:00:00Z",
    open: 1195,
    high: 1220,
    low: 1180,
    dataStatus: "UNKNOWN",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus: "UNKNOWN",
    isUnofficial: true,
    licenseStatus: "UNKNOWN",
    companyId: "hdfc-test",
    price: 1200,
    previousClose: 1190,
    change: 10,
    changePercent: (10 / 1190) * 100,
    dayHigh: null,
    dayLow: null,
    volume: null,
    currency: "INR",
  };
  const analysis = buildFundamentalsAnalysis(valuationHistory, quote);
  assert.equal(analysis.valuationInputs.pe.status, "calculated");
  assert.equal(analysis.valuationInputs.pe.value, 12);
  assert.equal(analysis.valuationInputs.pb.status, "calculated");
  assert.equal(
    analysis.valuationInputs.pb.value,
    1200 / (latestNetWorth.value / 760),
  );
  assert.equal(analysis.valuationInputs.pe.inputs?.length, 2);
  assert.equal(analysis.valuationInputs.pb.inputs?.length, 2);

  const usdQuote = { ...quote, currency: "USD" };
  const usdQuoteAnalysis = buildFundamentalsAnalysis(valuationHistory, usdQuote);
  assert.equal(usdQuoteAnalysis.valuationInputs.currentPrice.unit, "USD_PER_SHARE");
  assert.equal(usdQuoteAnalysis.valuationInputs.currentPrice.currency, "USD");
  assert.equal(usdQuoteAnalysis.valuationInputs.pe.status, "unavailable");
  assert.equal(usdQuoteAnalysis.valuationInputs.pb.status, "unavailable");

  const zeroEps = reportedMetric(
    "basicEps",
    "fy2025-26",
    0,
    {
      ...latestAnnualEps.provenance,
      period: annualPeriod,
    },
  );
  const zeroEpsAnalysis = buildFundamentalsAnalysis(
    {
      ...valuationHistory,
      financials: [
        ...valuationHistory.financials.filter(
          (metric) =>
            metric.id !== "basicEps" || metric.periodId !== "fy2025-26",
        ),
        zeroEps,
      ],
    },
    quote,
  );
  assert.equal(zeroEpsAnalysis.valuationInputs.pe.status, "unavailable");
});

test("returns unavailable ROA rather than dividing by zero", async () => {
  const history = await getHistory();
  const pat = getMetric(
    history.financials,
    "profitAfterTax",
    "q1-fy2026-27",
  );
  const assets = getMetric(
    history.bankMetrics,
    "totalAssets",
    "q1-fy2026-27",
  );
  assert.equal(pat.status, "reported");
  assert.equal(assets.status, "reported");
  if (pat.status !== "reported" || assets.status !== "reported") {
    throw new Error("Expected reported PAT and total assets.");
  }
  const zeroOpening = reportedMetric(
    "openingTotalAssets",
    "q1-fy2026-27",
    0,
    {
      ...assets.provenance,
      period: {
        id: "opening-assets",
        periodType: "instant",
        periodStart: null,
        periodEnd: "2026-03-31",
        label: "As at March 31, 2026",
      },
    },
  );
  const zeroClosing = reportedMetric(
    "closingTotalAssets",
    "q1-fy2026-27",
    0,
    assets.provenance,
  );
  const result = calculateRoa(
    "roa",
    "q1-fy2026-27",
    pat,
    zeroOpening,
    zeroClosing,
    {
      ...assets.provenance,
      sourceId: null,
      source: "EquityMind deterministic test calculation",
      sourceType: "calculated",
      unit: "PERCENT",
      currency: null,
      sectionReference: "ROA zero-denominator test",
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.value, null);
  if (result.status === "unavailable") {
    assert.match(result.reason, /not positive/i);
  }
});
