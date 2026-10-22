---
name: ship-feature
description: Take one change from request to merged — branch, build, push, open the PR straight away, hand the user the Netlify preview link, run the pre-merge doc gate, then hand over preview/live/merge links. Use whenever the user asks for a change to the app: a new feature, a fix, a tweak to how something looks or behaves.
---

# Ship one change

Adapted from the template workflow at
https://github.com/mehdidotesk73/claude-nocode-netlify-webapp-workflow (`ship-feature`), fitted to
this repo: **production is GitHub Pages**, **Netlify only builds previews**, and CI runs format +
tests + build.

The user can't run the app locally. **The Netlify Deploy Preview is the only way they see a change**,
and Netlify only builds one once a PR exists. They also merge every change themselves. Both facts
shape every step below.

Fixed values for this repo:

- **Repo:** `mehdidotesk73/bitcoin-explorer`
- **Preview:** `https://deploy-preview-<PR number>--bitcoin-1460.netlify.app`
- **Production (live):** `https://mehdidotesk73.github.io/bitcoin-explorer/`
- **PR page:** `https://github.com/mehdidotesk73/bitcoin-explorer/pull/<PR number>`

## 1. Branch

Never work on `main` — it's protected, and pushes to it are rejected.

```
git checkout main && git pull --ff-only origin main
git checkout -b claude/<short-feature-name>
```

Name it for what it does: `claude/unit-wheel-picker`, `claude/run-scale-slider`. Not
auto-generated names like `claude/inspiring-bardeen-lHExI`.

**Verify the base** — confirm `git log --oneline origin/main..HEAD` is empty and the expected files
are present. A stale or pre-existing branch can fork from an old commit.

## 2. Edit in small commits, checked like CI checks them

Keep changes focused. **Before every commit run the same three checks CI runs**
(`.github/workflows/ci.yml`, job `build`):

```
npm run format:check   # Prettier — `npm run format` fixes it
npm run test:run       # Vitest
npm run build          # vue-tsc + vite build (catches TS and Vue template errors)
```

A red check on the user's PR is noise they have to interpret, so catch it first. If `node_modules`
is missing (fresh container), `npm ci` first.

## 3. Consider unit tests — assess first, then ask

**Most changes don't need them, and asking anyway is ceremony.** A colour, a layout fix, a component
swap: say nothing and move on. Raise it when the change adds **logic later features will sit on** —
pure functions in `src/lib/` (indicators, run detection, forecast fits, period maths). Tests go in
`src/lib/*.test.ts` beside the code; the runner and the CI step already exist.

When it applies, group the candidate tests into **two to four bundles** described by the behaviour
they protect ("if this broke, the Bollinger bands would silently use the wrong window"), mark the
ones you actually recommend with **(Recommended)**, and gate on `AskUserQuestion` with
`multiSelect: true`. Selecting none is a legitimate answer. Write exactly what they pick, in the
same commit range as the feature.

## 4. Push, then open the PR immediately

`git push -u origin claude/<feature>` — retry with backoff on network errors.

**On the first push of a branch, open the PR right away** (into `main`, via the GitHub MCP tools —
there is no `gh` CLI). Don't wait for the feature to be finished or for the doc gate: the PR is what
makes Netlify build the preview, and the preview is how the user tests. Write a what / why /
testing body and say the doc gate hasn't run yet. Later pushes to the same branch update the same PR
and the same preview URL.

Keep PR comments frugal. **Do not merge** — the user merges.

## 5. Hand over the preview link — after every push

Every turn that pushes ends with the preview link in a normal message (never inside an
`AskUserQuestion` question — that field renders plain text, so links arrive dead):

> **Preview:** https://deploy-preview-64--bitcoin-1460.netlify.app
> — open on your phone and try <the specific thing to check>.

Tell them **what to check**, concretely — what to tap and what should happen.

**Take the URL from the `netlify[bot]` comment on the PR** (`pull_request_read` → `get_comments`),
which also names the commit it built — don't hand-construct it from memory; the site name has been
wrong in these docs before.

