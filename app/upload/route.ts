export const dynamic = "force-dynamic";

function backendBaseUrl() {
  return process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const userId = String(formData.get("user_id") ?? "123");
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return new Response("Missing file", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const upstreamFormData = new FormData();
    upstreamFormData.append("user_id", userId || "123");
    upstreamFormData.append("file", file, file.name);

    const upstreamResponse = await fetch(`${backendBaseUrl()}/upload`, {
      method: "POST",
      body: upstreamFormData,
      cache: "no-store",
    });

    const responseBody = await upstreamResponse.arrayBuffer();
    const contentType =
      upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8";

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch {
    return new Response("Upload request failed", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
