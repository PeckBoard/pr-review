// Hook + tool dispatch. Parses the `{ hook, payload }` envelope and routes each
// call to its handler. The wasm export functions live in `index.ts`.

import { skip, allow, cancel, errMsg } from "./verdict";
import { serveHttp, serveAuthed } from "./http";
import {
  onAgentEnded,
  toolCancel,
  toolDelete,
  toolGet,
  toolGetPrompt,
  toolList,
  toolListFolders,
  toolRerun,
  toolSetPrompt,
  toolStart,
  toolStep,
  toolSubmit,
} from "./review";
import { onPublishEnded, toolPublish, toolPublishResult, toolTriage } from "./publish";

/// The agent-facing tools, keyed by the name declared in the manifest. Each
/// takes the caller `context` as its second argument — core builds it from the
/// verified ToolCallContext, so the review-session guard cannot be forged.
export const TOOLS: Record<string, (args: any, context: any) => any> = {
  // Review sessions report back.
  pr_review_step: toolStep,
  pr_review_submit: toolSubmit,
  // Any other session starts and manages reviews.
  pr_review_start: toolStart,
  pr_review_list: toolList,
  pr_review_get: toolGet,
  pr_review_rerun: toolRerun,
  pr_review_cancel: toolCancel,
  pr_review_delete: toolDelete,
  pr_review_list_folders: toolListFolders,
  pr_review_get_prompt: toolGetPrompt,
  pr_review_set_prompt: toolSetPrompt,
  // Triage and publish — the decision is always the caller's.
  pr_review_triage: toolTriage,
  pr_review_publish: toolPublish,
  // Publish sessions report back.
  pr_review_publish_result: toolPublishResult,
};

export function dispatch(hook: string, payload: any): string {
  switch (hook) {
    case "mcp.tool.invoke":
      return handleInvoke(payload);
    case "http.request.before":
      return serveHttp(payload);
    case "http.request.authed":
      return serveAuthed(payload);
    case "session.agent.ended":
      // A notification: the verdict is ignored host-side, so an error is
      // reported in the payload rather than as a cancel.
      try {
        // A publish session has its own watchdog; anything else is a review.
        return allow(onPublishEnded(payload) ?? onAgentEnded(payload));
      } catch (e) {
        return allow({ ok: false, error: errMsg(e) });
      }
    default:
      return skip();
  }
}

function handleInvoke(payload: any): string {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return cancel("malformed invoke payload: not an object");
  }
  const tool: string = typeof payload.tool === "string" ? payload.tool : "";
  const args = payload.arguments ?? {};
  const context = payload.context ?? {};

  const fn = TOOLS[tool];
  if (!fn) {
    return cancel(`pr-review does not provide tool '${tool}'`);
  }
  try {
    return allow(fn(args, context));
  } catch (e) {
    // A handler error is a normal tool result (the agent sees the message and
    // can correct itself), not a plugin cancel.
    return allow({ error: errMsg(e) });
  }
}
