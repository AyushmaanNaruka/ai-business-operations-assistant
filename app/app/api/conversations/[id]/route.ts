import { deleteConversation, getConversation, renameConversation } from "@/mastra/conversations";

type Params = { params: Promise<{ id: string }> };

/** One conversation's full history, used to reopen it from the sidebar where it left off. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const found = await getConversation(id);
    if (!found) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
    return Response.json(found);
  } catch (err) {
    return Response.json({ error: `Could not load that conversation: ${(err as Error).message}` }, { status: 500 });
  }
}

/** Renames a conversation. Body: `{ "title": string }`. */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
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
    return Response.json({ error: `Could not rename that conversation: ${(err as Error).message}` }, { status: 500 });
  }
}

/** Deletes a conversation's messages and its session manifest. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const deleted = await deleteConversation(id);
    if (!deleted) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (err) {
    return Response.json({ error: `Could not delete that conversation: ${(err as Error).message}` }, { status: 500 });
  }
}
