import assert from "node:assert/strict";
import test from "node:test";
import type { Company, MarketPrice } from "../lib/types/financial.ts";
import {
  classifySupabaseHealthFailure,
  SupabaseDatabaseError,
  SupabaseDatabaseRepository,
} from "../lib/repositories/supabase-database-repository.ts";
import {
  createSupabasePersistenceClient,
  SupabasePersistenceConfigurationError,
} from "../lib/supabase/persistence-client-options.ts";
import type { createSupabasePersistenceServerClient } from "../lib/supabase/persistence-server.ts";
import { runBestEffortPersistence } from "../lib/services/persistence-logging.ts";

type PersistenceClient = ReturnType<
  typeof createSupabasePersistenceServerClient
>;

const secretSentinels = [
  "supabase-key-test-secret",
  "fyers-token-test-secret",
  "cookie-test-secret",
];

const company: Company = {
  id: "company-id",
  ticker: "HDFCBANK.NS",
  exchange: "NSE",
  name: "HDFC Bank Limited",
  countryCode: "IN",
  currency: "INR",
  sector: null,
  industry: null,
  marketCap: null,
  isActive: true,
  source: "FYERS",
  sourceType: "public_api",
  sourceUrl: null,
  retrievedAt: "2026-10-05T00:00:00.000Z",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  provider: "fyers",
  instrument: "NSE:HDFCBANK-EQ",
  asOf: "2026-10-05T00:00:00.000Z",
  marketTimestamp: "2026-10-05T00:00:00.000Z",
  dataStatus: "UNKNOWN",
  delaySeconds: null,
  delayStatus: "UNKNOWN",
  marketStatus: "UNKNOWN",
  isUnofficial: false,
  licenseStatus: "REQUIRES_REVIEW",
};

const prices: MarketPrice[] = [
  {
    id: "price-id",
    companyId: company.id,
    date: "2026-10-05",
    currency: "INR",
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    adjustedClose: null,
    volume: 1000,
    source: "FYERS API v3",
    sourceType: "public_api",
    sourceUrl: null,
    retrievedAt: "2026-10-05T00:00:00.000Z",
    provider: "fyers",
    instrument: "NSE:HDFCBANK-EQ",
    exchange: "NSE",
    asOf: "2026-10-05T00:00:00.000Z",
    marketTimestamp: "2026-10-05T00:00:00.000Z",
    dataStatus: "UNKNOWN",
    delaySeconds: null,
    delayStatus: "UNKNOWN",
    marketStatus: "UNKNOWN",
    isUnofficial: false,
    licenseStatus: "REQUIRES_REVIEW",
  },
];

async function capturePersistenceLogs<T>(
  action: () => Promise<T>,
): Promise<{ result: T; logs: string }> {
  const originalWarn = console.warn;
  const messages: string[] = [];
  console.warn = (...values: unknown[]) => {
    messages.push(
      values
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" "),
    );
  };
  try {
    return { result: await action(), logs: messages.join("\n") };
  } finally {
    console.warn = originalWarn;
  }
}

function failedWrite(): Promise<never> {
  return Promise.reject(
    Object.assign(
      new Error(`Rejected ${secretSentinels.join(" ")}`),
      { code: "42501" },
    ),
  );
}

function fakePersistenceClient(
  failAt?: string,
  failureCode = "42501",
  failureStatus?: number,
): {
  client: PersistenceClient;
  calls: string[];
} {
  const calls: string[] = [];
  const fail = (table: string, operation: string) =>
    failAt === `${table}:${operation}`
      ? Object.assign(new Error(secretSentinels.join(" ")), {
          code: failureCode,
          ...(failureStatus === undefined ? {} : { status: failureStatus }),
        })
      : null;
  const client = {
    from(table: string) {
      return {
        async upsert() {
          calls.push(`${table}:UPSERT`);
          return { error: fail(table, "UPSERT") };
        },
        select() {
          const query = {
            eq() {
              return query;
            },
            limit() {
              return query;
            },
            async maybeSingle() {
              calls.push(`${table}:SELECT`);
              return {
                data: { id: "persisted-company-id" },
                error: fail(table, "SELECT"),
              };
            },
          };
          return query;
        },
        async insert() {
          calls.push(`${table}:INSERT`);
          return { error: fail(table, "INSERT") };
        },
        update() {
          return {
            async eq() {
              calls.push(`${table}:UPDATE`);
              return { error: fail(table, "UPDATE") };
            },
          };
        },
      };
    },
  } as unknown as PersistenceClient;
  return { client, calls };
}

