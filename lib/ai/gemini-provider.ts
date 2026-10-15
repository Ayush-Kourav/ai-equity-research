import "server-only";

import { GoogleGenAI, Type } from "@google/genai";
import type { AIProvider } from "@/lib/ai/ai-provider";
import {
  createGeminiProviderError,
  GeminiProviderError,
} from "@/lib/ai/gemini-errors";
import { parseGeminiAnalysis } from "@/lib/ai/gemini-response";
import { withGeminiTransientRetries } from "@/lib/ai/gemini-retry";
import { EQUITY_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts/equity-analysis";
import type { EquityAnalysis } from "@/lib/types/financial";
export { GeminiProviderError };

const analysisFields = [
  "executiveSummary",
  "businessQuality",
  "financialStrength",
  "growthDrivers",
  "keyRisks",
  "valuationObservation",
  "catalysts",
  "redFlags",
  "researchQuestions",
  "dataLimitations",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  if (typeof error.status === "number") {
    return error.status;
  }
  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (typeof error.status === "string" && /^\d{3}$/.test(error.status)) {
    return Number(error.status);
  }

  if (typeof error.code === "number") {
    return error.code;
  }
  if (typeof error.code === "string" && /^\d{3}$/.test(error.code)) {
    return Number(error.code);
  }

  return null;
}

function getSafeProviderCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const allowedCodes = new Set([
    "INVALID_ARGUMENT",
    "INVALID_REQUEST",
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "RESOURCE_EXHAUSTED",
    "FAILED_PRECONDITION",
    "NOT_FOUND",
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
  ]);
  const candidates = [
    error.code,
    error.status,
    isRecord(error.error) ? error.error.status : null,
    isRecord(error.error) ? error.error.code : null,
  ];
  return (
    candidates.find(
      (value): value is string =>
        typeof value === "string" && allowedCodes.has(value.toUpperCase()),
    ) ?? null
  );
}

export class GeminiProvider implements AIProvider {
  readonly modelName: string;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenAI({
      apiKey,
    });
    this.modelName = modelName;
  }

  async analyzeEquityResearch(
    context: string,
  ): Promise<EquityAnalysis> {
    try {
      console.log("[GeminiProvider] Sending analysis request.");

      const response = await withGeminiTransientRetries((timeoutMs) =>
        this.client.models.generateContent({
        model: this.modelName,
        contents: context,
        config: {
          systemInstruction: EQUITY_ANALYSIS_SYSTEM_PROMPT,

          /*
           * Keep output controlled so the request remains
           * relatively small and fast.
           */
          maxOutputTokens: 2048,

          /*
           * 90 seconds instead of the previous 30-second timeout.
           *
           * The previous implementation aborted the Gemini request
           * after exactly 30 seconds.
           */
          httpOptions: {
            timeout: timeoutMs,
          },

          /*
           * We require machine-readable JSON because the application
           * parses the response into EquityAnalysis.
           */
          responseMimeType: "application/json",

          responseSchema: {
            type: Type.OBJECT,

            properties: {
              executiveSummary: {
                type: Type.STRING,
              },

              businessQuality: {
                type: Type.STRING,
              },

              financialStrength: {
                type: Type.STRING,
              },

              growthDrivers: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },

              keyRisks: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },

              valuationObservation: {
                type: Type.STRING,
              },

              catalysts: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },

              redFlags: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },

              researchQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },

              dataLimitations: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },
            },

            required: [...analysisFields],
          },
        },
        }),
      );

      console.log("[GeminiProvider] Analysis response received.");

      const text = response.text;

      if (!text || !text.trim()) {
        throw new GeminiProviderError(
          "Gemini returned an empty analysis.",
          "invalid_response",
        );
      }

      return parseGeminiAnalysis(text);
    } catch (error) {
      if (error instanceof GeminiProviderError) {
        console.error("[GeminiProvider] Analysis validation failed.", {
          failure: error.failure,
          reason: error.message,
        });
        throw error;
      }

      const structuredError = createGeminiProviderError(error);
      console.error("[GeminiProvider] Request failed.", {
        failure: structuredError.failure,
        status: getErrorStatus(error),
        providerCode: getSafeProviderCode(error),
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw structuredError;
    }
  }
}