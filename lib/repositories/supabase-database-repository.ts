import type {
  AIResearchResult,
  Company,
  MarketPrice,
} from "../types/financial.ts";
import {
  logPersistenceFailure,
  persistenceErrorCode,
  type PersistenceFailureContext,
} from "../services/persistence-logging.ts";
import { SupabasePersistenceConfigurationError } from "../supabase/persistence-client-options.ts";
import type { createSupabasePersistenceServerClient } from "../supabase/persistence-server.ts";

export type SupabaseDatabaseFailure =
  | "not_configured"
  | "invalid_configuration"
  | "migration_not_applied"
  | "access_denied"
  | "upstream_unavailable"
  | "query_failed";

export class SupabaseDatabaseError extends Error {
  readonly failure: SupabaseDatabaseFailure;
  readonly upstreamStatus: number | null;

  constructor(
    message: string,
    failure: SupabaseDatabaseFailure,
    upstreamStatus: number | null = null,
  ) {
    super(message);
    this.name = "SupabaseDatabaseError";
    this.failure = failure;
    this.upstreamStatus = upstreamStatus;
  }
}

class PersistenceOperationError extends Error {
  readonly context: PersistenceFailureContext;
  readonly postgresErrorCode: string;

  constructor(context: PersistenceFailureContext, postgresErrorCode: string) {
    super("Supabase persistence operation failed.");
    this.name = "PersistenceOperationError";
    this.context = context;
    this.postgresErrorCode = postgresErrorCode;
  }
}

const pendingAnalysisWrites = new Map<string, Promise<void>>();
type PersistenceClient = ReturnType<
  typeof createSupabasePersistenceServerClient
>;

function errorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const code = error.code;
  if (
    typeof code === "string" &&
    (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d{3}$/.test(code))
  ) {
    return code;
  }
  if (isRecord(error.error)) {
    return errorCode(error.error);
  }
  return null;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  for (const value of [error.status, error.statusCode]) {
    if (typeof value === "number" && value >= 100 && value <= 599) {
      return value;
    }
    if (
      typeof value === "string" &&
      /^\d{3}$/.test(value) &&
      Number(value) >= 100 &&
      Number(value) <= 599
    ) {
      return Number(value);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function networkErrorCode(error: unknown, depth = 0): string | null {
  if (!isRecord(error) || depth > 4) {
    return null;
  }
  const code = error.code;
  if (
    typeof code === "string" &&
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(code)
  ) {
    return code;
  }
  return networkErrorCode(error.cause, depth + 1);
}

export function classifySupabaseHealthFailure(
  error: unknown,
): SupabaseDatabaseFailure {
  const code = errorCode(error);
  if (code === "42P01" || code === "PGRST205") {
    return "migration_not_applied";
  }
  if (code === "42501" || code === "PGRST301") {
    return "access_denied";
  }
  const status = errorStatus(error);
  if (status === 401 || status === 403) {
    return "access_denied";
  }
  if ((status !== null && status >= 500) || status === 408 || status === 429) {
    return "upstream_unavailable";
  }
  if (
    error instanceof TypeError ||
    networkErrorCode(error) !== null ||
    (isRecord(error) &&
      (error.name === "AbortError" ||
        error.name === "TimeoutError"))
  ) {
    return "upstream_unavailable";
  }
  const diagnosticText = [
    isRecord(error) ? error.message : null,
    isRecord(error) && isRecord(error.error) ? error.error.message : null,
    isRecord(error) && isRecord(error.cause) ? error.cause.message : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (
    /\b(fetch failed|network|connection (?:refused|reset|timed out)|dns|timeout|timed out|econnrefused|econnreset|enotfound|etimedout)\b/.test(
      diagnosticText,
    )
  ) {
    return "upstream_unavailable";
  }
  if (
    /\b(relation .* does not exist|table .* not found|schema cache.*not.*companies)\b/.test(
      diagnosticText,
    )
  ) {
    return "migration_not_applied";
  }
  if (/\b(permission denied|not authorized|access denied)\b/.test(diagnosticText)) {
    return "access_denied";
  }
  return "query_failed";
}

function safeDiagnosticFields(error: unknown): string[] {
  if (!isRecord(error)) {
    return [];
  }
  const allowedFields = new Set([
    "code",
    "status",
    "statusCode",
    "message",
    "details",
    "hint",
    "name",
    "cause",
    "error",
  ]);
  return Object.keys(error).filter((key) => allowedFields.has(key)).sort();
}

function failureMessage(failure: SupabaseDatabaseFailure): string {
  switch (failure) {
    case "not_configured":
      return "Supabase server persistence is not configured. Set the project URL and server-only secret key.";
    case "invalid_configuration":
      return "The configured Supabase project URL is invalid.";
    case "migration_not_applied":
      return "The Supabase companies table is unavailable. Apply the existing project migration after review.";
    case "access_denied":
      return "Supabase denied the server health check. Review the server key permissions and database grants.";
    case "upstream_unavailable":
      return "Supabase could not be reached. Check project availability and network connectivity.";
    case "query_failed":
      return "The Supabase health query failed. Check server diagnostics for the safe error category.";
  }
}

function safeErrorCode(error: unknown): string {
  return errorCode(error) ?? "none";
}

function databaseError(
  error: unknown,
  operation: string,
): SupabaseDatabaseError {
  const failure = classifySupabaseHealthFailure(error);
  const upstreamStatus = errorStatus(error);
  console.error(`[supabase] ${operation} failed.`, {
    failure,
    postgresErrorCode: safeErrorCode(error),
    upstreamStatus,
    networkErrorCode: networkErrorCode(error),
    errorName: error instanceof Error ? error.name : "unknown",
    diagnosticFields: safeDiagnosticFields(error),
  });
  return new SupabaseDatabaseError(
    failureMessage(failure),
    failure,
    upstreamStatus,
  );
}

export class SupabaseDatabaseRepository {
  private readonly createPersistenceClient: () => Promise<PersistenceClient>;

  constructor(
    createPersistenceClient: () => Promise<PersistenceClient> = async () => {
      const { createSupabasePersistenceServerClient } = await import(
        "../supabase/persistence-server.ts"
      );
      return createSupabasePersistenceServerClient();
    },
  ) {
    this.createPersistenceClient = createPersistenceClient;
  }

  private persistenceError(
    error: unknown,
    context: PersistenceFailureContext,
  ): PersistenceOperationError {
    return new PersistenceOperationError(context, persistenceErrorCode(error));
  }

  private async upsertCompany(
    client: PersistenceClient,
    company: Company,
    repositoryOperation: string,
  ): Promise<string> {
    const { error: upsertError } = await client.from("companies").upsert(
      {
        ticker: company.ticker,
        exchange: company.exchange,
        name: company.name,
        country_code: company.countryCode,
        currency: company.currency,
        sector: company.sector,
        industry: company.industry,
        market_cap:
          company.marketCap !== null && Number.isFinite(company.marketCap)
            ? company.marketCap
            : null,
        is_active: company.isActive,
        source: company.source,
        source_type: company.sourceType,
        source_url: company.sourceUrl,
        retrieved_at: company.retrievedAt,
      },
      { onConflict: "exchange,ticker", ignoreDuplicates: true },
    );
    if (upsertError) {
      throw this.persistenceError(upsertError, {
        repositoryOperation,
        targetTable: "companies",
        operationType: "UPSERT",
      });
    }

    const { data, error: lookupError } = await client
      .from("companies")
      .select("id")
      .eq("exchange", company.exchange)
      .eq("ticker", company.ticker)
      .maybeSingle();
    if (lookupError) {
      throw this.persistenceError(lookupError, {
        repositoryOperation,
        targetTable: "companies",
        operationType: "SELECT",
      });
    }
    if (!data?.id) {
      throw new Error("Company row was not available after persistence.");
    }
    return data.id;
  }

  async persistCompany(company: Company): Promise<string | null> {
    if (company.sourceType === "demo" || company.dataStatus === "DEMO") {
      return null;
    }

    try {
      const client = await this.createPersistenceClient();
      return await this.upsertCompany(client, company, "persistCompany");
    } catch (error) {
      this.logSkippedPersistence(error, {
        repositoryOperation: "persistCompany",
        targetTable: "companies",
        operationType: "UPSERT",
      });
      return null;
    }
  }

  async persistMarketPrices(
    company: Company,
    prices: MarketPrice[],
  ): Promise<void> {
    if (
      company.sourceType === "demo" ||
      company.dataStatus === "DEMO" ||
      prices.length === 0
    ) {
      return;
    }

    try {
      const client = await this.createPersistenceClient();
      const companyId = await this.upsertCompany(
        client,
        company,
        "persistMarketPrices",
      );
      const rows = prices
        .filter(
          (price) =>
            price.sourceType !== "demo" &&
            price.dataStatus !== "DEMO" &&
            Number.isFinite(price.close) &&
            price.close >= 0,
        )
        .map((price) => ({
          company_id: companyId,
          trade_date: price.date,
          currency: price.currency,
          open: price.open,
          high: price.high,
          low: price.low,
          close: price.close,
          adjusted_close: price.adjustedClose,
          volume:
            price.volume !== null &&
            Number.isSafeInteger(price.volume) &&
            price.volume >= 0
              ? price.volume
              : null,
          source: price.source,
          source_type: price.sourceType,
          source_url: price.sourceUrl,
          retrieved_at: price.retrievedAt,
        }));

      if (rows.length === 0) {
        return;
      }

      const { error } = await client.from("market_prices").upsert(rows, {
        onConflict: "company_id,trade_date,source",
        ignoreDuplicates: true,
      });
      if (error) {
        throw this.persistenceError(error, {
          repositoryOperation: "persistMarketPrices",
          targetTable: "market_prices",
          operationType: "UPSERT",
        });
      }
    } catch (error) {
      this.logSkippedPersistence(error, {
        repositoryOperation: "persistMarketPrices",
        targetTable: "market_prices",
        operationType: "UPSERT",
      });
    }
  }

  async persistAIAnalysis(
    result: AIResearchResult,
    promptHash: string,
  ): Promise<void> {
    const key = `${result.company.exchange}:${result.company.ticker}:${result.modelName}:${promptHash}`;
    const pending = pendingAnalysisWrites.get(key);
    if (pending) {
      return pending;
    }

    const write = this.writeAIAnalysis(result, promptHash).finally(() => {
      pendingAnalysisWrites.delete(key);
    });
    pendingAnalysisWrites.set(key, write);
    return write;
  }

  private async writeAIAnalysis(
    result: AIResearchResult,
    promptHash: string,
  ): Promise<void> {
    try {
      const client = await this.createPersistenceClient();
      const companyId = await this.upsertCompany(
        client,
        result.company,
        "persistAIAnalysis",
      );
      const analysis = result.analysis;
      const row = {
        company_id: companyId,
        analysis_type: "equity_research",
        model_name: result.modelName,
        summary: analysis.executiveSummary,
        key_findings: [
          analysis.businessQuality,
          analysis.financialStrength,
          analysis.valuationObservation,
        ],
        risks: [...analysis.keyRisks, ...analysis.redFlags],
        catalysts: analysis.catalysts,
        prompt_hash: promptHash,
        source: result.source,
        source_type: result.sourceType,
        source_url: result.sourceUrl,
        retrieved_at: result.retrievedAt,
        expires_at: new Date(
          new Date(result.analyzedAt).getTime() + 6 * 60 * 60 * 1000,
        ).toISOString(),
      };

      const { data: existing, error: lookupError } = await client
        .from("ai_analysis")
        .select("id")
        .eq("company_id", companyId)
        .eq("analysis_type", row.analysis_type)
        .eq("model_name", result.modelName)
        .eq("prompt_hash", promptHash)
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        throw this.persistenceError(lookupError, {
          repositoryOperation: "persistAIAnalysis",
          targetTable: "ai_analysis",
          operationType: "SELECT",
        });
      }

      const { error } = existing
        ? await client.from("ai_analysis").update(row).eq("id", existing.id)
        : await client.from("ai_analysis").insert(row);
      if (error) {
        throw this.persistenceError(error, {
          repositoryOperation: "persistAIAnalysis",
          targetTable: "ai_analysis",
          operationType: existing ? "UPDATE" : "INSERT",
        });
      }
    } catch (error) {
      this.logSkippedPersistence(error, {
        repositoryOperation: "persistAIAnalysis",
        targetTable: "ai_analysis",
        operationType: "INSERT",
      });
    }
  }

  private logSkippedPersistence(
    error: unknown,
    fallbackContext: PersistenceFailureContext,
  ): void {
    const context =
      error instanceof PersistenceOperationError
        ? error.context
        : fallbackContext;
    logPersistenceFailure(error, context);
  }

  async checkConnection(): Promise<{ checkedAt: string }> {
    let client: PersistenceClient;
    try {
      client = await this.createPersistenceClient();
    } catch (error) {
      if (error instanceof SupabasePersistenceConfigurationError) {
        throw new SupabaseDatabaseError(
          failureMessage(error.failure),
          error.failure,
        );
      }
      throw databaseError(error, "Database health client initialization");
    }

    try {
      const { error } = await client
        .from("companies")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (error) {
        throw databaseError(error, "Database health query");
      }
    } catch (error) {
      if (error instanceof SupabaseDatabaseError) {
        throw error;
      }
      throw databaseError(error, "Database health query");
    }

    return { checkedAt: new Date().toISOString() };
  }
}
