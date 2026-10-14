import type {
  FinancialValue,
  FundamentalMetric,
  FinancialSnapshot,
  FundamentalsAnalysis,
} from "@/lib/types/fundamentals";

interface FundamentalsPanelProps {
  fundamentals: FundamentalsAnalysis | null;
  isLoading: boolean;
  error: string | null;
}

const trendRows = [
  ["Profit after tax", "profitAfterTax", "financials"],
  ["Net interest income", "netInterestIncome", "bankMetrics"],
  ["Profit before tax", "profitBeforeTax", "financials"],
  ["EPS (basic)", "basicEps", "financials"],
  ["Total deposits", "totalDeposits", "bankMetrics"],
  ["Gross advances / loans", "grossAdvances", "bankMetrics"],
  ["ROA", "roa", "bankMetrics"],
  ["ROE", "roe", "bankMetrics"],
  ["Gross NPA", "grossNpaRatio", "bankMetrics"],
  ["Net NPA", "netNpaRatio", "bankMetrics"],
  ["CASA", "casaRatio", "bankMetrics"],
  ["NIM", "netInterestMargin", "bankMetrics"],
  ["CET1", "cet1Ratio", "bankMetrics"],
  ["Capital adequacy", "capitalAdequacyRatio", "bankMetrics"],
  ["Total assets", "totalAssets", "bankMetrics"],
  ["Total equity / net worth", "totalNetWorth", "bankMetrics"],
] as const;

function formatMetric(metric: FundamentalMetric): string {
  if (metric.status === "unavailable") {
    return "Not available from verified source";
  }

  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(metric.value);

  switch (metric.provenance.unit) {
    case "INR_CRORE":
      return `₹${formatted} cr`;
    case "INR_BILLION":
      return `₹${formatted} bn`;
    case "INR_PER_SHARE":
      return `₹${formatted}`;
    case "CRORE_SHARES":
      return `${formatted} cr shares`;
    case "USD_MILLION":
      return `$${formatted} mm`;
    case "USD_BILLION":
      return `$${formatted} bn`;
    case "USD_PER_SHARE":
      return `$${formatted}`;
    case "CURRENCY_PER_SHARE":
      return `${metric.provenance.currency ?? "Unknown currency"} ${formatted}`;
    case "BILLION_SHARES":
      return `${formatted} bn shares`;
    case "PERCENT":
      return `${formatted}%`;
    case "YEARS":
      return `${formatted} years`;
  }
}

function statusClass(status: FundamentalMetric["status"]): string {
  switch (status) {
    case "reported":
      return "text-[#8bc5d7]";
    case "calculated":
      return "text-[#efc86b]";
    case "unavailable":
      return "text-[#8d98a8]";
  }
}

function formatFinancialValue(value: FinancialValue): string {
  if (value.status === "unavailable" || value.value === null) {
    return "N/A · Insufficient verified data";
  }
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(value.value);
  switch (value.unit) {
    case "INR_CRORE":
      return `₹${formatted} cr`;
    case "INR_BILLION":
      return `₹${formatted} bn`;
    case "INR_PER_SHARE":
      return `₹${formatted}`;
    case "USD_MILLION":
      return `$${formatted} mm`;
    case "USD_BILLION":
      return `$${formatted} bn`;
    case "USD_PER_SHARE":
      return `$${formatted}`;
    case "CURRENCY_PER_SHARE":
      return `${value.currency ?? "Unknown currency"} ${formatted}`;
    case "PERCENT":
      return `${formatted}%`;
    case "MULTIPLE":
      return `${formatted}x`;
    case "CRORE_SHARES":
      return `${formatted} cr shares`;
    case "BILLION_SHARES":
      return `${formatted} bn shares`;
    case "YEARS":
      return `${formatted} years`;
  }
}

function financialValueStatusClass(status: FinancialValue["status"]): string {
  switch (status) {
    case "available":
      return "text-[#8bc5d7]";
    case "calculated":
      return "text-[#efc86b]";
    case "unavailable":
    case "not_applicable":
      return "text-[#8d98a8]";
  }
}

