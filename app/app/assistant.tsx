"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { FolderOpenIcon, PanelLeftOpenIcon, SquarePenIcon } from "lucide-react";
import { Thread } from "@ui/components/assistant-ui/elements/thread.aui";
import { TooltipIconButton } from "@ui/components/assistant-ui/elements/tooltip-icon-button";
import { ConversationSidebar, type ConversationSummary } from "@ui/components/conversation-sidebar";
import { PreviewPanel } from "@ui/components/preview-panel";
import { SessionFilesProvider, useSessionFiles } from "@ui/components/session-files";
import { SourcesPanel } from "@ui/components/sources-panel";
import { Button } from "@ui/components/ui/button";
import { cn } from "@ui/lib/utils";

type ActiveConversation = { id: string; isNew: boolean };

/** `?c=<id>` keeps the open conversation across a refresh and makes the back button work. */
function conversationIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("c");
}

function setUrlConversation(id: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export const Assistant = () => {
  // null until mounted: the open conversation comes from the URL, which the
  // server render cannot see, so nothing conversation specific renders before then.
  const [active, setActive] = useState<ActiveConversation | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load conversations.");
      setConversations(data.conversations as ConversationSummary[]);
      setListError(null);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const fromUrl = conversationIdFromUrl();
    setActive(fromUrl ? { id: fromUrl, isNew: false } : { id: crypto.randomUUID(), isNew: true });
    void refreshConversations();
    const onPop = () => {
      const id = conversationIdFromUrl();
      setActive((prev) => (id ? (prev?.id === id ? prev : { id, isNew: false }) : { id: crypto.randomUUID(), isNew: true }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [refreshConversations]);

  const selectConversation = useCallback((id: string) => {
    setMobileSidebarOpen(false);
    setActive((prev) => (prev?.id === id ? prev : { id, isNew: false }));
    setUrlConversation(id, "push");
  }, []);

  const newConversation = useCallback(() => {
    setMobileSidebarOpen(false);
    setActive({ id: crypto.randomUUID(), isNew: true });
    setUrlConversation(null, "push");
  }, []);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch(() => {});
      void refreshConversations();
    },
    [refreshConversations],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (active?.id === id) newConversation();
      void refreshConversations();
    },
    [active?.id, newConversation, refreshConversations],
  );

  // A run starting means the chat route has (or is about to have) created the
  // thread: list it, and put its id in the URL so a refresh comes back here.
  const onRunActivity = useCallback(
    (running: boolean, id: string) => {
      if (running) {
        setUrlConversation(id, "replace");
        setTimeout(() => void refreshConversations(), 800);
      } else {
        void refreshConversations();
      }
    },
    [refreshConversations],
  );

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      isLoading={listLoading}
      error={listError}
      activeId={active?.id ?? ""}
      onSelect={selectConversation}
      onNew={newConversation}
      onRename={renameConversation}
      onDelete={deleteConversation}
      onCollapse={() => {
        setSidebarOpen(false);
        setMobileSidebarOpen(false);
      }}
    />
  );

  const title = conversations.find((c) => c.id === active?.id)?.title;

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none md:block",
          sidebarOpen ? "w-[260px]" : "w-0",
        )}
        aria-hidden={!sidebarOpen}
      >
        <div className="h-full w-[260px]">{sidebar}</div>
      </aside>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="animate-in fade-in absolute inset-0 bg-black/30" onClick={() => setMobileSidebarOpen(false)} aria-hidden />
          <div className="animate-in slide-in-from-left absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-xl duration-200">{sidebar}</div>
        </div>
      )}

      {active && (
        <SessionFilesProvider key={active.id} threadId={active.id}>
          <Workspace
            active={active}
            title={title}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => {
              setSidebarOpen(true);
              setMobileSidebarOpen(true);
            }}
            onNewConversation={newConversation}
            onRunActivity={onRunActivity}
          />
        </SessionFilesProvider>
      )}
    </div>
  );
};

