import {
  SupabaseDatabaseError,
} from "@/lib/repositories/supabase-database-repository";
import { databaseService } from "@/lib/services/database-service";

export async function GET() {
  try {
    const result = await databaseService.checkSupabaseConnection();
    return Response.json(
      {
        provider: "supabase",
        status: "connected",
        query: "companies.select",
        checkedAt: result.checkedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SupabaseDatabaseError) {
      return Response.json(
        {
          provider: "supabase",
          status: "unavailable",
          code: error.failure,
          error: error.message,
          upstreamStatus: error.upstreamStatus,
        },
        {
          status:
            error.failure === "query_failed" ? 502 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    console.error("[supabase] Unexpected database health failure.", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      {
        provider: "supabase",
        status: "unavailable",
        code: "query_failed",
        error: "The Supabase database query failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
