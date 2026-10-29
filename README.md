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
   none seeing another's findings (a small change gets a single claude
   reviewer instead);
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
- `POST rerun {id, mode?}` → `{review}`: a **new** review with a fresh session and
  the same inputs. The old review keeps its result. `mode` is `latest`
  (default: fetch and review only the commits since the last successful review
  — see [Re-runs](#re-runs-and-reviewer-count)), `full` (fetch and review the
  whole branch again) or `current` (review the exact commit the old review
  recorded in `commit`; fails if it has none).
  the exact commit the old review recorded in `commit`; fails if it has none).
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
- `pr_review_rerun({id, mode?, notify?})` — `mode` as in `POST rerun`;
  `pr_review_cancel({id})`, `pr_review_delete({id})`.
- `pr_review_list_folders()` — target folders, `current` marking the caller's.
- `pr_review_get_prompt()` / `pr_review_set_prompt({global_prompt})` — the
  global prompt; an empty string restores the default.

A review session itself is refused all of these, so reviews never recurse.

### Reporting Back (Review Sessions Only)

- `pr_review_step({step, note?, provider?, provider_status?, abort_reason?})`
- `pr_review_step({step, note?, provider?, provider_status?, commit?, abort_reason?})`
  updates the step, the progress log and per-provider status. `commit` records
  the full SHA the worktree was created at (what a same-commit re-run reviews;
  a pinned review rejects any other SHA). `abort_reason` marks the review
  failed, for reviews that cannot run at all (for example, the branch does not
  exist).
- `pr_review_submit({result})` validates the result strictly. When it fails,
  it returns every problem with its JSON path, so the agent can fix them and
  resubmit. When it is valid, the review becomes `done` and the counts are
  computed. Providers still `pending` at submit never ran (a small change, or
  an incremental re-run with nothing new) and are dropped from `providers`.

Both tools resolve the review from the **calling session's id** (the
`session_index` collection), so only a review's own session can drive it.

## Re-runs and Reviewer Count

- **Incremental re-runs.** A `latest` re-run builds on the newest `done`
  review of the same folder, branch and base that recorded its commit
  (`baseline: {review_id, commit}` on the new review). The session reviews
  only `git diff <baseline>..HEAD`; reviewers get the earlier findings so they
  do not report them again. Earlier findings in files the new commits did not
  touch are kept verbatim; ones in touched files are re-checked (fixed → moved
  to `dropped`). No new commits → the earlier result is re-submitted with no
  reviewers spawned. Rewritten history (baseline not an ancestor of HEAD) →
  a full review. Triage carries over to findings with the same kind, file and
  title. `full` skips all of this.
- **Small changes.** A reviewed diff of at most 200 changed lines across at
  most 10 files (`SMALL_DIFF_*` in `src/prompt.ts`) gets one reviewer — claude
  on `claude-opus-5-5` — instead of the claude/codex/grok fan-out. Both rules
  live in the fixed contract, so they hold under a custom global prompt.
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

## Triage and Publish

After a review is `done` the user triages and posts it; the decision is
always theirs, never derived from the findings or the model's `verdict`.

- `POST triage {id, index, ignored?, comment?}` / `pr_review_triage` — store
  `triage[index] = {ignored, comment}`; `comment: null` restores the wording.
- `GET publish-preview?id=` — `{body, comments, body_items, ignored}`: the
  default body (summary / why / ticket) and every comment that will be posted,
  each prefixed with a Conventional Comments label from its severity.
- `POST publish {id, decision, body}` / `pr_review_publish` — `decision` is
  required (`approve | request_changes | comment`). Creates a publish session
  in the review's folder (`session_index` entry with `kind: "publish"`) whose
  kickoff carries the exact GitHub review payload. It posts one review via
  `gh api …/pulls/<n>/reviews`, moves out-of-diff comments into the body, never
  changes the event, and reports with `pr_review_publish_result`. The
  watchdog nudges a silent publish run once, then marks it failed; a failed or
  posted publish can be started again.
