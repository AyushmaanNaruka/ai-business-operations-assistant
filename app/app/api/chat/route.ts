import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from "ai";
import { mastra } from "@/mastra";
import { CHAT_RESOURCE_ID, ensureConversation } from "@/mastra/conversations";
import { ORCHESTRATOR_MAX_STEPS } from "@/mastra/models";
import { firstUserText, messageText } from "@/modules/session";
import { enforceRateLimit, internalError, invalidSessionIdResponse, readSessionId } from "@ui/lib/server-security";

// docs/03-ARCHITECTURE.md Part 10 gap 2: long work (a multi-specialist "mixed"
// turn, two artifact workflows) can pass 20-30s comfortably. The design point is
// that long work runs as a Mastra workflow run with an id, not a longer HTTP
// request (request_artifact already does this, P6.6/P6.7) — this just gives the
// streamed turn itself, which stays open the whole time sending real bytes, room
// to finish rather than being cut off at the framework default.
export const maxDuration = 60;

/** A long conversation resends its whole history, tool outputs included; this still bounds it. */
function maxBodyBytes(): number {
  const mb = Number(process.env.CHAT_MAX_BODY_MB || "8");
  return (Number.isFinite(mb) && mb > 0 ? mb : 8) * 1024 * 1024;
}
const MAX_MESSAGES = 400;

type IncomingBody = { sessionId?: unknown; messages?: unknown; trigger?: unknown };

/**
 * Keeps only what a conversation legitimately contains: user and assistant
 * messages with a parts array. A client supplied `system` message would otherwise
 * reach the orchestrator as an instruction (AGENTS.md rule 4, docs/DECISIONS.md D-56).
 */
function sanitizeMessages(value: unknown): UIMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const kept: UIMessage[] = [];
  for (const m of value) {
    if (!m || typeof m !== "object") return null;
    const { id, role, parts } = m as { id?: unknown; role?: unknown; parts?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (!Array.isArray(parts) || (id !== undefined && typeof id !== "string")) return null;
    kept.push(m as UIMessage);
  }
  return kept.length > 0 ? kept : null;
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "chat");
  if (limited) return limited;

  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > maxBodyBytes()) {
    return Response.json({ error: "This conversation is too long to send in one request. Start a new chat." }, { status: 413 });
  }

  let body: IncomingBody;
  try {
    const text = await req.text();
    if (text.length > maxBodyBytes()) {
      return Response.json({ error: "This conversation is too long to send in one request. Start a new chat." }, { status: 413 });
    }
    body = JSON.parse(text) as IncomingBody;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  // `sessionId`, not assistant-ui's own `id`: assistant-ui keeps an internal
  // `__LOCALID_...` thread id that never matches the id the sources panel
  // uploads under (verified live). `sessionId` is sent explicitly through
  // AssistantChatTransport's `body` option (app/app/assistant.tsx); Mastra's
  // Memory keys the thread off it, and the orchestrator's tools resolve the same
  // id from `context.agent.threadId` (src/mastra/runtime.ts resolveSessionId),
  // so one browser conversation gets one manifest end to end.
  const threadId = readSessionId(body.sessionId);
  if (!threadId) return invalidSessionIdResponse();

  const messages = sanitizeMessages(body.messages);
  if (!messages) return Response.json({ error: "The request carried no valid conversation messages." }, { status: 400 });
  const trigger = body.trigger === "regenerate-message" ? "regenerate-message" : "submit-message";

  // Creates the conversation's thread on its first message, titled from that
  // message, so the sidebar lists it before the answer finishes streaming
  // (src/mastra/conversations.ts). Best effort: if this fails, Mastra still
  // creates the thread itself when it saves the turn, just with a placeholder
  // title the sidebar derives a real one from on read.
  try {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    await ensureConversation(threadId, firstUserText(messages) || (latestUser ? messageText(latestUser) : ""));
  } catch {
    // see above
  }

  try {
    const stream = await handleChatStream({
      mastra,
      agentId: "orchestrator",
      // Only these three fields, never the rest of the body. handleChatStream's
      // params are Mastra's full agent execution options, which include
      // `instructions`, `system`, `toolsets`, `clientTools` and model settings;
      // spreading the request body in (as this route once did) let any client
      // rewrite the orchestrator's instructions or hand it new tools (D-56).
      params: {
        // `any`, type level only (AGENTS.md asks for the reason): @mastra/ai-sdk
        // vendors its own snapshot of the AI SDK UIMessage type, which the
        // installed `ai` package's UIMessage no longer matches field for field,
        // and the overload's own message type is not exported to cast to. The
        // runtime shape was validated by sanitizeMessages above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        trigger,
        memory: { thread: threadId, resource: CHAT_RESOURCE_ID },
        // Server-set, never from the body (D-63).
        maxSteps: ORCHESTRATOR_MAX_STEPS,
      },
      // The default error serializer forwards the provider's raw message and
      // stack (docs/09-TESTING.md P7.4: "no stack traces"). A model call failing
      // is a normal, expected failure mode, not a bug to expose the internals of.
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] model error:", message);
        if (/usage limit|billing|credit balance/i.test(message)) {
          // Anthropic's spend cap arrives as an HTTP 400 invalid_request_error, so it
          // matches none of the rate limit wording below.
          return "A model provider's usage or billing limit has been reached. An administrator should check the provider account.";
        }
        if (/quota|rate limit|429|overloaded|high demand|503|request too large|tokens per minute/i.test(message)) {
          // Reaching here means every model in the tier's fallback chain
          // (src/mastra/models.ts) was rate limited or overloaded.
          return "The model providers are rate limiting or overloaded right now. Wait a minute and try again.";
        }
        if (/api key|x-api-key|authentication|unauthorized|401/i.test(message)) {
          return "A model provider rejected its API key. An administrator should check the keys in .env.";
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
    // misconfiguration) never reaches onError above, since that only wraps
    // errors during the stream itself (AGENTS.md rule 5).
    return internalError("Could not start answering", err);
  }
}
