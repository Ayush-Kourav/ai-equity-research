import assert from "node:assert/strict";
import test from "node:test";
import {
  parseYahooHistoricalRows,
  validateYahooQuote,
} from "../lib/market-data/yahoo-validation.ts";
import { MarketDataError } from "../lib/providers/market-data-error.ts";

test("Yahoo quotes reject non-positive prices and mismatched currencies", () => {
  for (const meta of [
    {
      currency: "INR",
      regularMarketPrice: 0,
      chartPreviousClose: 11,
      regularMarketTime: 1_791_000_000,
    },
    {
      currency: "USD",
      regularMarketPrice: 12,
      chartPreviousClose: 11,
      regularMarketTime: 1_791_000_000,
    },
  ]) {
    assert.throws(
      () =>
        validateYahooQuote(
          {
            price: meta.regularMarketPrice,
            previousClose: meta.chartPreviousClose,
            timestamp: meta.regularMarketTime,
            currency: meta.currency,
          },
          "TEST.NS",
          "INR",
        ),
      (error: unknown) =>
        error instanceof MarketDataError &&
        error.code === "malformed_response",
    );
  }
});

test("Yahoo historical prices retain valid ordered OHLCV rows", () => {
  const prices = parseYahooHistoricalRows({
    timestamps: [1_791_000_000, 1_791_086_400],
    opens: [10, 11],
    highs: [12, 13],
    lows: [9, 10],
    closes: [11, 12],
    adjustedCloses: [11, 12],
    volumes: [100, 200],
    symbol: "TEST.NS",
    currency: "INR",
    expectedCurrency: "INR",
  });
  assert.equal(prices.length, 2);
  assert.equal(prices[0]?.close, 11);
  assert.equal(prices[1]?.close, 12);
  assert.ok(prices[0]!.epoch < prices[1]!.epoch);
  assert.equal(prices[0]?.volume, 100);
});

test("Yahoo historical prices reject unordered timestamps and invalid OHLCV", () => {
  const invalidCharts = [
    { timestamps: [1_791_086_400, 1_791_000_000], closes: [11, 12] },
    { timestamps: [1_791_000_000, 1_791_086_400], closes: [11, -12] },
    {
      timestamps: [1_791_000_000, 1_791_086_400],
      closes: [11, 12],
      volumes: [1, -1],
    },
  ];

  for (const payload of invalidCharts) {
    assert.throws(
      () =>
        parseYahooHistoricalRows({
          timestamps: payload.timestamps,
          opens: [10, 11],
          highs: [12, 13],
          lows: [9, 10],
          closes: payload.closes,
          adjustedCloses: [],
          volumes: payload.volumes ?? [100, 200],
          symbol: "TEST.NS",
          currency: "INR",
          expectedCurrency: "INR",
        }),
      (error: unknown) =>
        error instanceof MarketDataError &&
        error.code === "malformed_response",
    );
  }
});

test("Yahoo historical prices reject an unexpected currency", () => {
  assert.throws(
    () =>
      parseYahooHistoricalRows({
        timestamps: [1_791_000_000],
        opens: [10],
        highs: [12],
        lows: [9],
        closes: [11],
        adjustedCloses: [],
        volumes: [100],
        symbol: "TEST.NS",
        currency: "USD",
        expectedCurrency: "INR",
      }),
    (error: unknown) =>
      error instanceof MarketDataError &&
      error.code === "malformed_response",
  );
});
