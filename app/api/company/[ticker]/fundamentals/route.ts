import { MarketDataError } from "@/lib/providers/market-data-error";
import { getRequestMarketDataService } from "@/lib/services/market-data";
import { fundamentalsService } from "@/lib/services/fundamentals";
import type { MarketQuote } from "@/lib/types/financial";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const marketDataService = await getRequestMarketDataService();
  let quote: MarketQuote | null = null;
  let marketUnavailableReason =
    "Current market price is unavailable from the configured market-data provider.";
  try {
    const snapshot = await marketDataService.getCompanySnapshot(ticker);
    quote = snapshot?.quote ?? null;
    if (!snapshot) {
      marketUnavailableReason =
        "No market quote is available for this ticker from the configured provider.";
    }
  } catch (error) {
    if (!(error instanceof MarketDataError)) {
      throw error;
    }
    marketUnavailableReason = error.message;
  }

  const fundamentals = await fundamentalsService.getCompanyAnalysis(
    ticker,
    quote,
    marketUnavailableReason,
  );

  if (!fundamentals) {
    return Response.json(
      {
        error: "Verified fundamentals are not available for this company.",
        code: "fundamentals_not_supported",
        ticker,
        dataStatus: "UNAVAILABLE",
      },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(fundamentals, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
