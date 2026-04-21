"use client";

import { TextStreamChatTransport, type FileUIPart, type UIMessage } from "ai";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  attachments?: string[];
  isStreaming?: boolean;
};

type Conversation = {
  threadId: string;
  title: string;
  messages: ChatMessage[];
  loaded: boolean;
};

const transport = new TextStreamChatTransport({ api: "/api/chat" });

function nowString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function parseDateString(value: unknown) {
  if (!value) {
    return nowString();
  }

  if (typeof value === "number") {
    return formatDate(new Date(value));
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDate(parsed);
    }
  }

  return nowString();
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function generateThreadId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const guess =
      obj.content ??
      obj.text ??
      obj.message ??
      obj.answer ??
      obj.query ??
      obj.question ??
      obj.output;

    if (guess !== undefined) {
      return extractText(guess);
    }
  }

  return "";
}

function normalizeRole(roleLike: unknown): Role {
  if (typeof roleLike !== "string") {
    return "assistant";
  }

  const role = roleLike.toLowerCase();
  if (role.includes("user") || role.includes("human")) {
    return "user";
  }

  return "assistant";
}

function firstLine(input: string) {
  const clean = input.replace(/\s+/g, " ").trim();
  return clean || "新会话";
}

function limitTitle(input: string) {
  // display at most 2 lines of 10 characters each (20 chars total)
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "新会话";
  if (text.length <= 10) return text;
  if (text.length <= 20) {
    // insert a line break after 10 chars
    return `${text.slice(0, 10)}\n${text.slice(10)}`;
  }
  // longer than 20: truncate and show ellipsis at end of second line
  return `${text.slice(0, 10)}\n${text.slice(10, 20)}...`;
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function normalizeHistory(payload: unknown): Conversation[] {
  const box = payload as Record<string, unknown>;
  const source =
    (Array.isArray(box?.dialogs) && box.dialogs) ||
    (Array.isArray(payload) && payload) ||
    (Array.isArray(box?.data) && box.data) ||
    (Array.isArray(box?.items) && box.items) ||
    (Array.isArray(box?.history) && box.history) ||
    [];

  return source
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const row = item as Record<string, unknown>;
      const threadId =
        String(row.thread_id ?? "").trim();

      if (!threadId) {
        return null;
      }

      const fullTitle =
        String(row.dialog_title ?? "").trim() ||
        extractText(
          row.first_message ?? row.firstMessage ?? row.message ?? row.preview,
        ) || `会话 ${index + 1}`;

      return {
        threadId,
        title: fullTitle,
        messages: [],
        loaded: false,
      } as Conversation;
    })
    .filter((item): item is Conversation => Boolean(item));
}

function normalizeDialog(payload: unknown): ChatMessage[] {
  const box = payload as Record<string, unknown>;
  const source =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(box?.data) && box.data) ||
    (Array.isArray(box?.messages) && box.messages) ||
    (Array.isArray(box?.dialog) && box.dialog) ||
    (Array.isArray(box?.history) && box.history) ||
    [];

  return source
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const row = item as Record<string, unknown>;
      const content = extractText(item);
      if (!content.trim()) {
        return null;
      }

      return {
        id: String(row.id ?? `${Date.now()}-${index}`),
        role: normalizeRole(row.role ?? row.sender ?? row.type),
        content,
        timestamp: parseDateString(
          row.timestamp ?? row.time ?? row.create_time ?? row.createTime ?? row.created_at ?? row.createdAt,
        ),
      } as ChatMessage;
    })
    .filter((item): item is ChatMessage => Boolean(item));
}


