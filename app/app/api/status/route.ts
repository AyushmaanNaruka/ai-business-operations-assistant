import { describeModels } from "@/mastra/models";
import { enforceRateLimit, internalError } from "@ui/lib/server-security";

// Which models this deployment will answer with, for the sidebar footer. Model ids
// only (src/mastra/models.ts describeModels); API keys never leave the server.
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  try {
    return Response.json({ models: describeModels() });
  } catch (err) {
    return internalError("Could not read the model configuration", err);
  }
}
