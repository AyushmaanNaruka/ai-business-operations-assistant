import type { MastraMemory } from '@mastra/core/memory';
import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { deriveConversationTitle, isPlaceholderTitle, messageText } from '@/modules/session';
import { mastra } from './index';
import { getRuntime } from './runtime';

/**
 * The chat sidebar's conversation list, read straight out of the orchestrator's
 * own Mastra Memory (docs/DECISIONS.md D-49). Every chat turn already persists
 * there, keyed by thread id, because app/app/api/chat/route.ts passes
 * `memory: { thread, resource }` on every call; this module only lists, loads,
 * renames and deletes those threads. There is no second copy of the history.
 *
 * The thread id doubles as the session id for the manifest and evidence ledger
 * (src/mastra/runtime.ts resolveSessionId), so reopening a conversation brings
 * back its uploaded sources and generated files too, not only its messages.
 */

/** AGENTS.md puts user accounts out of scope, so every conversation belongs to one resource. */
export const CHAT_RESOURCE_ID = 'demo-user';

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

async function getMemory(): Promise<MastraMemory> {
  const memory = await mastra.getAgent('orchestrator').getMemory();
  if (!memory) throw new Error('The orchestrator has no memory configured, so conversations cannot be listed.');
  return memory;
}

function toSummary(thread: { id: string; title?: string; createdAt: Date; updatedAt: Date }, title: string): ConversationSummary {
  return {
    id: thread.id,
    title,
    createdAt: new Date(thread.createdAt).toISOString(),
    updatedAt: new Date(thread.updatedAt).toISOString(),
  };
}

/** Newest first. A thread still carrying a placeholder title is named from its first user message. */
export async function listConversations(limit = 100): Promise<ConversationSummary[]> {
  const memory = await getMemory();
  const { threads } = await memory.listThreads({
    filter: { resourceId: CHAT_RESOURCE_ID },
    perPage: limit,
    orderBy: { field: 'updatedAt', direction: 'DESC' },
  });

  return Promise.all(
    threads.map(async (thread) => {
      if (!isPlaceholderTitle(thread.title)) return toSummary(thread, thread.title as string);
      // Threads created before titles were set on first message (or by Studio)
      // only have Mastra's "New Thread <date>" placeholder; derive one on read.
      const { messages } = await memory.recall({ threadId: thread.id, perPage: 10 });
      const firstUser = messages.find((m) => m.role === 'user');
      const text = firstUser ? messageText(toAISdkMessages([firstUser], { version: 'v7' })[0] ?? {}) : '';
      return toSummary(thread, deriveConversationTitle(text));
    }),
  );
}

/** The conversation's full history, as AI SDK v7 UI messages the chat runtime can be seeded with. */
export async function getConversation(threadId: string) {
  const memory = await getMemory();
  const thread = await memory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== CHAT_RESOURCE_ID) return null;
  const { messages } = await memory.recall({ threadId, perPage: false });
  const uiMessages = toAISdkMessages(messages, { version: 'v7' }).filter((m) => m.role === 'user' || m.role === 'assistant');
  const title = isPlaceholderTitle(thread.title)
    ? deriveConversationTitle(messageText(uiMessages.find((m) => m.role === 'user') ?? {}))
    : (thread.title as string);
  return { conversation: toSummary(thread, title), messages: uiMessages };
}

/**
 * Called by the chat route before each turn streams: creates the thread on a
 * conversation's first message, titled from that message, so the sidebar can
 * show it straight away. Existing threads are left alone unless they still carry
 * a placeholder title.
 */
export async function ensureConversation(threadId: string, latestUserText: string): Promise<void> {
  const memory = await getMemory();
  const existing = await memory.getThreadById({ threadId });
  if (!existing) {
    await memory.createThread({
      threadId,
      resourceId: CHAT_RESOURCE_ID,
      title: deriveConversationTitle(latestUserText),
    });
    return;
  }
  if (isPlaceholderTitle(existing.title) && latestUserText.trim().length > 0) {
    await memory.updateThread({ id: threadId, title: deriveConversationTitle(latestUserText), metadata: existing.metadata ?? {} });
  }
}

export async function renameConversation(threadId: string, title: string): Promise<ConversationSummary | null> {
  const memory = await getMemory();
  const existing = await memory.getThreadById({ threadId });
  if (!existing || existing.resourceId !== CHAT_RESOURCE_ID) return null;
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  const updated = await memory.updateThread({ id: threadId, title: clean || deriveConversationTitle(''), metadata: existing.metadata ?? {} });
  return toSummary(updated, updated.title ?? clean);
}

/** Deletes the thread's messages and its session manifest. Uploaded files on disk are left as they are. */
export async function deleteConversation(threadId: string): Promise<boolean> {
  const memory = await getMemory();
  const existing = await memory.getThreadById({ threadId });
  if (!existing || existing.resourceId !== CHAT_RESOURCE_ID) return false;
  await memory.deleteThread(threadId);
  const { manifestStore } = await getRuntime();
  await manifestStore.deleteManifest(threadId);
  return true;
}
