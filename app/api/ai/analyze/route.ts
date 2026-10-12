import { GeminiProviderError } from "@/lib/ai/gemini-provider";
import {
  MarketDataError,
  marketDataErrorResponse,
} from "@/lib/providers/market-data-error";
import { getRequestMarketDataService } from "@/lib/services/market-data";
import { AIResearchService } from "@/lib/services/ai-research-service";
import { buildCompanyWithoutMarketData } from "@/lib/services/fundamentals-company";
import { fundamentalsService } from "@/lib/services/fundamentals";
import type { CompanyMarketSnapshot, MarketPrice } from "@/lib/types/financial";

const analysisService = new AIResearchService();
const RATE_LIMIT_MS = 15_000;
let lastRequestAt = 0;

function statusForGeminiError(error: GeminiProviderError): number {
  switch (error.failure) {
    case "not_configured":
      return 503;
    case "rate_limited":
      return 429;
    case "invalid_response":
    case "unavailable":
      return 502;
    default:
      return 502;
  }
}

export async function GET() {
  const configured = analysisService.isConfigured();
  return Response.json({
    status: configured ? "configured" : "not_configured",
    configured,
    model: analysisService.getModelName(),
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("ticker" in body) ||
    typeof body.ticker !== "string" ||
    !body.ticker.trim() ||
    body.ticker.length > 80
  ) {
    return Response.json(
      { error: "A ticker between 1 and 80 characters is required." },
      { status: 400 },
    );
  }

  if (!analysisService.isConfigured()) {
    return Response.json(
      {
        status: "not_configured",
        code: "gemini_not_configured",
        error: "Gemini is not configured. Set GEMINI_API_KEY on the server.",
      },
      { status: 503 },
    );
  }

  const timeUntilAllowed = RATE_LIMIT_MS - (Date.now() - lastRequestAt);

  if (timeUntilAllowed > 0) {
    return Response.json(
      { error: "Please wait before requesting another AI analysis." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(timeUntilAllowed / 1000)) },
      },
    );
  }

  lastRequestAt = Date.now();

  try {
    const marketDataService = await getRequestMarketDataService();
    let snapshot: CompanyMarketSnapshot | null = null;
    let marketUnavailableReason =
      "Current market data is unavailable from the configured provider.";
    try {
      snapshot = await marketDataService.getCompanySnapshot(body.ticker);
      if (!snapshot) {
        marketUnavailableReason =
          "The selected market-data provider does not support this ticker.";
      }
    } catch (error) {
      if (!(error instanceof MarketDataError)) {
        throw error;
      }
      marketUnavailableReason = error.message;
    }

    if (snapshot?.company.dataStatus === "DEMO") {
      return Response.json(
        {
          status: "request_failed",
          error: "AI analysis is disabled for synthetic demo market data.",
          code: "demo_data_not_eligible",
          dataStatus: "DEMO",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    const fundamentals = await fundamentalsService.getCompanyAnalysis(
      body.ticker,
      snapshot?.quote ?? null,
      marketUnavailableReason,
    );
    if (!snapshot && !fundamentals) {
      return Response.json(
        {
          status: "request_failed",
          error: "No market snapshot or verified fundamentals are available for this ticker.",
          code: "company_data_unavailable",
        },
        { status: 404 },
      );
    }

    const company = snapshot?.company ??
      (fundamentals ? buildCompanyWithoutMarketData(fundamentals) : null);
    if (!company) {
      return Response.json(
        {
          status: "request_failed",
          error:
            "Verified fundamentals are available, but the company currency or exchange identity is incomplete or inconsistent.",
          code: "company_identity_unavailable",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    let historicalPrices: MarketPrice[] = [];
    if (snapshot) {
      try {
        historicalPrices =
          (await marketDataService.getHistoricalPrices(
            snapshot.company.ticker,
            "1mo",
          )) ?? [];
      } catch (error) {
        if (!(error instanceof MarketDataError)) {
          throw error;
        }
        marketUnavailableReason = error.message;
      }
    }
    const result = await analysisService.analyzeCompany(
      company,
      snapshot,
      historicalPrices,
      fundamentals,
      marketUnavailableReason,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof GeminiProviderError) {
      return Response.json(
        {
          status: "request_failed",
          code: `gemini_${error.failure}`,
          category: "GEMINI_REQUEST_FAILED",
          error: error.message,
        },
        { status: statusForGeminiError(error) },
      );
    }

    if (error instanceof MarketDataError) {
      return marketDataErrorResponse(error, "Market data is unavailable.");
    }

    return Response.json(
      {
        status: "request_failed",
        code: "analysis_unavailable",
        category: "GEMINI_REQUEST_FAILED",
        error: "AI analysis is unavailable.",
      },
      { status: 502 },
    );
  }
}
