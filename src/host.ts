// FFI layer: the Peckboard core host functions this plugin calls, and the
// host_call marshaling helper. Host calls are kept LAZY (inside functions) so
// the pure modules load under vitest without an Extism runtime.
//
// KEEP IN SYNC with src/index.d.ts — an undeclared host call traps at runtime.

type HostFn = (offset: bigint) => bigint;

/// Call a host function and parse its JSON response, surfacing an
/// `{"error": ...}` envelope (or a trap) as a thrown Error.
export function hostCall(name: string, input: unknown): any {
  const f = (Host.getFunctions() as Record<string, HostFn>)[name];
  const mem = Memory.fromString(JSON.stringify(input));
  const out = f(mem.offset);
  const parsed = JSON.parse(Memory.find(out).readString());
  if (parsed && parsed.error !== undefined && parsed.error !== null) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

// ── Plugin document store (data_store permission) ────────────────────────────

export function storePut(collection: string, key: string, data: unknown): void {
  hostCall("peckboard_store_put", { collection, key, data });
}

export function storeGet(collection: string, key: string): any {
  const result = hostCall("peckboard_store_get", { collection, key });
  return result?.value ?? null;
}

export function storeList(collection: string): { key: string; value: any }[] {
  const result = hostCall("peckboard_store_list", { collection });
  return Array.isArray(result?.items) ? result.items : [];
}

export function storeDelete(collection: string, key: string): void {
  hostCall("peckboard_store_delete", { collection, key });
}

// ── Folders (ungated) ───────────────────────────────────────────────────────

export interface Folder {
  id: string;
  name: string;
  path: string;
}

export function listFolders(): Folder[] {
  const result = hostCall("peckboard_list_folders", {});
  return Array.isArray(result?.folders) ? result.folders : [];
}

// ── Models (models_read permission) ─────────────────────────────────────────

export interface ModelChoice {
  id: string;
  display_name: string;
  provider: string;
  account_id: string | null;
  thinking: boolean;
  tier: number;
}

export function listModels(): ModelChoice[] {
  const result = hostCall("peckboard_list_models", {});
  return Array.isArray(result?.models) ? result.models : [];
}

// ── Sessions (session_write / session_dispatch / session_read) ──────────────

export interface CreateSessionInput {
  name: string;
  model: string;
  is_temp: boolean;
  system_prompt?: string;
  /// Land the session in the folder at this path. Core honors it only under
  /// user authority (an authenticated page request) — exactly where reviews
  /// are started from.
  folder_path?: string;
  folder_name?: string;
}

/// Create a session. Returns the created session's id.
export function createSession(input: CreateSessionInput): string {
  const result = hostCall("peckboard_create_session", input);
  const id = result?.session?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("session creation returned no session id");
  }
  return id;
}

/// Kick off a run on a session (needs a trusted caller: the page request).
export function dispatchCapture(sessionId: string, prompt: string): void {
  hostCall("peckboard_dispatch_capture", { session_id: sessionId, prompt });
}

/// Whether a session row still exists — via the brief listing.
export function sessionExists(sessionId: string): boolean {
  const result = hostCall("peckboard_list_sessions_brief", {});
  const sessions: any[] = result?.sessions ?? [];
  return sessions.some((s) => s && s.session_id === sessionId);
}

// ── Unattended control (session_orchestrate permission) ─────────────────────
// Context-free on purpose: the watchdog runs inside `session.agent.ended`,
// where the caller-checked twins (dispatch_capture, terminate_agent) refuse,
// and cancel from the global page has no folder scope for terminate_agent's
// same-folder rule.

/// Deliver a user message to a session (starts a run).
export function orchestrateSend(sessionId: string, text: string): void {
  hostCall("peckboard_orchestrate_send", { session_id: sessionId, text });
}

/// Stop a session's agent process; the transcript stays.
export function orchestrateTerminate(sessionId: string): void {
  hostCall("peckboard_orchestrate_terminate", { session_id: sessionId });
}

/// Create a session in an explicit folder. Used by `pr_review_start`: a tool
/// call's create_session is pinned to the caller's folder, but a review may
/// target any folder. Returns the new session's id.
export function orchestrateCreateSession(input: {
  folder_id: string;
  name: string;
  model: string;
  system_prompt: string;
}): string {
  const result = hostCall("peckboard_orchestrate_create_session", input);
  const id = result?.session?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("session creation returned no session id");
  }
  return id;
}