export interface SupabasePersistenceEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export interface SupabasePersistenceClientOptions {
  auth: {
    autoRefreshToken: false;
    persistSession: false;
    detectSessionInUrl: false;
  };
}

export interface SupabasePersistenceClientFactory<TClient> {
  (
    supabaseUrl: string,
    secretKey: string,
    options: SupabasePersistenceClientOptions,
  ): TClient;
}

export class SupabasePersistenceConfigurationError extends Error {
  readonly failure: "not_configured" | "invalid_configuration";

  constructor(
    failure: "not_configured" | "invalid_configuration" = "not_configured",
  ) {
    super(
      failure === "not_configured"
        ? "Supabase persistence is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY on the server."
        : "Supabase URL configuration is invalid. Use an HTTP(S) Supabase project URL.",
    );
    this.name = "SupabasePersistenceConfigurationError";
    this.failure = failure;
  }
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

export function createSupabasePersistenceClient<TClient>(
  environment: SupabasePersistenceEnvironment,
  clientFactory: SupabasePersistenceClientFactory<TClient>,
): TClient {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !secretKey) {
    throw new SupabasePersistenceConfigurationError();
  }
  if (!isValidSupabaseUrl(supabaseUrl)) {
    throw new SupabasePersistenceConfigurationError("invalid_configuration");
  }

  return clientFactory(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
