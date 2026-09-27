"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type SourceStatus = "pending" | "ready" | "failed";

export type SessionSource = {
  id: string;
  name: string;
  kind: string;
  status: SourceStatus;
  addedAt: string;
  error?: { code: string; message: string };
  // Present once ingestion finishes (src/types/source.ts): what was actually extracted.
  doc?: { pageCount?: number };
  tables?: { tableName: string; rowCount: number }[];
};

export type SessionArtifact = {
  id: string;
  title: string;
  kind: string;
  version: number;
  downloadUrl: string;
};

/** What the preview panel is showing. Mirrors the query parameters /api/preview accepts. */
export type PreviewTarget =
  | { sourceId: string; label: string }
  | { artifactId: string; version: number; label: string }
  | { file: string; label: string };

type SessionFilesValue = {
  threadId: string;
  sources: SessionSource[];
  artifacts: SessionArtifact[];
  uploadError: string | null;
  isUploading: boolean;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  dismissUploadError: () => void;
  /** Sources uploaded since the last message was sent: the composer shows these as attachment chips. */
  recentSources: SessionSource[];
  clearRecentUploads: () => void;
  preview: PreviewTarget | null;
  openPreview: (target: PreviewTarget) => void;
  closePreview: () => void;
  filesOpen: boolean;
  setFilesOpen: (open: boolean) => void;
};

const SessionFilesContext = createContext<SessionFilesValue | null>(null);

export const ACCEPTED_EXTENSIONS = ".xlsx,.csv,.pdf,.docx,.txt,.md,.markdown,.json";

/**
 * Polling interval for the conversation's manifest. Plain polling rather than a
 * socket: the manifest is small and changes at human speed (an upload settling, a
 * workflow finishing), docs/09-TESTING.md's "the interface is not what is being
 * graded". Slower once nothing is pending, since then only a new artifact can change.
 */
const POLL_MS_ACTIVE = 2000;
const POLL_MS_IDLE = 5000;

/** One conversation's files: its uploaded sources, generated artifacts, and the open preview. */
export function SessionFilesProvider({ threadId, children }: { threadId: string; children: ReactNode }) {
  const [sources, setSources] = useState<SessionSource[]>([]);
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const hasPending = sources.some((s) => s.status === "pending") || uploading > 0;

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/manifest?threadId=${encodeURIComponent(threadId)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { sources: SessionSource[]; artifacts: SessionArtifact[] };
        if (cancelled) return;
        setSources(data.sources);
        setArtifacts(data.artifacts);
      } catch {
        // A missed poll is invisible to the user next tick; nothing to surface.
      }
    }
    void poll();
    const interval = setInterval(poll, hasPending ? POLL_MS_ACTIVE : POLL_MS_IDLE);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [threadId, hasPending]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploadError(null);
      for (const file of Array.from(files)) {
        setUploading((n) => n + 1);
        try {
          const res = await fetch(
            `/api/upload?threadId=${encodeURIComponent(threadId)}&name=${encodeURIComponent(file.name)}`,
            { method: "POST", body: file },
          );
          const data = await res.json();
          if (!res.ok) {
            setUploadError(data.error ?? `"${file.name}" failed to upload.`);
            continue;
          }
          const source = data.source as SessionSource;
          setSources((prev) => [...prev.filter((s) => s.id !== source.id), source]);
          setRecentIds((prev) => [...prev, source.id]);
        } catch (err) {
          setUploadError(`"${file.name}" failed to upload: ${(err as Error).message}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [threadId],
  );

  const clearRecentUploads = useCallback(() => setRecentIds([]), []);
  const recentSources = useMemo(() => sources.filter((s) => recentIds.includes(s.id)), [sources, recentIds]);

  const value = useMemo<SessionFilesValue>(
    () => ({
      threadId,
      sources,
      artifacts,
      uploadError,
      isUploading: uploading > 0,
      uploadFiles,
      dismissUploadError: () => setUploadError(null),
      recentSources,
      clearRecentUploads,
      preview,
      openPreview: (target) => setPreview(target),
      closePreview: () => setPreview(null),
      filesOpen,
      setFilesOpen,
    }),
    [threadId, sources, artifacts, uploadError, uploading, uploadFiles, recentSources, clearRecentUploads, preview, filesOpen],
  );

  return <SessionFilesContext.Provider value={value}>{children}</SessionFilesContext.Provider>;
}

export function useSessionFiles(): SessionFilesValue {
  const value = useContext(SessionFilesContext);
  if (!value) throw new Error("useSessionFiles must be used inside a SessionFilesProvider.");
  return value;
}

/** For components that also render outside a conversation (the markdown link renderer). */
export function useOptionalSessionFiles(): SessionFilesValue | null {
  return useContext(SessionFilesContext);
}

/** The query string /api/preview and /api/preview/file take for a target. */
export function previewQuery(threadId: string, target: PreviewTarget): string {
  const params = new URLSearchParams({ threadId });
  if ("sourceId" in target) params.set("sourceId", target.sourceId);
  else if ("artifactId" in target) {
    params.set("artifactId", target.artifactId);
    params.set("version", String(target.version));
  } else params.set("file", target.file);
  return params.toString();
}

export function previewKey(target: PreviewTarget): string {
  if ("sourceId" in target) return `source:${target.sourceId}`;
  if ("artifactId" in target) return `artifact:${target.artifactId}:v${target.version}`;
  return `file:${target.file}`;
}
