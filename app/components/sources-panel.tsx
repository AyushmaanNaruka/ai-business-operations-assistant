"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { DownloadIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { TooltipIconButton } from "@ui/components/assistant-ui/elements/tooltip-icon-button";
import { FileKindIcon, fileKindLabel } from "@ui/components/file-icon";
import { ACCEPTED_EXTENSIONS, previewKey, useSessionFiles, type SessionSource, type SourceStatus } from "@ui/components/session-files";
import { cn } from "@ui/lib/utils";

const STATUS_LABEL: Record<SourceStatus, string> = { pending: "Reading…", ready: "Ready", failed: "Failed" };

/**
 * The conversation's files, on the right: upload, per source ingestion status, and
 * generated artifacts. Every row opens in the preview panel; generated files also
 * keep a direct download button. P7.1's three things beyond plain chat, moved out
 * of the left column so that column can hold the conversation history instead.
 */
export function SourcesPanel() {
  const { sources, artifacts, uploadFiles, uploadError, dismissUploadError, isUploading, openPreview, preview, setFilesOpen } =
    useSessionFiles();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeKey = preview ? previewKey(preview) : null;

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
    e.target.value = "";
  };

  return (
    <section aria-label="Files in this chat" className="bg-background flex h-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">Files</h2>
        <TooltipIconButton tooltip="Close files" className="size-8 p-1.5" onClick={() => setFilesOpen(false)}>
          <XIcon />
        </TooltipIconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div
          data-dragging={isDragging}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors",
            isDragging ? "border-foreground/40 bg-muted" : "border-foreground/15",
          )}
        >
          <span className="bg-muted inline-flex size-9 items-center justify-center rounded-full">
            {isUploading ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          </span>
          <p className="text-sm">
            Drop files here or{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => fileInputRef.current?.click()}>
              browse
            </button>
          </p>
          <p className="text-muted-foreground text-xs">Excel, CSV, PDF, Word, text or JSON</p>
          <input ref={fileInputRef} type="file" className="hidden" multiple accept={ACCEPTED_EXTENSIONS} onChange={onFileInputChange} />
        </div>
        {uploadError && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive -mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs">
            <p className="flex-1">{uploadError}</p>
            <button type="button" aria-label="Dismiss" onClick={dismissUploadError}>
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}

        <FileGroup title="Sources" empty="No files in this chat yet.">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              active={activeKey === `source:${source.id}`}
              onOpen={() => openPreview({ sourceId: source.id, label: source.name })}
            />
          ))}
        </FileGroup>

        {artifacts.length > 0 && (
          <FileGroup title="Generated" empty="">
            {artifacts.map((artifact) => {
              const key = `artifact:${artifact.id}:v${artifact.version}`;
              return (
                <div
                  key={key}
                  className={cn("group flex items-center gap-1 rounded-xl pr-1 transition-colors", activeKey === key ? "bg-accent" : "hover:bg-muted")}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
                    onClick={() => openPreview({ artifactId: artifact.id, version: artifact.version, label: artifact.title })}
                  >
                    <FileKindIcon kind={artifact.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{artifact.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        {fileKindLabel(artifact.kind)} · v{artifact.version}
                      </span>
                    </span>
                  </button>
                  <a
                    href={artifact.downloadUrl}
                    aria-label={`Download ${artifact.title}`}
                    className="text-muted-foreground hover:text-foreground hover:bg-background inline-flex size-8 items-center justify-center rounded-lg"
                  >
                    <DownloadIcon className="size-4" />
                  </a>
                </div>
              );
            })}
          </FileGroup>
        )}
      </div>
    </section>
  );
}

function FileGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div>
      <h3 className="text-muted-foreground mb-1.5 px-2 text-xs font-medium">{title}</h3>
      <div className="flex flex-col gap-0.5">{hasChildren ? children : <p className="text-muted-foreground px-2 text-sm">{empty}</p>}</div>
    </div>
  );
}

/**
 * What ingestion actually got out of a ready source, so an upload reports more than
 * "Ready": a document's pages and any tables pulled out of it (docs/08-DEMO-SCENARIOS.md
 * Scenario A turn 1, "the PDF reports its extracted table"), a spreadsheet's row count.
 */
function extractionDetails(source: SessionSource): string[] {
  if (source.status !== "ready") return [];
  const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  const tables = source.tables ?? [];
  if (source.doc) {
    const details = source.doc.pageCount ? [plural(source.doc.pageCount, "page")] : [];
    if (tables.length > 0) details.push(`${plural(tables.length, "table")} extracted`);
    return details;
  }
  return tables.length === 1 ? [plural(tables[0]!.rowCount, "row")] : tables.length > 1 ? [plural(tables.length, "table")] : [];
}

function SourceRow({ source, active, onOpen }: { source: SessionSource; active: boolean; onOpen: () => void }) {
  // A pending source's `kind` is a placeholder until type detection finishes; the extension is the better guess.
  const kind = source.status === "pending" ? (source.name.split(".").pop()?.toLowerCase() ?? "") : source.kind;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={source.status === "pending"}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors disabled:cursor-progress",
        active ? "bg-accent" : "hover:bg-muted",
      )}
    >
      <FileKindIcon kind={kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={source.name}>
          {source.name}
        </span>
        <span className={cn("block truncate text-xs", source.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {source.status === "failed" && source.error
            ? source.error.message
            : [fileKindLabel(kind), ...extractionDetails(source), STATUS_LABEL[source.status]].join(" · ")}
        </span>
      </span>
      {source.status === "pending" && <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />}
    </button>
  );
}
