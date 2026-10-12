import { MarketDataError } from "../providers/market-data-error.ts";

export interface YahooHistoricalRow {
  epoch: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjustedClose: number | null;
  volume: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function malformed(message: string): never {
  throw new MarketDataError(message, "malformed_response", "yahoo");
}

export function validateYahooQuote(
  values: {
    price: number | null;
    previousClose: number | null;
    timestamp: number | null;
    currency: string | null;
    open?: unknown;
    high?: unknown;
    low?: unknown;
    volume?: unknown;
  },
  symbol: string,
  expectedCurrency: string,
): void {
  const { price, previousClose, timestamp, currency } = values;
  const open = finiteNumber(values.open);
  const high = finiteNumber(values.high);
  const low = finiteNumber(values.low);
  const volume = finiteNumber(values.volume);
  if (
    price === null ||
    price <= 0 ||
    previousClose === null ||
    previousClose <= 0 ||
    timestamp === null ||
    timestamp <= 0 ||
    !currency ||
    currency !== expectedCurrency ||
    !Number.isFinite(new Date(timestamp * 1000).valueOf()) ||
    (values.open !== null &&
      values.open !== undefined &&
      (open === null || open <= 0)) ||
    (values.high !== null &&
      values.high !== undefined &&
      (high === null || high <= 0)) ||
    (values.low !== null &&
      values.low !== undefined &&
      (low === null || low <= 0)) ||
    (values.volume !== null &&
      values.volume !== undefined &&
      (volume === null || volume < 0)) ||
    (high !== null && low !== null && high < low) ||
    (high !== null && (high < price || (open !== null && high < open))) ||
    (low !== null && (low > price || (open !== null && low > open)))
  ) {
    malformed(
      `Yahoo Finance omitted or returned invalid quote fields for ${symbol}.`,
    );
  }
}

export function parseYahooHistoricalRows(input: {
  timestamps: unknown[];
  opens: unknown[];
  highs: unknown[];
  lows: unknown[];
  closes: unknown[];
  adjustedCloses: unknown[];
  volumes: unknown[];
  symbol: string;
  currency: unknown;
  expectedCurrency: string;
}): YahooHistoricalRow[] {
  if (input.currency !== input.expectedCurrency) {
    malformed(
      `Yahoo Finance returned historical prices in an unexpected currency for ${input.symbol}.`,
    );
  }
  const alignedArrays = [
    input.opens,
    input.highs,
    input.lows,
    input.closes,
    input.adjustedCloses,
    input.volumes,
  ];
  if (
    input.closes.length !== input.timestamps.length ||
    alignedArrays.some(
      (values) => values.length > 0 && values.length !== input.timestamps.length,
    )
  ) {
    malformed(
      `Yahoo Finance returned misaligned historical values for ${input.symbol}.`,
    );
  }

  let previousEpoch = 0;
  return input.timestamps.flatMap((timestamp, index) => {
    const epoch = finiteNumber(timestamp);
    if (
      epoch === null ||
      epoch <= previousEpoch ||
      !Number.isFinite(new Date(epoch * 1000).valueOf())
    ) {
      malformed(
        `Yahoo Finance returned invalid or unordered historical timestamps for ${input.symbol}.`,
      );
    }
    previousEpoch = epoch;

    const closeValue = input.closes[index];
    if (closeValue === null || closeValue === undefined) {
      return [];
    }

    const close = finiteNumber(closeValue);
    const openValue = input.opens[index];
    const highValue = input.highs[index];
    const lowValue = input.lows[index];
    const open = finiteNumber(openValue);
    const high = finiteNumber(highValue);
    const low = finiteNumber(lowValue);
    const volumeValue = input.volumes[index];
    const volume =
      volumeValue === null || volumeValue === undefined
        ? null
        : finiteNumber(volumeValue);
    const adjustedCloseValue = input.adjustedCloses[index];
    const adjustedClose =
      adjustedCloseValue === null || adjustedCloseValue === undefined
        ? null
        : finiteNumber(adjustedCloseValue);

    if (
      close === null ||
      close <= 0 ||
      (openValue !== null && openValue !== undefined && open === null) ||
      (highValue !== null && highValue !== undefined && high === null) ||
      (lowValue !== null && lowValue !== undefined && low === null) ||
      (open !== null && open <= 0) ||
      (high !== null && high <= 0) ||
      (low !== null && low <= 0) ||
      (volumeValue !== null &&
        volumeValue !== undefined &&
        (volume === null || volume < 0)) ||
      (adjustedCloseValue !== null &&
        adjustedCloseValue !== undefined &&
        (adjustedClose === null || adjustedClose <= 0)) ||
      (high !== null && low !== null && high < low) ||
      (high !== null &&
        (high < close || (open !== null && high < open))) ||
      (low !== null &&
        (low > close || (open !== null && low > open)))
    ) {
      malformed(
        `Yahoo Finance returned invalid OHLCV values for ${input.symbol}.`,
      );
    }

    return [{ epoch, open, high, low, close, adjustedClose, volume }];
  });
}
