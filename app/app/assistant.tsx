"use client";

import { useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@ui/components/assistant-ui/elements/thread.aui";
import { SourcesPanel } from "@ui/components/sources-panel";

export const Assistant = () => {
  // One id for the life of this browser tab: the chat route (app/api/chat) and
  // the sources panel's upload/manifest routes all key off the SAME id, so an
  // uploaded file and the conversation asking about it land in one session
  // manifest (src/mastra/runtime.ts resolveSessionId). Generated once, not
  // derived from useChatRuntime, so the sources panel knows it immediately
  // instead of waiting on the first sent message.
  const [threadId] = useState(() => crypto.randomUUID());

  const runtime = useChatRuntime({
    id: threadId,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh">
        <SourcesPanel threadId={threadId} />
        <div className="min-w-0 flex-1">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};
