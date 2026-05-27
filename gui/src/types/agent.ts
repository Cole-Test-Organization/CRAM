export type AgentEvent =
    | { type: "user_prompt"; text: string; notes?: string }
    | { type: "session"; sessionId: string }
    | { type: "thinking"; text: string }
    | { type: "assistant_text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: any }
    | {
          type: "tool_result";
          toolUseId: string;
          content: string;
          isError?: boolean;
      }
    | {
          type: "done";
          result?: string;
          durationMs?: number;
          stopReason?: string;
      }
    | {
          type: "usage";
          promptTokens: number | null;
          completionTokens: number | null;
          totalTokens: number | null;
          contextMax: number | null;
      }
    | { type: "error"; message: string };

export type UsageSnapshot = {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    contextMax: number | null;
};

export type SessionSummary = {
    id: string;
    title: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
    match?: { before: string; match: string; after: string };
};

export type SessionsResponse = { total: number; sessions: SessionSummary[] };

export type ReturnTo = { label: string; href: string };

// Restrict the MCP toolset the agent can call on this turn (and subsequent
// turns in the same session until "New Conversation" resets it). Omit for
// the default behavior of "all tools"; pass [] to force a text-only
// answer; pass a list of tool names to expose only those.
export type AgentLocationState = {
    pendingPrompt?: string;
    returnTo?: ReturnTo;
    allowedTools?: string[];
};
