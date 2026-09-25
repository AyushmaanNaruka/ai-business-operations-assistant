import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { mastra } from "@/mastra";

// docs/03-ARCHITECTURE.md Part 10 gap 2: long work (a multi-specialist "mixed"
// turn, two artifact workflows) can pass 20-30s comfortably. The design point is
// that long work runs as a Mastra workflow run with an id, not a longer HTTP
// request (request_artifact already does this, P6.6/P6.7) — this just gives the
// streamed turn itself, which stays open the whole time sending real bytes, room
// to finish rather than being cut off at the framework default.
export const maxDuration = 60;

export async function POST(req: Request) {
  // `any`: the request body is whatever AssistantChatTransport sent (AGENTS.md
  // requires a reason for this) — handleChatStream's own params type is what
  // actually gets validated structurally, a couple of lines below.
  let params: any;
  try {
    params = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  // AssistantChatTransport sends `id` (assistant-ui's per-conversation chat id,
  // stable for the life of the browser tab per app/assistant.tsx) on every
  // request; Mastra's Memory keys a working-memory thread off exactly this kind
  // of id, and this session's own tools (read_session_manifest, handle_request,
  // request_artifact — src/mastra/agents/orchestrator.ts) resolve the SAME id
  // from `context.agent.threadId` (src/mastra/runtime.ts resolveSessionId), so
  // one browser conversation gets one manifest end to end.
  const threadId = typeof params.id === "string" && params.id.length > 0 ? params.id : "default-thread";

  try {
    const stream = await handleChatStream({
      mastra,
      agentId: "orchestrator",
      params: {
        ...params,
        memory: { thread: threadId, resource: "demo-user" },
      },
      // The default error serializer still forwards the provider's raw message
      // and stack (docs/09-TESTING.md P7.4: "no stack traces" is one of the
      // bars a breakage case has to clear). A model call failing — a rate
      // limit, a dropped connection — is itself a normal, expected failure
      // mode, not a bug to expose the internals of.
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/quota|rate limit|429/i.test(message)) {
          return "The model provider's free tier is temporarily rate limited. Please wait a moment and try again.";
        }
        return "Something went wrong answering that. Please try again.";
      },
    });

    // @mastra/ai-sdk vendors its own snapshot of the AI SDK v5 stream chunk
    // types, which lags one field behind the actually-installed `ai` package
    // here (`finishReason` gained a "unknown" case upstream); the runtime
    // shape is identical, only the two packages' type snapshots disagree, so
    // this is a type-level cast, not a behavior change.
    return createUIMessageStreamResponse({ stream: stream as ReadableStream<UIMessageChunk> });
  } catch (err) {
    // A failure before streaming even starts (a bad agent id, a memory
    // misconfiguration) never reaches the AI SDK's own onError above, since
    // that only wraps errors during the stream itself (AGENTS.md rule 5).
    return Response.json({ error: `Could not start answering: ${(err as Error).message}` }, { status: 500 });
  }
}