function assertPersistenceLog(
  logs: string,
  context: {
    repositoryOperation: string;
    targetTable: string;
    operationType: string;
  },
): void {
  assert.match(logs, /Persistence was skipped/);
  assert.match(logs, new RegExp(`"repositoryOperation":"${context.repositoryOperation}"`));
  assert.match(logs, new RegExp(`"targetTable":"${context.targetTable}"`));
  assert.match(logs, new RegExp(`"operationType":"${context.operationType}"`));
  assert.match(logs, /"postgresErrorCode":"42501"/);
  assert.match(logs, /"persistenceSkipped":true/);
  for (const secret of secretSentinels) {
    assert.ok(!logs.includes(secret));
  }
}

test("company persistence failure is logged and leaves market data response successful", async () => {
  const { result, logs } = await capturePersistenceLogs(async () => {
    await runBestEffortPersistence(
      {
        repositoryOperation: "persistCompany",
        targetTable: "companies",
        operationType: "UPSERT",
      },
      failedWrite,
    );
    return Response.json({
      snapshot: { provider: "fyers", ticker: "HDFCBANK.NS", price: 1650 },
    });
  });

  assert.equal(result.status, 200);
  const body = (await result.json()) as {
    snapshot: { provider: string; price: number };
  };
  assert.equal(body.snapshot.provider, "fyers");
  assert.equal(body.snapshot.price, 1650);
  assertPersistenceLog(logs, {
    repositoryOperation: "persistCompany",
    targetTable: "companies",
    operationType: "UPSERT",
  });
});

test("historical price persistence failure is non-fatal and logs no secrets", async () => {
  const { result, logs } = await capturePersistenceLogs(async () => {
    await runBestEffortPersistence(
      {
        repositoryOperation: "persistMarketPrices",
        targetTable: "market_prices",
        operationType: "UPSERT",
      },
      failedWrite,
    );
    return Response.json({
      prices: [{ date: "2026-10-02", close: 1650 }],
    });
  });

  assert.equal(result.status, 200);
  const body = (await result.json()) as { prices: { close: number }[] };
  assert.equal(body.prices[0]?.close, 1650);
  assertPersistenceLog(logs, {
    repositoryOperation: "persistMarketPrices",
    targetTable: "market_prices",
    operationType: "UPSERT",
  });
});

test("privileged Supabase client uses the server URL and secret key with session persistence disabled", () => {
  const secretKey = "test-supabase-secret-key";
  let factoryArguments:
    | {
        url: string;
        key: string;
        options: {
          auth: {
            autoRefreshToken: false;
            persistSession: false;
            detectSessionInUrl: false;
          };
        };
      }
    | undefined;
  const client = createSupabasePersistenceClient(
    {
      NEXT_PUBLIC_SUPABASE_URL: " https://example.supabase.co ",
      SUPABASE_SECRET_KEY: ` ${secretKey} `,
    },
    (url, key, options) => {
      factoryArguments = { url, key, options };
      return { created: true };
    },
  );

  assert.deepEqual(client, { created: true });
  assert.deepEqual(factoryArguments, {
    url: "https://example.supabase.co",
    key: secretKey,
    options: {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  });
});

test("Supabase persistence client rejects malformed project URLs without exposing configuration", () => {
  assert.throws(
    () =>
      createSupabasePersistenceClient(
        {
          NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
          SUPABASE_SECRET_KEY: "a-present-but-unprinted-secret",
        },
        () => ({ created: true }),
      ),
    (error: unknown) =>
      error instanceof SupabasePersistenceConfigurationError &&
      error.failure === "invalid_configuration" &&
      !error.message.includes("a-present-but-unprinted-secret"),
  );
});

test("Supabase health failures distinguish missing schema, access, and service availability", () => {
  assert.equal(
    classifySupabaseHealthFailure({ code: "42P01" }),
    "migration_not_applied",
  );
  assert.equal(
    classifySupabaseHealthFailure({ code: "PGRST205" }),
    "migration_not_applied",
  );
  assert.equal(
    classifySupabaseHealthFailure({ code: "42501" }),
    "access_denied",
  );
  assert.equal(
    classifySupabaseHealthFailure({ status: 503 }),
    "upstream_unavailable",
  );
  assert.equal(
    classifySupabaseHealthFailure(new TypeError("fetch failed")),
    "upstream_unavailable",
  );
  assert.equal(
    classifySupabaseHealthFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("lookup failed"), {
          code: "ENOTFOUND",
        }),
      }),
    ),
    "upstream_unavailable",
  );
  assert.equal(
    classifySupabaseHealthFailure({ message: "fetch failed: connection reset" }),
    "upstream_unavailable",
  );
  assert.equal(
    classifySupabaseHealthFailure({
      message: "relation public.companies does not exist",
    }),
    "migration_not_applied",
  );
  assert.equal(
    classifySupabaseHealthFailure({ message: "permission denied for table companies" }),
    "access_denied",
  );
  assert.equal(
    classifySupabaseHealthFailure({ code: "" }),
    "query_failed",
  );
});

