"use client";

import { TextStreamChatTransport, type UIMessage } from "ai";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  attachments?: string[];
  files?: UploadedFile[];
  isStreaming?: boolean;
};

type Conversation = {
  threadId: string;
  title: string;
  messages: ChatMessage[];
  loaded: boolean;
  dialogLoading?: boolean;
  dialogHasMore?: boolean;
  dialogPage?: number;
};

type UploadedFile = {
  file_url: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  mime_type: string;
};

const HISTORY_PAGE_SIZE = 10;

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

function limitTitle(input: string) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  return text || "新会话";
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

      const rawFiles = Array.isArray(row.files) ? row.files : [];
      const files: UploadedFile[] = rawFiles
        .slice(0, 3)
        .map((f: unknown) => {
          if (!f || typeof f !== "object") return null;
          const rf = f as Record<string, unknown>;
          const file_url = String(rf.file_url ?? "");
          if (!file_url) return null;
          return {
            file_url,
            file_name: String(rf.file_name ?? ""),
            file_ext: String(rf.file_ext ?? ""),
            file_size: Number(rf.file_size ?? 0),
            mime_type: String(rf.mime_type ?? "application/octet-stream"),
          } as UploadedFile;
        })
        .filter((f): f is UploadedFile => f !== null);

      return {
        id: String(row.id ?? `${Date.now()}-${index}`),
        role: normalizeRole(row.role ?? row.sender ?? row.type),
        content,
        timestamp: parseDateString(
          row.timestamp ?? row.time ?? row.create_time ?? row.createTime ?? row.created_at ?? row.createdAt,
        ),
        ...(files.length > 0 ? { files } : {}),
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
  const [sidebarWidth, setSidebarWidth] = useState(290);
  const [isResizing, setIsResizing] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      if (newWidth < 160) newWidth = 160;
      if (newWidth > 480) newWidth = 480;
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    // Only set on client side
    const savedTheme = localStorage.getItem("app_theme") || "light";
    const savedSize = localStorage.getItem("app_font_size") || "medium";
    setTheme(savedTheme);
    setFontSize(savedSize);
  }, []);

  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadHint, setUploadHint] = useState("");
  const [showUploadFailToast, setShowUploadFailToast] = useState(false);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState("light");
  const [fontSize, setFontSize] = useState("medium");
  const messageBottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyLoadingRef = useRef(false);
  const uploadFailToastTimerRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.threadId === activeThreadId),
    [conversations, activeThreadId],
  );

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (uploadFailToastTimerRef.current !== null) {
        window.clearTimeout(uploadFailToastTimerRef.current);
      }
    };
  }, []);


  const loadHistoryPage = useCallback(async (page: number) => {
    if (historyLoadingRef.current) return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/history?user_id=123&page=${encodeURIComponent(page)}&page_size=${encodeURIComponent(
          HISTORY_PAGE_SIZE,
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

      if (items.length < HISTORY_PAGE_SIZE) {
        setHistoryHasMore(false);
      } else {
        setHistoryHasMore(true);
      }

      setHistoryPage(page);
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  }, []);

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
  }, [loadHistoryPage]);

  const loadDialogPageForThread = useCallback(async (threadId: string, page: number) => {
    const pageSize = 10;
    // find conversation
    const conv = conversations.find((c) => c.threadId === threadId);
    if (!conv) return;

    // avoid duplicate loads
    const isLoading = conv.dialogLoading;
    const hasMore = conv.dialogHasMore;
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
              dialogPage: 1,
              dialogHasMore: items.length >= pageSize,
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
            dialogPage: page,
            dialogHasMore: items.length >= pageSize,
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
    } catch {
      // mark as loaded to avoid retry loops
      setConversations((prev) =>
        prev.map((c) =>
          c.threadId === threadId ? ({ ...c, loaded: true, dialogLoading: false } as Conversation) : c,
        ),
      );
    }
  }, [conversations]);

  useEffect(() => {
    // load initial dialog page when switching to a thread
    const loadInitial = async () => {
      if (!activeThreadId) return;

      const target = conversations.find((item) => item.threadId === activeThreadId);
      if (!target || target.loaded) return;

      await loadDialogPageForThread(activeThreadId, 1);
    };

    void loadInitial();
  }, [activeThreadId, conversations, loadDialogPageForThread]);

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

  const handleUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = "";

    if (!selected) {
      return;
    }

    if (sending) {
      return;
    }

    if (uploadedFiles.length >= 3) {
      setUploadHint("一个输入框最多上传 3 个文件");
      return;
    }

    setUploadHint("");
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("user_id", "123");
      formData.append("file", selected);

      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("上传文件失败");
      }

      const payload = (await response.json()) as Partial<UploadedFile>;
      if (!payload.file_url || !payload.file_name) {
        throw new Error("上传返回数据格式错误");
      }

      const uploaded: UploadedFile = {
        file_url: String(payload.file_url),
        file_name: String(payload.file_name),
        file_ext: String(payload.file_ext ?? ""),
        file_size: Number(payload.file_size ?? 0),
        mime_type: String(payload.mime_type ?? "application/octet-stream"),
      };

      setUploadedFiles((prev) => {
        if (prev.length >= 3) {
          return prev;
        }
        return [...prev, uploaded];
      });
      setUploadHint("");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "上传失败，请稍后重试";
      setUploadHint("上传文件失败");
      setShowUploadFailToast(true);
      if (uploadFailToastTimerRef.current !== null) {
        window.clearTimeout(uploadFailToastTimerRef.current);
      }
      uploadFailToastTimerRef.current = window.setTimeout(() => {
        setShowUploadFailToast(false);
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const removeUploadedFile = (indexToRemove: number) => {
    setUploadedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const triggerFileDownload = (file: UploadedFile) => {
    const link = document.createElement("a");
    link.href = file.file_url;
    link.download = file.file_name || "download";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed && uploadedFiles.length === 0) {
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
    const filesForSend = [...uploadedFiles];
    const fileNames = filesForSend.map((file) => file.file_name);

    updateDialogMessages(threadId, (messages) => [
      ...messages,
      {
        id: userMessageId,
        role: "user",
        content: trimmed,
        timestamp: sendTime,
        attachments: fileNames,
        ...(filesForSend.length > 0 ? { files: filesForSend } : {}),
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
    setUploadedFiles([]);

    try {
      const outgoingMessage: UIMessage = {
        id: userMessageId,
        role: "user",
        metadata: { timestamp: sendTime },
        parts: trimmed ? ([{ type: "text", text: trimmed }] as UIMessage["parts"]) : [],
      };

      const stream = await transport.sendMessages({
        trigger: "submit-message",
        chatId: threadId,
        messageId: undefined,
        messages: [outgoingMessage],
        abortSignal: undefined,
        body: { thread_id: threadId, user_id: "123", files: filesForSend },
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
    <div
      className={clsx(
        "chat-shell flex h-screen w-full overflow-hidden transition-all duration-300",
        fontSize === "small" ? "text-xs" : fontSize === "large" ? "text-lg" : "text-sm",
        theme === "dark" ? "bg-slate-950 text-slate-100 dark" : "bg-[var(--bg-main)] text-[var(--text-main)]"
      )}
      style={{
        fontSize: fontSize === "small" ? "0.85rem" : fontSize === "large" ? "1.2rem" : "1rem"
      }}
    >
      <aside
        className={clsx(
          "relative flex shrink-0 flex-col border-r transition-all duration-300 h-full",
          theme === "dark" ? "border-slate-800 bg-slate-900" : "border-[var(--line)] bg-[var(--bg-panel)]",
          collapsed ? "w-[74px]" : ""
        )}
        style={{ width: collapsed ? "74px" : `${sidebarWidth}px` }}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className={clsx(
            "flex items-center justify-between gap-2 border-b px-3 py-3",
            theme === "dark" ? "border-slate-800" : "border-[var(--line)]"
          )}>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className={clsx(
                "rounded-lg border px-2 py-1 text-sm transition",
                theme === "dark" 
                  ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" 
                  : "border-[var(--line)] bg-white text-[var(--text-main)] hover:bg-[var(--accent-soft)]"
              )}
            >
              {collapsed ? "展开" : "收起"}
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={createNewDialog}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
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
                    "mb-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
                    active
                      ? (theme === "dark" ? "border-orange-500 bg-slate-800 shadow-sm" : "border-[var(--accent)] bg-[var(--accent-soft)] shadow-sm")
                      : (theme === "dark" ? "border-transparent hover:border-slate-700" : "border-transparent bg-white hover:border-[var(--line)]"),
                    collapsed ? "justify-center" : "",
                  )}
                >
                  {collapsed ? (
                    <div className={clsx(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-all",
                      active 
                        ? "bg-[var(--accent)] text-white scale-110 shadow-md" 
                        : (theme === "dark" ? "bg-slate-800 text-slate-500 hover:bg-slate-700" : "bg-gray-100 text-gray-400 hover:bg-gray-200")
                    )}>
                      {conversation.title.charAt(0).toUpperCase() || "C"}
                    </div>
                  ) : (
                    <span
                      className={clsx(
                        "text-sm flex-1 break-all line-clamp-2",
                        active 
                          ? (theme === "dark" ? "font-semibold text-orange-400" : "font-semibold text-[var(--accent)]")
                          : (theme === "dark" ? "text-slate-300" : "text-[var(--text-main)]")
                      )}
                      style={{ 
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                      }}
                    >
                      {limitTitle(conversation.title)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className={clsx(
            "border-t px-2 py-4",
            theme === "dark" ? "border-slate-800" : "border-[var(--line)]"
          )}>
            <button
              onClick={() => setShowSettings(true)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left transition",
                theme === "dark" ? "hover:bg-slate-800 text-slate-300" : "hover:bg-[var(--accent-soft)] hover:border-[var(--line)]",
                collapsed ? "justify-center" : ""
              )}
              title="设置"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {!collapsed && <span className="text-sm font-medium">设置</span>}
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        {!collapsed && (
          <div
            onMouseDown={() => setIsResizing(true)}
            className={clsx(
              "absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-all hover:w-1.5 hover:bg-[var(--accent)]",
              isResizing ? "w-1.5 bg-[var(--accent)]" : "bg-transparent"
            )}
          />
        )}
      </aside>

      <main className={clsx(
        "flex h-screen flex-1 flex-col overflow-hidden transition-colors duration-300",
        theme === "dark" ? "bg-slate-950" : "bg-white"
      )}>
        <header className={clsx(
          "shrink-0 border-b px-5 py-4 backdrop-blur transition-colors duration-300",
          theme === "dark" ? "border-slate-800 bg-slate-900/70 text-slate-100" : "border-[var(--line)] bg-white/70 text-[var(--text-main)]"
        )}>
          <h1 className="font-mono text-lg font-semibold tracking-tight">AI Agent 对话</h1>
          <p className={clsx(
            "mt-1 text-sm",
            theme === "dark" ? "text-slate-400" : "text-[var(--text-soft)]"
          )}>
            当前会话ID: {activeThreadId || "-"}
          </p>
        </header>

        <section
          ref={messagesContainerRef}
          onScroll={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            if (!activeConversation) return;
            const meta = activeConversation;
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
            <div className={clsx(
              "rounded-xl border p-6 text-sm",
              theme === "dark" ? "border-slate-800 bg-slate-900 text-slate-400" : "border-[var(--line)] bg-white text-[var(--text-soft)]"
            )}>
              正在加载历史会话...
            </div>
          ) : activeConversation?.messages.length ? (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
              {activeConversation.messages.map((message) => (
                <article
                  key={message.id}
                  className={clsx(
                    "flex w-full gap-3",
                    message.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {/* Avatar & Name */}
                  <div className={clsx(
                    "flex flex-col items-center shrink-0 w-12",
                    message.role === "user" ? "items-end" : "items-start"
                  )}>
                    <div
                      className={clsx(
                        "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold shadow-sm overflow-hidden",
                        message.role === "user"
                          ? "bg-[var(--accent)] text-white"
                          : (theme === "dark" ? "bg-slate-800 text-slate-300 border border-slate-700" : "bg-[#4a5568] text-white"),
                      )}
                    >
                      {message.role === "user" ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>
                      )}
                    </div>
                    <span className={clsx(
                      "mt-1 text-[10px] font-medium truncate max-w-full",
                      theme === "dark" ? "text-slate-500" : "text-[var(--text-soft)]"
                    )}>
                      {message.role === "user" ? "用户" : "Agent"}
                    </span>
                  </div>

                  {/* Body: Bubble + Attachments + Time */}
                  <div className={clsx(
                    "flex max-w-[85%] flex-col gap-1",
                    message.role === "user" ? "items-end" : "items-start"
                  )}>
                    {message.files && message.files.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {message.files.map((file, fi) => (
                          <button
                            type="button"
                            key={`${file.file_url}-${fi}`}
                            onClick={() => triggerFileDownload(file)}
                            className={clsx(
                              "relative flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition hover:opacity-90",
                              theme === "dark" ? "border-slate-600 bg-slate-900/95" : "border-[var(--line)] bg-white/95"
                            )}
                            title={`下载 ${file.file_name}`}
                          >
                            <div className={clsx(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                              theme === "dark" ? "bg-slate-700 text-slate-200" : "bg-[#f3ece3] text-[var(--text-soft)]"
                            )}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                            </div>
                            <span
                              title={file.file_name}
                              className="max-w-[140px] truncate text-[11px]"
                            >
                              {file.file_name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div
                      className={clsx(
                        "relative rounded-2xl px-4 py-2.5 shadow-sm border transition-colors",
                        message.role === "user"
                          ? (theme === "dark" ? "rounded-tr-none border-orange-900/50 bg-orange-900/20 text-orange-100" : "rounded-tr-none border-[#f9dcc4] bg-[#fff0e6] text-[var(--text-main)]")
                          : (theme === "dark" ? "rounded-tl-none border-slate-800 bg-slate-900 text-slate-200" : "rounded-tl-none border-[var(--line)] bg-white text-[var(--text-main)]"),
                      )}
                    >

                      <div className={clsx(
                        "bubble-markdown prose prose-sm max-w-none break-words",
                        theme === "dark" ? "prose-invert" : ""
                      )}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline" />
                            ),
                          }}
                        >
                          {normalizeReplyText(
                            message.content || (message.isStreaming ? "正在思考中..." : ""),
                          )}
                        </ReactMarkdown>
                        {message.isStreaming && <span className="typing-caret">|</span>}
                      </div>
                    </div>
                    <time className={clsx(
                      "text-[0.85em] px-1 mt-1 opacity-80 font-medium",
                      theme === "dark" ? "text-slate-500" : "text-[var(--text-soft)]"
                    )}>
                      {message.timestamp}
                    </time>
                  </div>
                </article>
              ))}
              <div ref={messageBottomRef} />
            </div>
          ) : (
            <div className={clsx(
              "mx-auto mt-6 max-w-2xl rounded-2xl border p-8 text-center text-sm shadow-[var(--shadow)]",
              theme === "dark" ? "border-slate-800 bg-slate-900 text-slate-500" : "border-[var(--line)] bg-white text-[var(--text-soft)]"
            )}>
              开始新对话，支持输入文本和上传文件。
            </div>
          )}
        </section>

        <footer className={clsx(
          "shrink-0 border-t p-4 transition-colors duration-300",
          theme === "dark" ? "border-slate-800 bg-slate-900" : "border-[var(--line)] bg-[var(--bg-panel)]"
        )}>
          <form
            ref={formRef}
            onSubmit={handleSend}
            className={clsx(
              "mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl border p-3 shadow-sm",
              theme === "dark" ? "border-slate-700 bg-slate-800" : "border-[var(--line)] bg-white"
            )}
          >
            <div className="flex items-stretch gap-3">
              <div className="relative min-h-[190px] flex-1">
                {uploadedFiles.length > 0 && (
                  <div className={clsx(
                    "absolute left-2 right-2 top-2 z-10 grid grid-cols-3 gap-2",
                    theme === "dark" ? "" : ""
                  )}>
                    {uploadedFiles.map((file, index) => (
                      <div
                        key={`${file.file_url}-${index}`}
                        className={clsx(
                          "relative flex items-center gap-1.5 rounded-lg border px-2 py-1.5",
                          theme === "dark" ? "border-slate-600 bg-slate-900/95" : "border-[var(--line)] bg-white/95"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => triggerFileDownload(file)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          title={`下载 ${file.file_name}`}
                        >
                          <div className={clsx(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                            theme === "dark" ? "bg-slate-700 text-slate-200" : "bg-[#f3ece3] text-[var(--text-soft)]"
                          )}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                          </div>
                          <span
                            title={file.file_name}
                            className="max-w-[110px] truncate text-[11px]"
                          >
                            {file.file_name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeUploadedFile(index)}
                          className={clsx(
                            "absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                            theme === "dark"
                              ? "border-slate-500 bg-slate-900 text-slate-300 hover:bg-slate-700"
                              : "border-[#d9ccbb] bg-white text-[var(--text-soft)] hover:bg-[#fff2e9]"
                          )}
                          aria-label={`删除 ${file.file_name}`}
                          title={`删除 ${file.file_name}`}
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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
                  className={clsx(
                    "h-full w-full resize-none overflow-y-auto rounded-xl border px-3 pb-3 pt-3 text-sm outline-none transition-colors focus:border-[var(--accent)]",
                    uploadedFiles.length > 0 ? "pt-[62px]" : "",
                    theme === "dark"
                      ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                      : "border-[var(--line)] bg-white text-[var(--text-main)] placeholder:text-gray-400"
                  )}
                />
              </div>

              <div className="flex w-[108px] flex-col justify-between gap-2">
                <label className={clsx(
                  "flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition",
                  sending || uploading || uploadedFiles.length >= 3 ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                  theme === "dark"
                    ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                    : "border-[var(--line)] bg-white text-[var(--text-main)] hover:bg-[var(--accent-soft)]"
                )}>
                  {uploading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      上传中...
                    </span>
                  ) : (
                    "上传文件"
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    disabled={sending || uploading || uploadedFiles.length >= 3}
                    className="hidden"
                    onChange={handleUploadFile}
                  />
                </label>

                <div className="min-h-5 text-center text-xs text-red-500">
                  {uploadHint}
                </div>

                <button
                  type="submit"
                  disabled={sending || uploading}
                  className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? "发送中..." : "发送"}
                </button>
              </div>
            </div>

            <div className="flex min-h-4 items-center gap-3 text-xs text-[var(--text-soft)]">
              {uploadedFiles.length > 0 && <span>已上传 {uploadedFiles.length}/3 个文件</span>}
              {uploading && <span>文件上传中...</span>}
            </div>

            {errorText && <p className="text-xs text-red-600">{errorText}</p>}
          </form>
        </footer>
      </main>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={clsx(
            "w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in duration-200",
            theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-[var(--text-main)]"
          )}>
            <div className={clsx(
              "mb-6 flex items-center justify-between border-b pb-4",
              theme === "dark" ? "border-slate-800" : "border-gray-100"
            )}>
              <h2 className="text-xl font-bold">设置 (Preference)</h2>
              <button
                onClick={() => setShowSettings(false)}
                className={clsx(
                  "rounded-full p-1 transition",
                  theme === "dark" ? "hover:bg-slate-800" : "hover:bg-gray-100"
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold">主题 (Theme)</label>
                <div className="grid grid-cols-2 gap-3">
                  {['light', 'dark'].map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTheme(t);
                        localStorage.setItem("app_theme", t);
                      }}
                      className={clsx(
                        "rounded-xl border-2 px-4 py-2 text-sm font-medium transition-all",
                        theme === t
                          ? (theme === "dark" ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]")
                          : (theme === "dark" ? "border-slate-800 bg-slate-800 text-slate-400 hover:border-slate-700" : "border-[var(--line)] bg-white text-[var(--text-soft)] hover:border-[var(--text-soft)]")
                      )}
                    >
                      {t === 'light' ? '明亮模式' : '暗黑模式'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">字体大小 (Font Size)</label>
                <div className="grid grid-cols-3 gap-3">
                  {['small', 'medium', 'large'].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setFontSize(s);
                        localStorage.setItem("app_font_size", s);
                      }}
                      className={clsx(
                        "rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all",
                        fontSize === s
                          ? (theme === "dark" ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]")
                          : (theme === "dark" ? "border-slate-800 bg-slate-800 text-slate-400 hover:border-slate-700" : "border-[var(--line)] bg-white text-[var(--text-soft)] hover:border-[var(--text-soft)]")
                      )}
                    >
                      {s === 'small' ? '小' : s === 'medium' ? '中' : '大'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-900/20 transition-all hover:opacity-90 active:scale-95"
              >
                保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showUploadFailToast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="rounded-xl bg-black/80 px-6 py-4 text-base font-semibold text-white shadow-2xl">
            ⚠️抱歉，文件上传失败
          </div>
        </div>
      )}
    </div>
  );
}
