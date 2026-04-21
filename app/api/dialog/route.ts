export const dynamic = "force-dynamic";

function backendBaseUrl() {
  return process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const threadId = params.get("thread_id");

  if (!threadId) {
    return Response.json({ error: "thread_id is required" }, { status: 400 });
  }

  const user_id = params.get("user_id") ?? "123";
  const page = params.get("page") ?? "1";
  const page_size = params.get("page_size") ?? "10";

  const target = `${backendBaseUrl()}/dialog?thread_id=${encodeURIComponent(
    threadId,
  )}&user_id=${encodeURIComponent(user_id)}&page=${encodeURIComponent(
    page,
  )}&page_size=${encodeURIComponent(page_size)}`;

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
