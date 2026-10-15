import "server-only";

import { createHash } from "node:crypto";
import { buildEquityAnalysisPrompt } from "@/lib/ai/prompts/equity-analysis";
import {
  GeminiProvider,
  GeminiProviderError,
} from "@/lib/ai/gemini-provider";
import { SupabaseDatabaseRepository } from "@/lib/repositories/supabase-database-repository";
import { buildResearchContext } from "@/lib/services/research-context";
import type {
  AIResearchResult,
  Company,
  CompanyMarketSnapshot,
  EquityAnalysis,
  MarketPrice,
} from "@/lib/types/financial";
import type { FundamentalsAnalysis } from "@/lib/types/fundamentals";

/*
 * A documented text-generation model with free-tier availability.
 *
 * Gemini API keys do NOT contain the model name.
 * The model is selected separately through GEMINI_MODEL.
 */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

function stripRetrievalTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripRetrievalTimestamps);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "retrievedAt" && key !== "latestDataRetrievedAt",
      )
      .map(([key, nestedValue]) => [
        key,
        stripRetrievalTimestamps(nestedValue),
      ]),
  );
}

function analysisPromptHash(prompt: string): string {
  const parsedPrompt: unknown = JSON.parse(prompt);
  const normalizedPrompt = JSON.stringify(
    stripRetrievalTimestamps(parsedPrompt),
  );
  return createHash("sha256").update(normalizedPrompt).digest("hex");
}

function createProvider(): GeminiProvider {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new GeminiProviderError(
      "Gemini is not configured. Set GEMINI_API_KEY on the server.",
      "not_configured",
    );
  }

  return new GeminiProvider(
    apiKey,
    getConfiguredModelName(),
  );
}

function getConfiguredModelName(): string {
  return (
    process.env.GEMINI_MODEL?.trim() ||
    DEFAULT_GEMINI_MODEL
  );
}

export class AIResearchService {
  getModelName(): string {
    return getConfiguredModelName();
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.GEMINI_API_KEY?.trim(),
    );
  }

  async analyzeCompany(
    company: Company,
    snapshot: CompanyMarketSnapshot | null,
    historicalPrices: MarketPrice[],
    fundamentals: FundamentalsAnalysis | null = null,
    marketUnavailableReason =
      "Market data is unavailable.",
  ): Promise<AIResearchResult> {
    const context = buildResearchContext(
      company,
      snapshot,
      historicalPrices,
      fundamentals,
      marketUnavailableReason,
    );

    const provider = createProvider();
    const prompt = buildEquityAnalysisPrompt(context);

    const analysis: EquityAnalysis =
      await provider.analyzeEquityResearch(
        prompt,
      );

    const analyzedAt = new Date().toISOString();

    const dataTimestamps = [
      ...(snapshot
        ? [
            snapshot.quote.retrievedAt,
            snapshot.company.retrievedAt,
          ]
        : []),

      ...historicalPrices.map(
        (price) => price.retrievedAt,
      ),

      ...(fundamentals?.provenance.map(
        (source) => source.retrievedAt,
      ) ?? []),
    ].sort();

    const result: AIResearchResult = {
      company,

      modelName: provider.modelName,

      analyzedAt,

      status: "response_received",

      suppliedData: {
        marketDataAvailable: snapshot !== null,

        marketProvider:
          snapshot?.quote.provider ?? null,

        marketSource:
          snapshot?.quote.source ?? null,

        marketAsOf:
          snapshot?.quote.marketTimestamp ?? null,

        historicalPriceCount:
          historicalPrices.length,

        fundamentalsAvailable:
          fundamentals !== null,

        fundamentalsStatus:
          fundamentals?.dataStatus ?? null,

        reportingPeriods:
          fundamentals?.periods.map(
            (period) => period.label,
          ) ?? [],

        financialSources:
          fundamentals?.provenance.map(
            (source) => ({
              source: source.source,
              sourceUrl: source.sourceUrl,
              publicationDate:
                source.publicationDate,
              retrievedAt:
                source.retrievedAt,
            }),
          ) ?? [],

        latestDataRetrievedAt:
          dataTimestamps.at(-1) ?? null,
      },

      analysis,

      source: "Google Gemini API",

      sourceType: "ai_generated",

      sourceUrl: null,

      retrievedAt: analyzedAt,
    };

    try {
      await new SupabaseDatabaseRepository().persistAIAnalysis(
        result,
        analysisPromptHash(prompt),
      );
    } catch {
      console.warn("[ai-analysis] Persistence was skipped.");
    }

    return result;
  }
}