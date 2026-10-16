// Hook + tool dispatch. Parses the `{ hook, payload }` envelope and routes each
// call to its handler. The wasm export functions live in `index.ts`.

import { skip, allow, cancel, errMsg } from "./verdict";
import { serveHttp, serveAuthed } from "./http";
import { onAgentEnded, toolStep, toolSubmit } from "./review";

/// The agent-facing tools, keyed by the name declared in the manifest. Each
/// takes the caller `context` as its second argument — core builds it from the
/// verified ToolCallContext, so the review-session guard cannot be forged.
const TOOLS: Record<string, (args: any, context: any) => any> = {
  pr_review_step: toolStep,
  pr_review_submit: toolSubmit,
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
        return allow(onAgentEnded(payload));
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