function findMetric(
  fundamentals: FundamentalsAnalysis,
  collection: "financials" | "bankMetrics",
  id: string,
  periodId: string,
): FundamentalMetric | undefined {
  return fundamentals[collection].find(
    (metric) => metric.id === id && metric.periodId === periodId,
  );
}

function TrendCell({ metric }: { metric: FundamentalMetric | undefined }) {
  if (!metric) {
    return (
      <td className="min-w-36 border-t border-[#1a2129] p-2 text-[10px] text-[#8d98a8]">
        Not available from verified source
      </td>
    );
  }
  return (
    <td className="min-w-36 border-t border-[#1a2129] p-2 align-top">
      <div className="text-[11px] font-medium text-[#edf3f8]">
        {formatMetric(metric)}
      </div>
      <div className={`mt-1 text-[8px] uppercase tracking-[0.12em] ${statusClass(metric.status)}`}>
        {metric.status}
      </div>
      <a
        href={metric.provenance.sourceUrl}
        target="_blank"
        rel="noreferrer"
        title={`${metric.provenance.source} · ${metric.provenance.sectionReference} · published ${metric.provenance.publicationDate}`}
        className="mt-1 inline-block text-[9px] text-[#9fc2ff] underline underline-offset-2"
      >
        Source · p. {metric.provenance.pageReference}
      </a>
      {metric.status === "unavailable" ? (
        <p className="mt-1 text-[9px] leading-4 text-[#778391]">
          {metric.reason}
        </p>
      ) : metric.formula ? (
        <details className="mt-1 text-[9px] text-[#8d98a8]">
          <summary className="cursor-pointer">Formula and inputs</summary>
          <p className="mt-1">{metric.formula}</p>
          {metric.inputs?.map((input) => (
            <div key={`${input.id}:${input.periodId}`}>
              {input.id}: {input.value} {input.provenance.unit} ·{" "}
              {input.provenance.period.label}
            </div>
          ))}
        </details>
      ) : null}
    </td>
  );
}

