"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { BriefcaseBusinessIcon, EllipsisIcon, PanelLeftCloseIcon, PencilIcon, SearchIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { TooltipIconButton } from "@ui/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ui/components/ui/dialog";
import { cn } from "@ui/lib/utils";

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  conversations: ConversationSummary[];
  isLoading: boolean;
  error: string | null;
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCollapse: () => void;
};

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"] as const;

/** ChatGPT's own buckets, by local calendar day of the last message. */
function groupFor(updatedAt: string, now: Date): (typeof GROUPS)[number] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(updatedAt).getTime();
  const day = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  if (t >= startOfToday - 7 * day) return "Previous 7 days";
  if (t >= startOfToday - 30 * day) return "Previous 30 days";
  return "Older";
}

/**
 * Past conversations, newest first, grouped by day. Every conversation lives in
 * the orchestrator's Mastra Memory (src/mastra/conversations.ts); selecting one
 * reloads its messages AND its files, since the thread id is also its session id.
 */
export function ConversationSidebar({ conversations, isLoading, error, activeId, onSelect, onNew, onRename, onDelete, onCollapse }: Props) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    const map = new Map<(typeof GROUPS)[number], ConversationSummary[]>();
    for (const c of filtered) {
      const g = groupFor(c.updatedAt, now);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return GROUPS.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [conversations, query]);

  return (
    <nav aria-label="Conversations" className="bg-sidebar text-sidebar-foreground flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2 px-1">
          <span className="bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-lg">
            <BriefcaseBusinessIcon className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">Business Ops</span>
        </div>
        <TooltipIconButton tooltip="Close sidebar" side="right" className="text-muted-foreground hover:text-foreground size-9 p-2" onClick={onCollapse}>
          <PanelLeftCloseIcon />
        </TooltipIconButton>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-2">
        <button
          type="button"
          onClick={onNew}
          className="hover:bg-sidebar-accent flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors"
        >
          <SquarePenIcon className="size-4" />
          New chat
        </button>
        <label className="hover:bg-sidebar-accent focus-within:bg-sidebar-accent flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors">
          <SearchIcon className="text-muted-foreground size-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && conversations.length === 0 && (
          <div className="flex flex-col gap-2 px-2.5 pt-4" role="status" aria-label="Loading conversations">
            {[70, 55, 80, 45].map((w, i) => (
              <div key={i} className="bg-sidebar-accent h-4 animate-pulse rounded" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {error && <p className="text-destructive px-2.5 pt-4 text-xs">{error}</p>}
        {!isLoading && !error && conversations.length === 0 && (
          <p className="text-muted-foreground px-2.5 pt-4 text-sm">Your chats will appear here.</p>
        )}
        {query && grouped.length === 0 && conversations.length > 0 && (
          <p className="text-muted-foreground px-2.5 pt-4 text-sm">No chats match &ldquo;{query}&rdquo;.</p>
        )}

        {grouped.map((group) => (
          <div key={group.label} className="pt-4">
            <h3 className="text-muted-foreground px-2.5 pb-1 text-xs font-medium">{group.label}</h3>
            <ul className="flex flex-col gap-px">
              {group.items.map((c) => (
                <li key={c.id}>
                  {renamingId === c.id ? (
                    <RenameInput
                      initial={c.title}
                      onDone={async (title) => {
                        setRenamingId(null);
                        if (title && title !== c.title) await onRename(c.id, title);
                      }}
                    />
                  ) : (
                    <ConversationRow
                      conversation={c}
                      active={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onRename={() => setRenamingId(c.id)}
                      onDelete={() => setPendingDelete(c)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-sidebar-border text-muted-foreground shrink-0 border-t px-4 py-3 text-xs leading-relaxed">
        Answers are computed from your files and cited.
        <br />
        Gemini 2.5 Flash, Groq as fallback.
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              This deletes <strong className="text-foreground font-medium">{pendingDelete?.title}</strong> and its file list. Files you
              downloaded are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-full bg-[#d92d20] text-white hover:bg-[#b42318]"
              disabled={isDeleting}
              onClick={async () => {
                if (!pendingDelete) return;
                setIsDeleting(true);
                try {
                  await onDelete(pendingDelete.id);
                } finally {
                  setIsDeleting(false);
                  setPendingDelete(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        "group relative flex h-9 items-center rounded-lg transition-colors",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
        menuOpen && "bg-sidebar-accent",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        title={conversation.title}
        className="min-w-0 flex-1 truncate px-2.5 text-left text-sm"
      >
        {conversation.title}
      </button>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-label={`Options for ${conversation.title}`}
          className={cn(
            "text-muted-foreground hover:text-foreground mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-opacity",
            active || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <EllipsisIcon className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
            <Menu.Popup className="bg-popover text-popover-foreground data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 min-w-36 rounded-xl border p-1.5 shadow-lg outline-none">
              <Menu.Item
                onClick={onRename}
                className="data-highlighted:bg-muted flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none"
              >
                <PencilIcon className="size-4" />
                Rename
              </Menu.Item>
              <Menu.Item
                onClick={onDelete}
                className="data-highlighted:bg-destructive/10 text-destructive flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none"
              >
                <Trash2Icon className="size-4" />
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Chat title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      className="bg-background ring-ring h-9 w-full rounded-lg px-2.5 text-sm ring-1 outline-none"
    />
  );
}
