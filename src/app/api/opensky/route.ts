import { NextResponse } from "next/server";

// Server-side cache: prevents redundant OpenSky fetches
let cacheBody: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 10_000; // 10s cache (OpenSky updates ~10s)

// OpenSky OAuth2 token state
let oauthToken: string | null = null;
let oauthTokenExpiry = 0;

async function getOpenSkyToken(): Promise<string | null> {
  const now = Date.now();
  if (oauthToken && now < oauthTokenExpiry - 60_000) return oauthToken;

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    oauthToken = data.access_token;
    oauthTokenExpiry = now + (data.expires_in ?? 300) * 1000;
    return oauthToken;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();

  // Serve from cache if fresh
  if (cacheBody && now - cacheTime < CACHE_TTL_MS) {
    return new NextResponse(cacheBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "HIT",
        "Cache-Control": "no-store",
      },
    });
  }

  // Fetch from OpenSky with auth
  const headers: Record<string, string> = { Accept: "application/json" };

  // Try OAuth2 first, fall back to Basic auth
  const token = await getOpenSkyToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    const clientId = process.env.OPENSKY_CLIENT_ID;
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch("https://opensky-network.org/api/states/all", { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 429) {
      // Rate limited: serve stale cache if available
      if (cacheBody) {
        return new NextResponse(cacheBody, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Cache": "STALE",
            "X-Rate-Limited": "true",
          },
        });
      }
      return NextResponse.json({ error: "Rate limited", states: null, time: 0 }, { status: 429 });
    }

    if (!res.ok) {
      if (cacheBody) {
        return new NextResponse(cacheBody, {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
        });
      }
      return NextResponse.json({ error: `OpenSky returned ${res.status}`, states: null, time: 0 }, { status: 502 });
    }

    const body = await res.text();
    cacheBody = body;
    cacheTime = now;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "MISS",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (cacheBody) {
      return new NextResponse(cacheBody, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "STALE" },
      });
    }
    return NextResponse.json({ error: "Failed to reach OpenSky", states: null, time: 0 }, { status: 502 });
  }
}
