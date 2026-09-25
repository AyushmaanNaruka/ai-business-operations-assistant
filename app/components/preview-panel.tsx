"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, ExternalLinkIcon, Loader2Icon, XIcon } from "lucide-react";
import { TooltipIconButton } from "@ui/components/assistant-ui/elements/tooltip-icon-button";
import { FileKindIcon, fileKindLabel } from "@ui/components/file-icon";
import { previewKey, previewQuery, useSessionFiles, type PreviewTarget } from "@ui/components/session-files";
import { cn } from "@ui/lib/utils";

/** Mirrors src/modules/preview/types.ts FilePreview. Kept as a local copy so the browser bundle imports no server module. */
type PreviewTable = { name: string; columns: string[]; rows: string[][]; totalRows: number };
type FilePreview =
  | { type: "pdf" }
  | { type: "text"; format: "markdown" | "plain" | "json"; text: string; truncated: boolean }
  | { type: "table"; sheets: PreviewTable[] }
  | { type: "html"; html: string }
  | { type: "slides"; slides: { number: number; title: string; body: string[] }[] };

type PreviewResponse = {
  file: { name: string; kind: string; origin: "source" | "artifact"; downloadUrl?: string };
  preview: FilePreview;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PreviewResponse };

/**
 * The right hand preview, Claude style: click a source or a generated file (in the
 * files panel, the composer's chips, or a download link in an answer) and it opens
 * here beside the chat instead of downloading. Content arrives as a typed
 * FilePreview built by deterministic code on the server (src/modules/preview).
 */
export function PreviewPanel({ target }: { target: PreviewTarget }) {
  const { threadId, closePreview } = useSessionFiles();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const query = previewQuery(threadId, target);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/preview?${query}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setState({ status: "error", message: data.error ?? "This file could not be previewed." });
        else setState({ status: "ready", data: data as PreviewResponse });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const file = state.status === "ready" ? state.data.file : null;
  const kind = file?.kind ?? ("file" in target ? target.file.split(".").pop() ?? "" : "");
  const rawUrl = `/api/preview/file?${query}`;
  const downloadUrl = file?.downloadUrl;

  return (
    <section aria-label={`Preview of ${target.label}`} className="bg-background flex h-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <FileKindIcon kind={kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file?.name ?? target.label}>
            {file?.name ?? target.label}
          </p>
          <p className="text-muted-foreground text-xs">
            {fileKindLabel(kind)}
            {file ? (file.origin === "artifact" ? " · Generated" : " · Uploaded") : ""}
          </p>
        </div>
        {file?.origin === "source" && file.kind !== "web" && (
          <TooltipIconButton tooltip="Open in new tab" className="size-8 p-1.5" onClick={() => window.open(rawUrl, "_blank", "noopener")}>
            <ExternalLinkIcon />
          </TooltipIconButton>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium no-underline transition-colors"
          >
            <DownloadIcon className="size-3.5" />
            Download
          </a>
        )}
        <TooltipIconButton tooltip="Close preview" className="size-8 p-1.5" onClick={closePreview}>
          <XIcon />
        </TooltipIconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto" key={previewKey(target)}>
        {state.status === "loading" && (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm" role="status">
            <Loader2Icon className="size-4 animate-spin" />
            Loading preview
          </div>
        )}
        {state.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-medium">No preview available</p>
            <p className="text-muted-foreground max-w-sm text-sm">{state.message}</p>
          </div>
        )}
        {state.status === "ready" && <PreviewBody preview={state.data.preview} rawUrl={rawUrl} name={state.data.file.name} />}
      </div>
    </section>
  );
}

function PreviewBody({ preview, rawUrl, name }: { preview: FilePreview; rawUrl: string; name: string }) {
  switch (preview.type) {
    case "pdf":
      return <iframe src={rawUrl} title={name} className="h-full w-full border-0" />;
    case "html":
      // sandbox="" : no scripts, no forms, no same origin access, no popups. The
      // document also carries its own no script CSP (src/modules/preview).
      return <iframe srcDoc={preview.html} sandbox="" title={name} className="h-full w-full border-0 bg-white" />;
    case "table":
      return <TablePreview sheets={preview.sheets} />;
    case "slides":
      return <SlidesPreview slides={preview.slides} />;
    case "text":
      return (
        <div className="px-6 py-5">
          <pre
            className={cn(
              "text-foreground text-sm leading-relaxed break-words whitespace-pre-wrap",
              preview.format === "json" ? "font-mono text-[0.8rem]" : "font-sans",
            )}
          >
            {preview.text}
          </pre>
          {preview.truncated && <p className="text-muted-foreground mt-4 text-xs">Preview truncated. Download the file to see all of it.</p>}
        </div>
      );
  }
}

function TablePreview({ sheets }: { sheets: PreviewTable[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  if (!sheet) return <p className="text-muted-foreground p-6 text-sm">This workbook has no sheets.</p>;

  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2" role="tablist">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                i === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="bg-sidebar text-muted-foreground sticky top-0 left-0 z-20 w-10 border-r border-b px-2 py-2 text-right font-normal">#</th>
              {sheet.columns.map((c, i) => (
                <th key={i} className="bg-sidebar sticky top-0 z-10 border-b px-3 py-2 text-left font-semibold whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className="hover:bg-muted/60">
                <td className="bg-background text-muted-foreground sticky left-0 border-r border-b px-2 py-1.5 text-right tabular-nums">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className="max-w-72 truncate border-b px-3 py-1.5 whitespace-nowrap tabular-nums" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground shrink-0 border-t px-4 py-2 text-xs">
        {sheet.rows.length < sheet.totalRows
          ? `Showing the first ${sheet.rows.length.toLocaleString()} of ${sheet.totalRows.toLocaleString()} rows`
          : `${sheet.totalRows.toLocaleString()} rows`}{" "}
        · {sheet.columns.length} columns
      </p>
    </div>
  );
}

function SlidesPreview({ slides }: { slides: { number: number; title: string; body: string[] }[] }) {
  if (slides.length === 0) return <p className="text-muted-foreground p-6 text-sm">This presentation has no slides.</p>;
  return (
    <div className="bg-sidebar flex flex-col gap-4 p-5">
      <p className="text-muted-foreground text-xs">
        {slides.length} slides · text outline. Charts and images appear in the downloaded file.
      </p>
      {slides.map((slide) => (
        <article key={slide.number} className="bg-background aspect-[16/9] overflow-hidden rounded-xl border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-muted-foreground mb-2 text-[0.7rem] font-medium tabular-nums">Slide {slide.number}</p>
          <h3 className="mb-3 text-base leading-snug font-semibold">{slide.title || "Untitled slide"}</h3>
          <ul className="flex flex-col gap-1.5 text-sm leading-snug">
            {slide.body.slice(0, 8).map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="bg-foreground/40 mt-2 size-1 shrink-0 rounded-full" aria-hidden />
                <span className="line-clamp-2">{line}</span>
              </li>
            ))}
            {slide.body.length > 8 && <li className="text-muted-foreground text-xs">+{slide.body.length - 8} more lines</li>}
          </ul>
        </article>
      ))}
    </div>
  );
}
