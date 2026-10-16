// HTTP surfaces: the served PR Reviews page (`http.request.before`) and the
// authenticated app-UI endpoints (`http.request.authed`) it drives. The page
// is sandboxed with no same-origin access — it goes through the standard
// parent-proxied fetch bridge — so these routes are the whole contract
// between the two halves of the plugin. The page is GLOBAL (a sidebar
// entry): every folder-specific action names its folder explicitly.

import { htmlResponse, jsonResponse, errMsg } from "./verdict";
import { PAGE } from "./page";
import {
  cancelReview,
  deleteReview,
  getReview,
  pageState,
  rerunReview,
  saveSettings,
  startReview,
} from "./review";
import { previewFor, startPublish, triageFinding } from "./publish";

export const PAGE_PATH = "/plugin-api/v1/pr-review";
export const API = "/api/plugin-ui/pr-review";

function up(v: unknown): string {
  return (typeof v === "string" ? v : "").toUpperCase();
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function parseBody(body: string): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error("invalid request body: " + errMsg(e));
  }
}

/// Extract and URL-decode `name`'s value from a `&`-separated query string.
export function queryParam(query: string, name: string): string | undefined {
  for (const pair of query.replace(/^\?/, "").split("&")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    if (pair.slice(0, idx) !== name) continue;
    const v = pair.slice(idx + 1);
    try {
      return decodeURIComponent(v.replace(/\+/g, "%20"));
    } catch (_e) {
      return v;
    }
  }
  return undefined;
}

/// Serve the page shell.
export function serveHttp(payload: any): string {
  if (up(payload?.method) === "GET" && str(payload?.path) === PAGE_PATH) {
    return htmlResponse(200, PAGE);
  }
  return htmlResponse(404, "<!doctype html><title>Not found</title><p>Not found.</p>");
}

type Handler = (body: any, query: string) => unknown;

const ROUTES: Record<string, Handler> = {
  [`GET ${API}/state`]: () => pageState(),
  [`GET ${API}/review`]: (_b, q) => getReview(queryParam(q, "id")),
  [`POST ${API}/start`]: (b) => startReview(b),
  [`POST ${API}/rerun`]: (b) => rerunReview(b),
  [`POST ${API}/cancel`]: (b) => cancelReview(b),
  [`POST ${API}/delete`]: (b) => deleteReview(b),
  [`POST ${API}/settings`]: (b) => saveSettings(b),
  [`POST ${API}/triage`]: (b) => triageFinding(b),
  [`GET ${API}/publish-preview`]: (_b, q) => previewFor(queryParam(q, "id")),
  [`POST ${API}/publish`]: (b) => startPublish(b),
};

/// The ui_routes declared in the manifest — derived from ROUTES so the two
/// cannot drift.
export const UI_ROUTES = Object.keys(ROUTES);

/// Authenticated app-UI endpoints under /api/plugin-ui/pr-review/*.
export function serveAuthed(payload: any): string {
  const key = `${up(payload?.method)} ${str(payload?.path)}`;
  const handler = ROUTES[key];
  if (!handler) return jsonResponse(404, { error: "not found" });
  try {
    const body = up(payload?.method) === "POST" ? parseBody(str(payload?.body)) : {};
    return jsonResponse(200, handler(body, str(payload?.query)));
  } catch (e) {
    return jsonResponse(400, { error: errMsg(e) });
  }
}