export function FundamentalsPanel({
  fundamentals,
  isLoading,
  error,
}: FundamentalsPanelProps) {
  if (!fundamentals) {
    return (
      <div className="rounded-[16px] border border-[#1a2129] bg-[#0d1318] p-4">
        <div className="text-[10px] uppercase tracking-[0.24em] text-[#7d8896]">
          Fundamentals trend
        </div>
        <p className="mt-3 text-sm text-[#aab5c1]" role={error ? "status" : undefined}>
          {isLoading
            ? "Loading verified company fundamentals…"
            : error ?? "Not available from verified source"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[14px] border border-[#1a2129] bg-[#10171d] px-3 py-2 text-[10px] text-[#8d98a8]">
        {fundamentals.company.companyName} · {fundamentals.company.exchange} ·{" "}
        {fundamentals.companyType === "FINANCIAL_INSTITUTION"
          ? "financial institution"
          : "general company"}{" "}
        · {fundamentals.company.reportingBasis} · official company disclosures.
        Each cell links to its source; currency amounts retain the disclosure&apos;s
        stated units.
      </div>
      <section className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
            Data quality · {fundamentals.dataQuality.classification}
          </h3>
          <span className="text-[9px] uppercase tracking-[0.15em] text-[#8d98a8]">
            {fundamentals.dataQuality.status} ·{" "}
            {fundamentals.dataQuality.sourceMode === "SEC_COMPANYFACTS"
              ? "SEC EDGAR company facts"
              : "curated disclosure snapshot"}
          </span>
        </div>
        <div className="mt-2 grid gap-2 text-[10px] text-[#aab5c1] sm:grid-cols-2 xl:grid-cols-4">
          <div>
            Reporting periods: {fundamentals.dataQuality.reportingPeriodCount} (
            {fundamentals.dataQuality.annualPeriodCount} annual)
          </div>
          <div>Sources: {fundamentals.dataQuality.sourceCount}</div>
          <div>
            Reported / calculated / unavailable:{" "}
            {fundamentals.dataQuality.metricCounts.reported} /{" "}
            {fundamentals.dataQuality.metricCounts.calculated} /{" "}
            {fundamentals.dataQuality.metricCounts.unavailable}
          </div>
          <div>
            Retrieved:{" "}
            {fundamentals.dataQuality.latestRetrievedAt
              ? new Date(
                  fundamentals.dataQuality.latestRetrievedAt,
                ).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                }) + " IST"
              : "Unavailable"}
          </div>
        </div>
        {fundamentals.dataQuality.limitations.length > 0 ? (
          <details className="mt-2 text-[9px] text-[#8d98a8]">
            <summary className="cursor-pointer">
              Data limitations ({fundamentals.dataQuality.limitations.length})
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {fundamentals.dataQuality.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
            Deterministic financial snapshot · latest reporting period
          </h3>
          <span className="text-[9px] uppercase tracking-[0.15em] text-[#8d98a8]">
            {fundamentals.dataStatus}
          </span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(Object.entries(fundamentals.financialSnapshot) as Array<
            [keyof FinancialSnapshot, FundamentalMetric[]]
          >).map(
            ([category, metrics]) => (
              <div
                key={category}
                className="rounded-lg border border-[#1a2129] bg-[#10171d] p-2"
              >
                <div className="mb-2 text-[9px] uppercase tracking-[0.15em] text-[#7d8896]">
                  {category.replace(/([A-Z])/g, " $1")}
                </div>
                {metrics.length === 0 ? (
                  <p className="text-[10px] text-[#8d98a8]">
                    N/A · Insufficient verified data
                  </p>
                ) : (
                  <div className="space-y-2">
                    {metrics.map((metric) => (
                      <div
                        key={`${metric.id}:${metric.periodId}`}
                        className="border-t border-[#1a2129] pt-2"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] text-[#c6d0da]">
                            {metric.id}
                          </span>
                          <span className="text-[10px] font-medium text-[#edf3f8]">
                            {formatMetric(metric)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[9px] text-[#8d98a8]">
                            {metric.provenance.period.label}
                          </span>
                          <span
                            className={`text-[8px] uppercase ${statusClass(metric.status)}`}
                          >
                            {metric.status}
                          </span>
                        </div>
                        <a
                          href={metric.provenance.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={`${metric.provenance.source} · ${metric.provenance.sectionReference}`}
                          className="mt-1 inline-block text-[9px] text-[#9fc2ff] underline underline-offset-2"
                        >
                          Source · p. {metric.provenance.pageReference}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-[14px] border border-[#1a2129] bg-[#0d1318]">
        <div className="border-b border-[#1a2129] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
          Fundamentals Trend · reported, calculated and unavailable values
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[9px] uppercase tracking-[0.12em] text-[#8d98a8]">
                <th className="sticky left-0 z-10 min-w-40 bg-[#0d1318] p-2">
                  Metric
                </th>
                {fundamentals.periods.map((period) => (
                  <th className="min-w-36 p-2" key={period.id}>
                    {period.label}
                    <div className="mt-1 font-normal normal-case tracking-normal">
                      {period.periodType}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trendRows.map(([label, id, collection]) => (
                <tr key={id}>
                  <th className="sticky left-0 z-10 border-t border-[#1a2129] bg-[#0d1318] p-2 text-[10px] font-medium text-[#c6d0da]">
                    {label}
                  </th>
                  {fundamentals.periods.map((period) => (
                    <TrendCell
                      key={`${id}:${period.id}`}
                      metric={findMetric(
                        fundamentals,
                        collection,
                        id,
                        period.id,
                      )}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3">
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
          Year-over-year growth · calculated
        </h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {fundamentals.growthMetrics.map((metric) => (
            <div
              key={`${metric.id}:${metric.periodId}`}
              className="border-t border-[#1a2129] pt-2 text-[10px] text-[#c6d0da]"
            >
              <span className="font-medium">{metric.id}</span> ·{" "}
              {fundamentals.periods.find(
                (period) => period.id === metric.periodId,
              )?.label}
              <span className={`ml-2 uppercase ${statusClass(metric.status)}`}>
                {metric.status}
              </span>
              <div className="mt-1">
                {metric.status === "unavailable"
                  ? "Not available from verified source"
                  : formatMetric(metric)}
              </div>
              {metric.status === "unavailable" ? (
                <div className="mt-1 text-[#778391]">{metric.reason}</div>
              ) : null}
              <a
                href={metric.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[9px] text-[#9fc2ff] underline underline-offset-2"
              >
                Calculation/source details
              </a>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3">
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
          Annual trend calculations · up to three available periods
        </h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {fundamentals.trends
            .filter((metric) => metric.id.endsWith("Cagr"))
            .map((metric) => (
              <div
                key={`${metric.id}:${metric.periodId}`}
                className="border-t border-[#1a2129] pt-2 text-[10px]"
              >
                <div className="flex items-baseline justify-between gap-2 text-[#c6d0da]">
                  <span>{metric.id}</span>
                  <span className="text-[#edf3f8]">{formatMetric(metric)}</span>
                </div>
                <div className={`mt-1 uppercase ${statusClass(metric.status)}`}>
                  {metric.status} · {metric.provenance.period.label}
                </div>
                {metric.status === "calculated" ? (
                  <details className="mt-1 text-[9px] text-[#8d98a8]">
                    <summary className="cursor-pointer">Formula and inputs</summary>
                    <p className="mt-1">{metric.formula}</p>
                    {metric.inputs.map((input) => (
                      <div key={`${input.id}:${input.periodId}`}>
                        {input.id}: {input.value} {input.provenance.unit} ·{" "}
                        {input.provenance.period.label}
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            ))}
        </div>
      </section>
      <section className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3">
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#7d8896]">
          Valuation inputs · no intrinsic value calculated
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Object.values(fundamentals.valuationInputs).map((value) => (
            <div
              key={value.id}
              className="border-t border-[#1a2129] pt-2 text-[10px]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[#c6d0da]">{value.id}</span>
                <span className="text-[#edf3f8]">
                  {formatFinancialValue(value)}
                </span>
              </div>
              <div
                className={`mt-1 uppercase ${financialValueStatusClass(value.status)}`}
              >
                {value.status}
                {value.period ? ` · ${value.period.label}` : ""}
              </div>
              {value.reason ? (
                <p className="mt-1 leading-4 text-[#778391]">{value.reason}</p>
              ) : null}
              {value.sourceUrl ? (
                <a
                  href={value.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[9px] text-[#9fc2ff] underline underline-offset-2"
                >
                  Source
                </a>
              ) : null}
              {value.formula ? (
                <details className="mt-1 text-[9px] text-[#8d98a8]">
                  <summary className="cursor-pointer">Formula and inputs</summary>
                  <p className="mt-1">{value.formula}</p>
                  {value.inputs?.map((input) => (
                    <div
                      key={`${input.metricId}:${input.period?.id ?? "market"}`}
                    >
                      {input.metricId}: {input.value} {input.unit} ·{" "}
                      {input.period?.label ?? "market data"} · {input.source}
                    </div>
                  ))}
                </details>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {fundamentals.notApplicableMetrics.length > 0 ? (
        <details className="rounded-[14px] border border-[#1a2129] bg-[#0d1318] p-3 text-[9px] text-[#8d98a8]">
          <summary className="cursor-pointer uppercase tracking-[0.15em]">
            Industrial metrics not applicable to banks
          </summary>
          <ul className="mt-2 space-y-1">
            {fundamentals.notApplicableMetrics.map((metric) => (
              <li key={metric.metricId}>
                {metric.metricId}: {metric.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {fundamentals.warnings.map((warning) => (
        <p
          className="rounded-[12px] border border-[#39311f] bg-[#14120d] px-3 py-2 text-[10px] leading-4 text-[#c1a96c]"
          key={warning}
        >
          {warning}
        </p>
      ))}
    </div>
  );
}
