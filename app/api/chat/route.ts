import type { UIMessage } from "ai";

export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;

function backendBaseUrl() {
  return process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8000";
}

function extractString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractString(item)).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const row = value as AnyRecord;
    const guess =
      row.content ?? row.text ?? row.message ?? row.answer ?? row.output ?? row.delta;

    if (guess !== undefined) {
      return extractString(guess);
    }
  }

  return "";
}

function extractTextFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const row = part as AnyRecord;
      if (row.type === "text") {
        return extractString(row.text);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractFileParts(parts: unknown[]): Array<{
  url: string;
  filename?: string;
  mediaType?: string;
}> {
  const files: Array<{ url: string; filename?: string; mediaType?: string }> = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const row = part as AnyRecord;
    if (row.type !== "file" || typeof row.url !== "string") {
      continue;
    }

    files.push({
      url: row.url,
      filename: typeof row.filename === "string" ? row.filename : undefined,
      mediaType: typeof row.mediaType === "string" ? row.mediaType : undefined,
    });
  }

  return files;
}

function serializeMessagesForBackend(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const content = extractTextFromParts(message.parts as unknown[]);
      return {
        role: message.role,
        content,
      };
    })
    .filter((message) => message.content.trim().length > 0);
}

function buildChatPayload(options: {
  thread_id: string;
  user_id: string;
  content: string;
  files: Array<{ url: string; filename?: string; mediaType?: string }>;
  messages: UIMessage[];
}) {
  const { thread_id, user_id, content, files, messages } = options;
  const serializedMessages = serializeMessagesForBackend(messages);
  const fallbackMessages = content.trim()
    ? [{ role: "user", content }]
    : serializedMessages;

  return {
    thread_id,
    user_id,
    query: content,
    messages: serializedMessages.length > 0 ? serializedMessages : fallbackMessages,
    files: files.map((file) => ({
      filename: file.filename,
      media_type: file.mediaType,
      mediaType: file.mediaType,
      url: file.url,
      data: file.url,
    })),
  };
}

function extractDeltaText(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as AnyRecord;

    const direct =
      parsed.delta ??
      parsed.text ??
      parsed.content ??
      parsed.message ??
      parsed.answer ??
      parsed.token;

    if (direct !== undefined) {
      return extractString(direct);
    }

    const choice =
      Array.isArray(parsed.choices) && parsed.choices.length > 0
        ? (parsed.choices[0] as AnyRecord)
        : undefined;

    if (choice) {
      const fromChoice =
        (choice.delta as AnyRecord | undefined)?.content ??
        choice.text ??
        (choice.message as AnyRecord | undefined)?.content;

      if (fromChoice !== undefined) {
        return extractString(fromChoice);
      }
    }

    if (parsed.data !== undefined) {
      return extractString(parsed.data);
    }

    if (parsed.chunk !== undefined) {
      return extractString(parsed.chunk);
    }

    return "";
  } catch {
    return trimmed;
  }
}

function sseToTextStream(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = stream.getReader();
  let sseBuffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (sseBuffer.trim()) {
            const text = extractDeltaText(sseBuffer.replace(/^data:/gm, ""));
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
          return;
        }

        sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundaryIndex = sseBuffer.indexOf("\n\n");
        while (boundaryIndex >= 0) {
          const eventChunk = sseBuffer.slice(0, boundaryIndex);
          sseBuffer = sseBuffer.slice(boundaryIndex + 2);

          const dataPayload = eventChunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");

          const text = extractDeltaText(dataPayload);
          if (text) {
            controller.enqueue(encoder.encode(text));
          }

          boundaryIndex = sseBuffer.indexOf("\n\n");
        }

        return;
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnyRecord;
  const messages = (body.messages as UIMessage[]) ?? [];
  const thread_id = extractString(body.thread_id) || "";
  const user_id = extractString(body.user_id) || "123";

  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  const parts = latestUserMessage?.parts ?? [];
  const content = extractTextFromParts(parts as unknown[]);
  const files = extractFileParts(parts as unknown[]);
  const payload = buildChatPayload({ thread_id, user_id, content, files, messages });

  const upstreamResponse = await fetch(`${backendBaseUrl()}/chat`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    cache: "no-store",
  });

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const reason = await upstreamResponse.text();
    return new Response(reason || "Backend chat request failed", {
      status: upstreamResponse.status || 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const textStream = sseToTextStream(upstreamResponse.body);

  return new Response(textStream, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
