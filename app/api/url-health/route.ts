import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 20000);

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      cache: "no-store"
    });
    return NextResponse.json({ ok: response.status === 200, status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  } finally {
    clearTimeout(timeout);
  }
}