function Workspace({
  active,
  title,
  sidebarOpen,
  onOpenSidebar,
  onNewConversation,
  onRunActivity,
}: {
  active: ActiveConversation;
  title: string | undefined;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onNewConversation: () => void;
  onRunActivity: (running: boolean, id: string) => void;
}) {
  const { preview, closePreview, filesOpen, setFilesOpen, sources, artifacts } = useSessionFiles();
  const fileCount = sources.length + artifacts.length;
  const panelOpen = preview !== null || filesOpen;

  return (
    <div className="flex min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2 md:px-3">
          <TooltipIconButton
            tooltip="Open sidebar"
            className={cn("text-muted-foreground hover:text-foreground size-9 p-2", sidebarOpen && "md:hidden")}
            onClick={onOpenSidebar}
          >
            <PanelLeftOpenIcon />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="New chat"
            className={cn("text-muted-foreground hover:text-foreground size-9 p-2", sidebarOpen && "md:hidden")}
            onClick={onNewConversation}
          >
            <SquarePenIcon />
          </TooltipIconButton>
          <h1 className="min-w-0 truncate px-2 text-[0.95rem] font-medium">{title ?? "Business Operations Assistant"}</h1>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              className={cn("h-9 gap-2 rounded-full px-3 text-sm", filesOpen && !preview && "bg-muted")}
              onClick={() => {
                // With a preview open, Files goes back to the file list rather than closing the panel.
                if (preview) {
                  closePreview();
                  setFilesOpen(true);
                } else setFilesOpen(!filesOpen);
              }}
              aria-pressed={filesOpen && !preview}
            >
              <FolderOpenIcon className="size-4" />
              Files
              {fileCount > 0 && (
                <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-semibold tabular-nums">
                  {fileCount}
                </span>
              )}
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <ChatSession key={active.id} id={active.id} isNew={active.isNew} onNewConversation={onNewConversation} onRunActivity={onRunActivity} />
        </div>
      </main>

      {panelOpen && (
        <aside
          className={cn(
            "bg-background animate-in fade-in slide-in-from-right-4 fixed inset-0 z-30 duration-200 motion-reduce:animate-none lg:static lg:z-auto lg:shrink-0 lg:border-l",
            preview ? "lg:w-[min(48vw,760px)]" : "lg:w-80",
          )}
        >
          {preview ? <PreviewPanel target={preview} /> : <SourcesPanel />}
        </aside>
      )}
    </div>
  );
}

type HistoryState = { status: "loading" } | { status: "missing"; message: string } | { status: "ready"; messages: UIMessage[] };

/** Loads a past conversation's messages, then seeds the chat runtime with them so it continues where it left off. */
function ChatSession({
  id,
  isNew,
  onNewConversation,
  onRunActivity,
}: {
  id: string;
  isNew: boolean;
  onNewConversation: () => void;
  onRunActivity: (running: boolean, id: string) => void;
}) {
  const [history, setHistory] = useState<HistoryState>(isNew ? { status: "ready", messages: [] } : { status: "loading" });

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setHistory({ status: "missing", message: data.error ?? "That conversation could not be loaded." });
        else setHistory({ status: "ready", messages: data.messages as UIMessage[] });
      } catch (err) {
        if (!cancelled) setHistory({ status: "missing", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  if (history.status === "loading") return <HistorySkeleton />;
  if (history.status === "missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-base font-medium">This chat is not available</p>
        <p className="text-muted-foreground max-w-sm text-sm">{history.message}</p>
        <Button className="rounded-full px-4" onClick={onNewConversation}>
          Start a new chat
        </Button>
      </div>
    );
  }
  return <ChatRuntime id={id} initialMessages={history.messages} onRunActivity={onRunActivity} />;
}

function ChatRuntime({
  id,
  initialMessages,
  onRunActivity,
}: {
  id: string;
  initialMessages: UIMessage[];
  onRunActivity: (running: boolean, id: string) => void;
}) {
  // `sessionId` in the body, not assistant-ui's own thread id: assistant-ui keeps
  // an internal `__LOCALID_...` thread id that never matches this conversation's
  // id, so /api/chat keys Mastra Memory and the session manifest off this field
  // (app/app/api/chat/route.ts). One transport per conversation, created once.
  const [transport] = useState(() => new AssistantChatTransport({ api: "/api/chat", body: { sessionId: id } }));
  const runtime = useChatRuntime({
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RunWatcher id={id} onRunActivity={onRunActivity} />
      <Thread />
    </AssistantRuntimeProvider>
  );
}

/** Tells the shell when a turn starts or ends, so the sidebar can list and re-sort this conversation. */
function RunWatcher({ id, onRunActivity }: { id: string; onRunActivity: (running: boolean, id: string) => void }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { clearRecentUploads } = useSessionFiles();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (isRunning) clearRecentUploads();
    onRunActivity(isRunning, id);
  }, [isRunning, id, onRunActivity, clearRecentUploads]);
  return null;
}

function HistorySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8" role="status">
      <span className="sr-only">Loading conversation</span>
      <div className="flex animate-pulse flex-col gap-6 motion-reduce:animate-none">
        <div className="bg-muted ml-auto h-10 w-2/5 rounded-3xl" />
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-4 w-11/12 rounded-md" />
          <div className="bg-muted h-4 w-4/5 rounded-md" />
          <div className="bg-muted h-4 w-3/5 rounded-md" />
        </div>
        <div className="bg-muted ml-auto h-10 w-1/3 rounded-3xl" />
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-4 w-10/12 rounded-md" />
          <div className="bg-muted h-4 w-2/3 rounded-md" />
        </div>
      </div>
    </div>
  );
}
