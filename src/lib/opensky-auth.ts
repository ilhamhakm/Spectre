// OpenSky Network authentication — OAuth2 client-credentials flow.
//
// Since March 18, 2026 OpenSky no longer accepts username/password Basic
// auth. You create an "API client" on your account page to get a
// client_id + client_secret, exchange them for a short-lived (30 min)
// access token, and send it as a Bearer header.
//
// Anonymous access = 400 credits/day. Authenticated = 4,000/day (~10x).
// Set OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET in .env.local to opt in;
// without them this helper returns anonymous headers (no auth) so the app
// keeps working.

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// Refresh a minute early so we never hand out an expiring token.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // unix ms
let tokenFetchInFlight: Promise<string | null> | null = null;

async function fetchAccessToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof data.access_token !== "string" || !data.access_token) return null;
    cachedToken = data.access_token;
    tokenExpiresAt =
      Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 1800) * 1000;
    return cachedToken;
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  // Valid cached token → reuse.
  if (cachedToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken;
  }
  // Only one concurrent fetch — dedupe parallel requests from all callers.
  if (!tokenFetchInFlight) {
    tokenFetchInFlight = fetchAccessToken().finally(() => {
      tokenFetchInFlight = null;
    });
  }
  return tokenFetchInFlight;
}

export async function openskyAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "User-Agent": "spectre/0.1 (osint monitor)",
  };
  const token = await getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
