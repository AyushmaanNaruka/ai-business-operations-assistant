import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { mastra } from "@/mastra";
import { CHAT_RESOURCE_ID, ensureConversation } from "@/mastra/conversations";
import { firstUserText, messageText } from "@/modules/session";

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

  // `params.id` is assistant-ui's own internal thread-list id (`__LOCALID_...`
  // until a cloud adapter assigns a real one) — NOT the app's session id, and
  // it never matches the id the sources panel uploads under (verified live:
  // chat POSTs carried `__LOCALID_goZpC89` while uploads/manifest used the
  // app's UUID). `sessionId` is sent explicitly via AssistantChatTransport's
  // `body` option (app/app/assistant.tsx) for exactly this reason; Mastra's
  // Memory keys a working-memory thread off it, and this session's own tools
  // (read_session_manifest, handle_request, request_artifact —
  // src/mastra/agents/orchestrator.ts) resolve the SAME id from
  // `context.agent.threadId` (src/mastra/runtime.ts resolveSessionId), so one
  // browser conversation gets one manifest end to end.
  const threadId =
    typeof params.sessionId === "string" && params.sessionId.length > 0 ? params.sessionId : "default-thread";

  // Creates the conversation's thread on its first message, titled from that
  // message, so the sidebar lists it before the answer finishes streaming
  // (src/mastra/conversations.ts). Best effort: if this fails, Mastra still
  // creates the thread itself when it saves the turn, just with a placeholder
  // title the sidebar derives a real one from on read.
  try {
    const messages: { role?: string; parts?: { type: string; text?: string }[] }[] = Array.isArray(params.messages) ? params.messages : [];
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    await ensureConversation(threadId, firstUserText(messages) || (latestUser ? messageText(latestUser) : ""));
  } catch {
    // see above
  }

  try {
    const stream = await handleChatStream({
      mastra,
      agentId: "orchestrator",
      params: {
        ...params,
        memory: { thread: threadId, resource: CHAT_RESOURCE_ID },
      },
      // The default error serializer still forwards the provider's raw message
      // and stack (docs/09-TESTING.md P7.4: "no stack traces" is one of the
      // bars a breakage case has to clear). A model call failing — a rate
      // limit, a dropped connection — is itself a normal, expected failure
      // mode, not a bug to expose the internals of.
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/quota|rate limit|429/i.test(message)) {
          // Reaching here means every model in the tier's fallback chain
          // (src/mastra/models.ts: Gemini, then Groq) was rate limited.
          return "Both model providers' free tiers are temporarily rate limited. Please wait a moment and try again.";
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