**Wait for it in-turn when you can.** The Netlify deploy takes a minute or two; poll the PR's check
runs (`pull_request_read` → `get_check_runs`) a few times until the Netlify deploy check resolves,
then report. Don't end on "I'll check back later" and don't schedule a check-in for a two-minute
deploy. The footer shows the live `build <sha>` — tell them which short sha to expect so they can
confirm they're on the new bundle.

**Service-worker caveat:** this is a PWA, so an old bundle can keep serving. If a change "doesn't
show", it's almost always the cache — have them tap **Reload latest** in the footer, or open the URL
in a private/incognito tab.

The price API isn't reachable from the sandbox, so data-dependent behaviour can only be confirmed
on their device. Say what you could and couldn't verify, and ask for screenshots or a **Copy log**
paste when that would settle it.

## 6. Doc gate — before declaring merge-ready

When the branch is **ready to merge**, pose an `AskUserQuestion` with `multiSelect: true` listing the
four doc surfaces, asking which to update now:

- **`docs/TODO.md`** — move finished items to Done (one-paragraph summary + key function names);
  queue follow-ups
- **`docs/experience.md`** — a version-history entry (added / removed / defaults / docs). On branch
  abandonment, a "what didn't work" entry with the reason, honestly — including "direction felt
  unideal".
- **`docs/system-design.md`** — if the branch changed architecture, a `lib` module, a feature's
  design, or a convention: update that section _and_ the system map
- **`docs/concepts/*.md`** — if a page's UI or behaviour changed, update that page's help doc (it
  renders in the Help modal)

### Say which ones you think need it, and why

**Work out the answer before you ask.** Read your own diff (`git diff main...HEAD --stat` plus the
changes) and decide per surface. Put recommended ones **first** with **(Recommended)** appended, and
make each `description` name **the specific thing in this branch** that triggers it ("the MA and
Bollinger period unit is now a wheel, so the Price Explorer help page describes a dropdown that's
gone"). For the ones you're not recommending, say so plainly ("no architecture change — no update
needed"). **Don't recommend all four out of caution** — `TODO.md` and `experience.md` apply to
nearly every merge; `system-design.md` and `concepts/*.md` often don't.

Their selection wins. Selecting none means "keep working on the branch / skip docs". Update exactly
what's selected, run the checks, push (then the preview link again, per step 5). **Never declare a
branch merge-ready without running this gate.**

## 7. Hand over all three links

They can't merge what they can't find. Always include the live site next to the preview — seeing
both makes it concrete that production is untouched until they merge:

> **Preview (the change):** https://deploy-preview-64--bitcoin-1460.netlify.app
> — check <the thing>.
>
> **Live site (unchanged):** https://mehdidotesk73.github.io/bitcoin-explorer/
> — still the old version until you merge.
>
> **Ready to merge:** https://github.com/mehdidotesk73/bitcoin-explorer/pull/64
> — click the green **Merge pull request** button, then **Confirm merge**. Tell me once it's merged
> and I'll verify the live site.

Preview first — they should look before merging. Never say "merge when ready" without the URLs, and
never put the links inside an `AskUserQuestion` question.

## 8. After the merge

Merging to `main` runs `.github/workflows/deploy.yml`, the GitHub Pages production deploy. Watch that
run in-turn (`actions_list` / `actions_get`) and confirm it succeeded, then tell them the live URL
now has the change (and the **Reload latest** caveat if they had it open).

If they report the merge button greyed out, read the reason off the PR page before changing any
settings — usually a merge conflict or a failing `build` check.

## Reverts

`main` is protected and force-push is rejected. To undo something on `main`, add a revert commit via
a normal PR (revert the merge commit with `-m 1`). To re-introduce a reverted feature, "revert the
revert" on a fresh branch — a plain re-merge won't work, since Git sees it as already merged.

Abandoning a branch → record it in `docs/experience.md` ("What didn't work").
