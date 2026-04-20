export const dynamic = "force-dynamic";

function backendBaseUrl() {
  return process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function GET() {
  const response = await fetch(`${backendBaseUrl()}/history`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
