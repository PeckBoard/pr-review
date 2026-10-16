# PR Review

A Peckboard plugin that reviews a git branch the way a careful senior engineer
reviews a pull request. You pick a folder and a branch on the global **PR
Reviews** page. The plugin then starts a dedicated agent session named
`PR review: <branch>`, a normal session you can open and follow. That session:

1. creates a **detached git worktree** for the branch, so your checkout and
   uncommitted work are never touched;
2. gathers the context once: merge base, diff, commits, the PR title/body via
   `gh` when it is available, and the ticket id;
3. runs three **independent reviewer subagents in parallel**, one each on the
   top claude, codex and grok model, all with the same reviewer prompt and
   none seeing another's findings;
4. merges their findings, **re-verifies** every blocker/major and every
   single-reviewer finding in the code, and drops the ones it refutes (with a
   reason);
5. submits one structured result: summary, why, ticket, verdict, and ranked
   findings with file/line, a suggested fix, which reviewers raised each, and a
   confidence score.

## Build

```bash
./build.sh        # npm install (first run) + esbuild + extism-js → dist/plugin.wasm
npm test          # bundle + vitest
```

Needs `extism-js` on `PATH`. `esbuild.js` bundles `page/main.js` into
`src/generated/pageBundle.ts` (not committed) and then the plugin into
`dist/index.js`.

## Layout

| File                 | Role                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `src/manifest.ts`    | Identity, hooks, permissions, sidebar entry, routes, tool schemas |
| `src/http.ts`        | Page shell + the authed `/api/plugin-ui/pr-review/*` routes      |
| `src/review.ts`      | State machine: start/rerun/cancel/delete, tools, watchdog        |
| `src/validate.ts`    | Strict result validation, sorting, counts                        |
| `src/prompt.ts`      | Reviewer prompt, orchestration, fixed contract, kickoff/nudge    |
| `src/host.ts`        | Host-function FFI (keep in sync with `src/index.d.ts`)           |
| `page/`              | The page UI (bundled into the wasm)                              |

## Routes

All JSON, under `/api/plugin-ui/pr-review/`. Errors return `400 {error}`.

- `GET state` → `{reviews, folders, models, settings}`; reviews newest first,
  without `log`/`result`.
- `GET review?id=<id>` → `{review}`.
- `POST start {branch, base?, folder_id, model?, prompt?}` → `{review}`.
  The branch and base must be plain ref names. With no model, the plugin picks
  the most capable claude model (opus preferred).
- `POST rerun {id}` → `{review}`: a **new** review with a fresh session and
  the same inputs. The old review keeps its result.
- `POST cancel {id}` / `POST delete {id}` → `{ok: true}`. Delete leaves the
  session (your transcript) in place.
- `POST settings {global_prompt}` → `{settings}`. An empty string resets to
  the default.

## Agent Tools

### Starting and Managing Reviews (Any Session)

Everything the page does is also an MCP tool, so a session can run reviews:

- `pr_review_start({branch, base?, folder_id? | folder?, model?, prompt?, notify?})`
  starts a review and returns at once with its id and page link. The folder
  defaults to the calling session's own; `folder` takes a name or path. The
  review session is created in that folder (`orchestrate_create_session`, since
  a tool call's `create_session` is pinned to the caller's folder). With
  `notify` (default true) the calling session gets a message when the review
  finishes: verdict, counts, summary and the top recommended changes, or the
  failure reason.
- `pr_review_list({status?, folder_id?, limit?})`, `pr_review_get({id})` —
  progress, and the full result once done.
- `pr_review_rerun({id, notify?})`, `pr_review_cancel({id})`,
  `pr_review_delete({id})`.
- `pr_review_list_folders()` — target folders, `current` marking the caller's.
- `pr_review_get_prompt()` / `pr_review_set_prompt({global_prompt})` — the
  global prompt; an empty string restores the default.

A review session itself is refused all of these, so reviews never recurse.

### Reporting Back (Review Sessions Only)

- `pr_review_step({step, note?, provider?, provider_status?, abort_reason?})`
  updates the step, the progress log and per-provider status. `abort_reason`
  marks the review failed, for reviews that cannot run at all (for example, the
  branch does not exist).
- `pr_review_submit({result})` validates strictly. When the result is invalid
  it returns every problem with its JSON path, so the agent can fix them and
  resubmit. When it is valid, the review becomes `done` and the counts are
  computed.

Both tools resolve the review from the **calling session's id** (the
`session_index` collection), so only a review's own session can drive it.
## Watchdog

`session.agent.ended` fires when a review session's run ends. If no result
was submitted, the plugin sends a nudge to continue. After 2 consecutive runs
that end with no progress, the review fails with an explicit error. Any
`pr_review_step` call resets the counter. A run that ends while a reviewer is
`running` is the normal wait for subagent results, so it is not nudged. A
running review whose session was deleted is marked failed on the next `state`
poll.

## Prompts

The session's system prompt has three layers:

1. the **global prompt**: the default reviewer prompt plus orchestration,
   or your override from the settings tab;
2. the review's optional **custom instructions**;
3. a fixed **contract** you cannot edit: the review's inputs, the worktree
   rule, and how to use the tools.

The worktree is created **inside** the repository, at `pr-review-worktrees/<id>`,
and excluded through `.git/info/exclude`. Reviewer subagents are confined to the
project folder and could not read a `mktemp -d` path. The worktree is removed
when the review ends.

## Permissions

`provide_mcp_tools`, `data_store`, `models_read`, `session_write`,
`session_read`, `session_dispatch`, `session_orchestrate`, `user_authority`,
`contribute_sidebar`.

`session_orchestrate` is needed for two actions that run with no caller
context: the watchdog's nudge inside `session.agent.ended`, and cancel from the
global page. The context-checked `dispatch_capture` / `terminate_agent` refuse
both.

## Sources

The reviewer prompt draws on:

- Anthropic's [claude-code code-review plugin](https://github.com/anthropics/claude-code)
- [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review)
- [Qodo pr-agent](https://github.com/qodo-ai/pr-agent) reviewer prompts
- [Google engineering practices: code review](https://google.github.io/eng-practices/review/)
- [Conventional Comments](https://conventionalcomments.org/)
