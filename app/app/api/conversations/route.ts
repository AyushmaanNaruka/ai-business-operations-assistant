import { listConversations } from "@/mastra/conversations";
import { enforceRateLimit, internalError } from "@ui/lib/server-security";

// The chat sidebar's list of past conversations, newest first. Read straight out
// of the orchestrator's Mastra Memory (src/mastra/conversations.ts), which every
// chat turn already writes to; there is no separate history store.
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  try {
    const conversations = await listConversations();
    return Response.json({ conversations });
  } catch (err) {
    // AGENTS.md rule 5: a storage failure reads as a clear error, not a raw 500 page.
    return internalError("Could not load conversations", err);
  }
}
