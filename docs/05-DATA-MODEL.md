# Data model

The shared types. These live in `src/types/`, one concept per file. Everything else imports them. Do not redefine any of these locally.

---

## Source

A single piece of input. One registry regardless of origin, so an uploaded PDF and a fetched web page are the same kind of thing downstream.

```ts
export type SourceKind = 'xlsx' | 'csv' | 'pdf' | 'docx' | 'txt' | 'json' | 'web'
export type SourceStatus = 'pending' | 'ready' | 'failed'
export type DocMode = 'full' | 'indexed'

export type TableRef = {
  tableName: string          // the DuckDB table name
  rowCount: number
  columns: { name: string; type: string; nullRate: number }[]
  qualityWarnings: string[]  // "date column has 3 formats", "18 duplicate rows"
}

export type Source = {
  id: string                 // "src_1"
  name: string               // "campaigns.xlsx"
  kind: SourceKind
  origin: 'upload' | 'url'
  status: SourceStatus

  // a source can be BOTH of these
  tables?: TableRef[]        // set when tabular, or when tables were found in a document
  doc?: {
    mode: DocMode
    tokenCount: number
    pageCount?: number
    markdownPath: string
  }

  summary: string            // the source card the orchestrator reads
  proposedTasks?: string[]   // questions found in a requirements document, NEVER auto executed
  addedAt: string
  error?: { code: string; message: string }
}
```

`status` is load bearing. The orchestrator must check it before delegating; a `pending` source means ingestion is still running.

`proposedTasks` is surfaced to the user as a proposal only. File content is data, never instruction.

---

## Evidence

One fact, with its origin and its method. Nothing reaches a user answer or an artifact without one.

```ts
export type EvidenceKind = 'computed' | 'document' | 'web'

export type Evidence = {
  id: string                 // "E7"
  claim: string              // human readable
  kind: EvidenceKind
  sourceId: string
  sourceName: string
  locator: string            // "page 2, Positioning" | "https://..." | "campaigns"
  method?: string            // the SQL, for computed evidence
  value?: number | string
  confidence: 'high' | 'medium' | 'low'
  retrievedAt?: string       // web only
  metric?: MetricKey         // set when comparable, enables conflict detection
  createdAt: string
}

export type MetricKey = {
  name: string               // normalised: "conversion_rate"
  scope: string              // normalised: "channel=email"
  unit: 'ratio' | 'currency' | 'count' | 'duration'
}
```

**Confidence is assigned by rule, not by judgment:**

| Kind | Confidence |
|---|---|
| Computed from SQL | high |
| Quoted from a user supplied document | high |
| Retrieved chunk that survived re-ranking | medium |
| Web page content | medium |
| Inferred across sources | low, and labelled as an inference |

**Conflicts** are detected on matching `metric.name` plus `metric.scope`, with a tolerance by unit. Entries with no `metric` are never compared, which is correct for prose claims.

---

## Finding

A conclusion. Evidence explains how a number was produced; a Finding explains how a conclusion was reached. This is what satisfies "explain how it arrived at important conclusions".

```ts
export type Finding = {
  id: string                 // "F3"
  statement: string          // "Paid social is buying volume, not revenue"
  evidenceIds: string[]      // the facts it rests on
  reasoning: string          // one line: how those facts lead here
  soWhat: string             // the business implication
  confidence: 'high' | 'medium' | 'low'
  caveats?: string[]         // "two months only", "sample of 47"
  createdAt: string
}
```

Chat answers and artifacts cite findings. A finding expands to its evidence. Evidence expands to the SQL, the page or the URL. Three levels, each traceable to the one below.

---

## Specialist contract

Specialists never see chat history. They receive a typed task and return a typed result. This is the lesson from Mastra deprecating `.network()`.

```ts
export type SpecialistTask = {
  objective: string          // one sentence, what to determine
  sourceIds: string[]        // what is in scope
  knownFacts: Evidence[]     // only what matters here, not the conversation
  expect: string             // shape of answer wanted
  constraints?: string[]     // "Q3 only", "exclude paid social"
}

export type SpecialistResult = {
  answer: string
  evidence: Evidence[]
  gaps: string[]             // what it could NOT determine, and why
  failures: ToolFailure[]
}
```

`gaps` is the anti hallucination mechanism. A specialist that cannot find something has a first class way to say so, and the orchestrator is required to report gaps rather than fill them.

---

## Artifact

```ts
export type ArtifactKind = 'xlsx' | 'pptx' | 'docx' | 'pdf'

export type Artifact = {
  id: string                 // "art_1"
  version: number            // revisions keep earlier versions downloadable
  kind: ArtifactKind
  skillUsed: string          // "client-presentation"
  title: string
  path: string
  downloadUrl: string
  findingIds: string[]
  evidenceIds: string[]
  createdAt: string
}
```

---

## Tool result

Every tool returns this. No tool throws. An exception reaching the agent loop is a bug.

```ts
export type ErrorCode =
  | 'SOURCE_NOT_FOUND' | 'SOURCE_PENDING' | 'QUERY_INVALID' | 'QUERY_TIMEOUT'
  | 'NO_DATA'          | 'PARSE_FAILED'   | 'SCANNED_PDF'   | 'FILE_TOO_LARGE'
  | 'ENCRYPTED'        | 'UNSUPPORTED_FORMAT'
  | 'SEARCH_QUOTA'     | 'PAGE_BLOCKED'   | 'NETWORK'       | 'RATE_LIMIT'
  | 'RENDER_FAILED'    | 'PLAN_INVALID'   | 'UNSUPPORTED'

export type ToolFailure = {
  code: ErrorCode
  message: string            // plain language, safe to show the user
  recoverable: boolean
  suggestion?: string        // what to try instead
}

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ToolFailure }
```

**Retry classes:**

| Class | Examples | Policy |
|---|---|---|
| Transient | `NETWORK`, `RATE_LIMIT` | Two retries with backoff, then the fallback provider |
| Correctable | `QUERY_INVALID`, `PLAN_INVALID` | Return the error to the model, two self corrections maximum |
| Terminal | `ENCRYPTED`, `UNSUPPORTED_FORMAT` | No retry. Report clearly, continue with everything else |

---

## Session manifest

Lives in Mastra working memory. The orchestrator reads it first, every turn. Small enough to keep permanently in context, structured enough to route on.

```ts
export type SessionManifest = {
  sources: Source[]          // rendered as source cards
  findings: Finding[]
  artifacts: Artifact[]
  openGaps: string[]         // things the system could not determine this session
}
```

This is why long conversations stay affordable. History grows and gets summarised, losing precision; a manifest stays small and exact. When the user says "compare it with the other one", the reference resolves from here, not from re-reading twenty messages.