function normalizeReplyText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")");
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function Home() {
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(10);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const messageBottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.threadId === activeThreadId),
    [conversations, activeThreadId],
  );

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);


  async function loadHistoryPage(page: number) {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/history?user_id=123&page=${encodeURIComponent(page)}&page_size=${encodeURIComponent(
          historyPageSize,
        )}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("加载历史会话失败");
      }

      const data = (await response.json()) as unknown;
      const items = normalizeHistory(data);

      if (items.length === 0 && page === 1) {
        const threadId = generateThreadId();
        setConversations([{ threadId, title: "新会话", messages: [], loaded: true }]);
        setActiveThreadId(threadId);
        setHistoryHasMore(false);
        return;
      }

      setConversations((prev) => {
        const existing = new Set(prev.map((c) => c.threadId));
        const toAppend = items.filter((c) => !existing.has(c.threadId));
        return [...prev, ...toAppend];
      });

      if (page === 1 && items.length > 0) {
        setActiveThreadId(items[0].threadId);
      }

      if (items.length < historyPageSize) {
        setHistoryHasMore(false);
      } else {
        setHistoryHasMore(true);
      }

      setHistoryPage(page);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        await loadHistoryPage(1);
      } catch {
        const threadId = generateThreadId();
        setConversations([{ threadId, title: "新会话", messages: [], loaded: true }]);
        setActiveThreadId(threadId);
      } finally {
        setBooting(false);
      }
    };

    void init();
  }, []);

  useEffect(() => {
    // load initial dialog page when switching to a thread
    const loadInitial = async () => {
      if (!activeThreadId) return;

      const target = conversations.find((item) => item.threadId === activeThreadId);
      if (!target || target.loaded) return;

      await loadDialogPageForThread(activeThreadId, 1);
    };

    void loadInitial();
  }, [activeThreadId, conversations]);

  async function loadDialogPageForThread(threadId: string, page: number) {
    const pageSize = 10;
    // find conversation
    const conv = conversations.find((c) => c.threadId === threadId);
    if (!conv) return;

    // avoid duplicate loads
    const isLoading = (conv as any).dialogLoading as boolean | undefined;
    const hasMore = (conv as any).dialogHasMore as boolean | undefined;
    if (isLoading) return;
    if (page > 1 && hasMore === false) return;

    // set loading flag
    setConversations((prev) =>
      prev.map((c) =>
        c.threadId === threadId
          ? ({ ...c, loaded: true, dialogLoading: true } as Conversation)
          : c,
      ),
    );

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const response = await fetch(
        `/api/dialog?thread_id=${encodeURIComponent(threadId)}&user_id=123&page=${encodeURIComponent(
          String(page),
        )}&page_size=${encodeURIComponent(String(pageSize))}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("加载会话失败");

      const data = (await response.json()) as unknown;
      const items = normalizeDialog(data);

      // The backend provides `messages` where the 1st element is the bottom-most
      // message for that page. We must reverse each page chunk so UI renders
      // messages in top->bottom order, and prepend older pages above existing.
      const chunk = items.slice().reverse();

      setConversations((prev) =>
        prev.map((c) => {
          if (c.threadId !== threadId) return c;

          const existing = c.messages ?? [];

          if (page === 1) {
            return {
              ...c,
              messages: chunk,
              loaded: true,
              dialogLoading: false,
              ...({ dialogPage: 1, dialogHasMore: items.length >= pageSize } as any),
            } as Conversation;
          }

          // prepend older items for page > 1, avoiding duplicates
          const existingIds = new Set(existing.map((m) => m.id));
          const toPrepend = chunk.filter((m) => !existingIds.has(m.id));
          return {
            ...c,
            messages: [...toPrepend, ...existing],
            loaded: true,
            dialogLoading: false,
            ...( { dialogPage: page, dialogHasMore: items.length >= pageSize } as any ),
          } as Conversation;
        }),
      );

      // adjust scroll: if initial page, scroll to bottom; if prepending, preserve position
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const newContainer = messagesContainerRef.current;
      if (page === 1) {
        messageBottomRef.current?.scrollIntoView({ behavior: "auto" });
      } else if (newContainer) {
        const newScrollHeight = newContainer.scrollHeight;
        newContainer.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
      }
    } catch (err) {
      // mark as loaded to avoid retry loops
      setConversations((prev) =>
        prev.map((c) =>
          c.threadId === threadId ? ({ ...c, loaded: true, dialogLoading: false } as Conversation) : c,
        ),
      );
    }
  }

  const createNewDialog = () => {
    const threadId = generateThreadId();
    const newDialog: Conversation = {
      threadId,
      title: "新会话",
      messages: [],
      loaded: true,
    };
    setConversations((prev) => [newDialog, ...prev]);
    setActiveThreadId(threadId);
    setErrorText("");
  };

  const updateDialogMessages = (
    threadId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[],
  ) => {
    setConversations((prev) =>
      prev.map((item) => {
        if (item.threadId !== threadId) {
          return item;
        }

        return { ...item, messages: updater(item.messages) };
      }),
    );
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed && pendingFiles.length === 0) {
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      threadId = generateThreadId();
      setConversations([{ threadId, title: "新会话", messages: [], loaded: true }]);
      setActiveThreadId(threadId);
    }

    setErrorText("");
    setSending(true);

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    const sendTime = nowString();
    const fileNames = pendingFiles.map((file) => file.name);
    const filesForSend = [...pendingFiles];

    updateDialogMessages(threadId, (messages) => [
      ...messages,
      {
        id: userMessageId,
        role: "user",
        content: trimmed,
        timestamp: sendTime,
        attachments: fileNames,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: sendTime,
        isStreaming: true,
      },
    ]);
    // ensure view scrolls to bottom after adding user & skeleton messages
    setTimeout(() => {
      messageBottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, 50);

    setConversations((prev) =>
      prev.map((item) => {
        if (item.threadId !== threadId) {
          return item;
        }

        return item;
      }),
    );

    setInput("");
    setPendingFiles([]);

    try {
      const fileParts: FileUIPart[] = await Promise.all(
        filesForSend.map(async (file) => {
          const url = await toDataUrl(file);
          return {
            type: "file",
            mediaType: file.type || "application/octet-stream",
            filename: file.name,
            url,
          };
        }),
      );

      const outgoingMessage: UIMessage = {
        id: userMessageId,
        role: "user",
        metadata: { timestamp: sendTime },
        parts: [
          ...(fileParts as UIMessage["parts"]),
          ...(trimmed ? ([{ type: "text", text: trimmed }] as UIMessage["parts"]) : []),
        ],
      };

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: threadId,
        messageId: undefined,
        messages: [outgoingMessage],
        abortSignal: undefined,
        body: { thread_id: threadId },
      });

      const reader = stream.getReader();
      let assistantText = "";
      let pendingText = "";
      let streamFinished = false;
      const typeInterval = 24;
      const typewriterTimer = setInterval(() => {
        if (!pendingText) {
          return;
        }

        const step = Math.max(1, Math.ceil(pendingText.length / 18));
        const nextPiece = pendingText.slice(0, step);
        pendingText = pendingText.slice(step);
        assistantText += nextPiece;

        updateDialogMessages(threadId, (messages) =>
          messages.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: assistantText, isStreaming: true }
              : message,
          ),
        );
        // auto-scroll to bottom during typewriter streaming
        messageBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, typeInterval);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            streamFinished = true;
            break;
          }

          if (!value) {
            continue;
          }

          if (value.type === "text-delta") {
            pendingText += value.delta;
          }

          if (value.type === "error") {
            throw new Error(value.errorText || "流式输出失败");
          }
        }

        while (!streamFinished || pendingText.length > 0) {
          await delay(typeInterval);
          if (streamFinished && pendingText.length === 0) {
            break;
          }
        }
      } finally {
        clearInterval(typewriterTimer);
      }

      updateDialogMessages(threadId, (messages) =>
        messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: assistantText || "(无回复)",
                timestamp: nowString(),
                isStreaming: false,
              }
            : message,
        ),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "发送失败，请稍后重试";
      setErrorText(reason);
      updateDialogMessages(threadId, (messages) =>
        messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: `请求失败：${reason}`,
                timestamp: nowString(),
                isStreaming: false,
              }
            : message,
        ),
      );
    } finally {
      setSending(false);
    }
    // ensure view scrolls to bottom after send
    messageBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="chat-shell flex h-screen w-full overflow-hidden">
      <aside
        className={clsx(
          "border-r border-[var(--line)] bg-[var(--bg-panel)] transition-all duration-300 h-full",
          collapsed ? "w-[74px]" : "w-[290px]",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-3">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-sm text-[var(--text-main)] hover:bg-[var(--accent-soft)]"
            >
              {collapsed ? "展开" : "收起"}
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={createNewDialog}
                className="rounded-lg bg-[var(--bg-strong)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                新建对话
              </button>
            )}
          </div>

          <div
            ref={sidebarRef}
            onScroll={() => {
              const el = sidebarRef.current;
              if (!el || historyLoading || !historyHasMore) return;
              const threshold = 120;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
                void loadHistoryPage(historyPage + 1);
              }
            }}
            className="sidebar-scroll flex-1 overflow-y-auto px-2 py-3"
          >
            {conversations.map((conversation) => {
              const active = conversation.threadId === activeThreadId;
              return (
                <button
                  key={conversation.threadId}
                  type="button"
                  onClick={() => setActiveThreadId(conversation.threadId)}
                  title={conversation.title}
                  className={clsx(
                    "mb-2 flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left transition",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-transparent bg-white hover:border-[var(--line)]",
                    collapsed ? "justify-center" : "",
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-strong)] text-xs font-semibold text-white">
                    {active ? "●" : "○"}
                  </span>
                  {!collapsed && (
                    <span
                      className="text-sm text-[var(--text-main)]"
                      style={{ whiteSpace: "pre-line" }}
                    >
                      {limitTitle(conversation.title)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="flex h-screen flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-[var(--line)] bg-white/70 px-5 py-4 backdrop-blur">
          <h1 className="font-mono text-lg font-semibold tracking-tight">AI Agent 对话</h1>
          <p className="mt-1 text-sm text-[var(--text-soft)]">
            当前会话ID: {activeThreadId || "-"}
          </p>
        </header>

        <section
          ref={messagesContainerRef}
          onScroll={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            if (!activeConversation) return;
            const meta = (activeConversation as any);
            if (meta.dialogLoading) return;
            if (meta.dialogHasMore === false) return;
            const threshold = 120;
            if (el.scrollTop <= threshold) {
              const next = (meta.dialogPage ?? 1) + 1;
              void loadDialogPageForThread(activeConversation.threadId, next);
            }
          }}
          className="messages-scroll flex-1 overflow-y-auto px-4 py-5 md:px-8"
        >
          {booting ? (
            <div className="rounded-xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--text-soft)]">
              正在加载历史会话...
            </div>
          ) : activeConversation?.messages.length ? (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {activeConversation.messages.map((message) => (
                <article
                  key={message.id}
                  className={clsx(
                    "rounded-2xl border p-4 shadow-sm",
                    message.role === "user"
                      ? "border-[#cde3f8] bg-[var(--user)]"
                      : "border-[#eadfcf] bg-[var(--assistant)]",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--text-soft)]">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                          message.role === "user"
                            ? "bg-[#2f6da5] text-white"
                            : "bg-[#b75528] text-white",
                        )}
                      >
                        {message.role === "user" ? "U" : "A"}
                      </span>
                      <span>{message.role === "user" ? "用户" : "Agent"}</span>
                    </div>
                    <time>{message.timestamp}</time>
                  </div>

                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mb-2 rounded-lg border border-dashed border-[#d2c6b6] bg-[#fffaf1] px-3 py-2 text-xs text-[var(--text-soft)]">
                      文件: {message.attachments.join(", ")}
                    </div>
                  )}

                  <div className="bubble-markdown text-sm text-[var(--text-main)]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {normalizeReplyText(
                        message.content || (message.isStreaming ? "正在思考中..." : ""),
                      )}
                    </ReactMarkdown>
                    {message.isStreaming && <span className="typing-caret">|</span>}
                  </div>
                </article>
              ))}
              <div ref={messageBottomRef} />
            </div>
          ) : (
            <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--text-soft)] shadow-[var(--shadow)]">
              开始新对话，支持输入文本和上传文件。
            </div>
          )}
        </section>

        <footer className="shrink-0 border-t border-[var(--line)] bg-[var(--bg-panel)] p-4">
          <form
            ref={formRef}
            onSubmit={handleSend}
            className="mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl border border-[var(--line)] bg-white p-3"
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                if (event.shiftKey) {
                  return;
                }

                if (event.nativeEvent.isComposing) {
                  return;
                }

                event.preventDefault();
                formRef.current?.requestSubmit();
              }}
              rows={3}
              placeholder="输入消息..."
              className="w-full resize-none rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-main)] hover:bg-[var(--accent-soft)]">
                  上传文件
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const files = event.target.files
                        ? Array.from(event.target.files)
                        : [];
                      setPendingFiles(files);
                    }}
                  />
                </label>
                {pendingFiles.length > 0 && (
                  <span className="text-xs text-[var(--text-soft)]">
                    已选择 {pendingFiles.length} 个文件
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={sending}
                className="rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "发送中..." : "发送"}
              </button>
            </div>

            {errorText && <p className="text-xs text-red-600">{errorText}</p>}
          </form>
        </footer>
      </main>
    </div>
  );
}
