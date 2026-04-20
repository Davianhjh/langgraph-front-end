export const dynamic = "force-dynamic";

function backendBaseUrl() {
  return process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const threadId = url.searchParams.get("thread_id");

  if (!threadId) {
    return Response.json({ error: "thread_id is required" }, { status: 400 });
  }

  const target = `${backendBaseUrl()}/dialog?thread_id=${encodeURIComponent(threadId)}`;
  const response = await fetch(target, {
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
