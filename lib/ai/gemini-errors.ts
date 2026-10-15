export type GeminiFailure =
  | "not_configured"
  | "authentication_failed"
  | "permission_denied"
  | "quota_exceeded"
  | "rate_limited"
  | "invalid_request"
  | "unsupported_model"
  | "network_error"
  | "invalid_response"
  | "unavailable"
  | "timeout";

export class GeminiProviderError extends Error {
  readonly failure: GeminiFailure;

  constructor(message: string, failure: GeminiFailure) {
    super(message);
    this.name = "GeminiProviderError";
    this.failure = failure;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  for (const value of [error.status, error.statusCode, error.code]) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }
  if (isRecord(error.error)) {
    return getErrorStatus(error.error);
  }
  return null;
}

function safeErrorText(error: unknown): string {
  if (!isRecord(error)) {
    return "";
  }
  const fields = [error.status, error.code, error.message];
  if (isRecord(error.error)) {
    fields.push(
      error.error.status,
      error.error.code,
      error.error.message,
    );
  }
  return fields
    .filter((value): value is string | number => (
      typeof value === "string" || typeof value === "number"
    ))
    .join(" ")
    .toLowerCase();
}

function isTimeoutError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  if (
    error.name === "AbortError" ||
    error.name === "APIConnectionTimeoutError" ||
    error.code === "ABORT_ERR" ||
    error.code === 20
  ) {
    return true;
  }
  return isRecord(error.cause) && isTimeoutError(error.cause);
}

function isNetworkError(error: unknown, depth = 0): boolean {
  if (!isRecord(error) || depth > 4) {
    return false;
  }
  if (
    error.name === "APIConnectionError" ||
    (typeof error.code === "string" &&
      ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(
        error.code,
      ))
  ) {
    return true;
  }
  return isNetworkError(error.cause, depth + 1);
}

export function classifyGeminiFailure(error: unknown): GeminiFailure {
  const status = getErrorStatus(error);
  const errorText = safeErrorText(error);
  if (isTimeoutError(error) || status === 408 || status === 504) {
    return "timeout";
  }
  if (isNetworkError(error)) {
    return "network_error";
  }
  if (status === 401 || /\b(unauthenticated|invalid api key|api_key_invalid)\b/.test(errorText)) {
    return "authentication_failed";
  }
  if (status === 403 || /\b(permission_denied|access denied|api disabled)\b/.test(errorText)) {
    return "permission_denied";
  }
  if (
    status === 402 ||
    /\b(quota_exceeded|resource_exhausted|billing|quota)\b/.test(errorText)
  ) {
    return "quota_exceeded";
  }
  if (
    /\b(model_not_found|model .*not found|models\/.*not found|unsupported model|model is not supported|model .* unavailable)\b/.test(errorText)
  ) {
    return "unsupported_model";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 404) {
    return "unsupported_model";
  }
  if (status === 400 || /\b(invalid_argument|invalid_request|bad request)\b/.test(errorText)) {
    return "invalid_request";
  }
  if (
    error instanceof SyntaxError ||
    (isRecord(error) && error.name === "SyntaxError")
  ) {
    return "invalid_response";
  }
  return "unavailable";
}

export function createGeminiProviderError(
  error: unknown,
): GeminiProviderError {
  const failure = classifyGeminiFailure(error);
  let message = "Gemini analysis is unavailable.";

  if (failure === "authentication_failed") {
    message = "Gemini rejected server authentication. Check the server-side API key.";
  } else if (failure === "permission_denied") {
    message = "The configured Gemini project or key is not permitted to use this API.";
  } else if (failure === "quota_exceeded") {
    message = "Gemini quota or billing limits have been reached.";
  } else if (failure === "rate_limited") {
    message = "Gemini rate limit reached. Please wait before trying again.";
  } else if (failure === "invalid_request") {
    message = "Gemini rejected the request configuration. Check the model and supported generation settings.";
  } else if (failure === "unsupported_model") {
    message = "The configured Gemini model is unavailable. Set GEMINI_MODEL to an enabled text-generation model.";
  } else if (failure === "network_error") {
    message = "The server could not connect to Gemini. Check outbound network and DNS connectivity.";
  } else if (failure === "timeout") {
    message = "Gemini analysis timed out after 90 seconds. Please try again.";
  } else if (failure === "invalid_response") {
    message = "Gemini returned an invalid response.";
  } else if (failure === "unavailable") {
    message = "AI analysis is temporarily unavailable. Please try again.";
  }

  return new GeminiProviderError(message, failure);
}