test("Supabase health uses a bounded server-side table probe", async () => {
  const { client, calls } = fakePersistenceClient();
  const repository = new SupabaseDatabaseRepository(async () => client);
  const result = await repository.checkConnection();

  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.deepEqual(calls, ["companies:SELECT"]);
});

test("Supabase health reports a missing migration without returning upstream details", async () => {
  const { client } = fakePersistenceClient("companies:SELECT", "42P01");
  const repository = new SupabaseDatabaseRepository(async () => client);

  await assert.rejects(
    repository.checkConnection(),
    (error: unknown) =>
      error instanceof SupabaseDatabaseError &&
      error.failure === "migration_not_applied" &&
      error.message.includes("Apply the existing project migration") &&
      secretSentinels.every((secret) => !error.message.includes(secret)),
  );
});

test("Supabase health reports access failures without returning raw provider errors", async () => {
  const { client } = fakePersistenceClient(
    "companies:SELECT",
    "42501",
  );
  const repository = new SupabaseDatabaseRepository(async () => client);

  await assert.rejects(
    repository.checkConnection(),
    (error: unknown) =>
      error instanceof SupabaseDatabaseError &&
      error.failure === "access_denied" &&
      secretSentinels.every((secret) => !error.message.includes(secret)),
  );
});

test("Supabase health distinguishes missing server credentials", async () => {
  const repository = new SupabaseDatabaseRepository(async () => {
    throw new SupabasePersistenceConfigurationError();
  });
  await assert.rejects(
    repository.checkConnection(),
    (error: unknown) =>
      error instanceof SupabaseDatabaseError &&
      error.failure === "not_configured",
  );
});

test("company and historical price persistence use the privileged client successfully", async () => {
  const { client, calls } = fakePersistenceClient();
  const repository = new SupabaseDatabaseRepository(async () => client);

  assert.equal(await repository.persistCompany(company), "persisted-company-id");
  await repository.persistMarketPrices(company, prices);

  assert.deepEqual(calls, [
    "companies:UPSERT",
    "companies:SELECT",
    "companies:UPSERT",
    "companies:SELECT",
    "market_prices:UPSERT",
  ]);
});

test("repository persistence failures remain non-fatal and logs omit the secret key", async () => {
  const { client } = fakePersistenceClient("companies:UPSERT");
  const repository = new SupabaseDatabaseRepository(async () => client);
  const { result, logs } = await capturePersistenceLogs(async () => ({
    responseStatus: 200,
    companyId: await repository.persistCompany(company),
  }));

  assert.equal(result.responseStatus, 200);
  assert.equal(result.companyId, null);
  assert.match(logs, /"repositoryOperation":"persistCompany"/);
  assert.match(logs, /"targetTable":"companies"/);
  assert.match(logs, /"operationType":"UPSERT"/);
  assert.match(logs, /"postgresErrorCode":"42501"/);
  assert.match(logs, /"persistenceSkipped":true/);
  for (const secret of secretSentinels) {
    assert.ok(!logs.includes(secret));
  }
});
