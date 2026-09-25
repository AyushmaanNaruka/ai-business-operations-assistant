import { deleteConversation, getConversation, renameConversation } from "@/mastra/conversations";
import { enforceRateLimit, internalError, invalidSessionIdResponse, readSessionId } from "@ui/lib/server-security";

type Params = { params: Promise<{ id: string }> };

/** One conversation's full history, used to reopen it from the sidebar where it left off. */
export async function GET(req: Request, { params }: Params) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  const id = readSessionId((await params).id);
  if (!id) return invalidSessionIdResponse();
  try {
    const found = await getConversation(id);
    if (!found) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
    return Response.json(found);
  } catch (err) {
    return internalError("Could not load that conversation", err);
  }
}

/** Renames a conversation. Body: `{ "title": string }`. */
export async function PATCH(req: Request, { params }: Params) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  const id = readSessionId((await params).id);
  if (!id) return invalidSessionIdResponse();
  let title: unknown;
  try {
    ({ title } = (await req.json()) as { title?: unknown });
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (typeof title !== "string") return Response.json({ error: "A title is required." }, { status: 400 });
  try {
    const conversation = await renameConversation(id, title);
    if (!conversation) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
    return Response.json({ conversation });
  } catch (err) {
    return internalError("Could not rename that conversation", err);
  }
}

/** Deletes a conversation's messages and its session manifest. */
export async function DELETE(req: Request, { params }: Params) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  const id = readSessionId((await params).id);
  if (!id) return invalidSessionIdResponse();
  try {
    const deleted = await deleteConversation(id);
    if (!deleted) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (err) {
    return internalError("Could not delete that conversation", err);
  }
}
