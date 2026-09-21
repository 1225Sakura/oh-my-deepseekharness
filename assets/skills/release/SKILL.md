---
name: release
description: Repo-aware release assistant — derives release rules from repo/CI inspection, caches them in .omd/RELEASE_RULE.md, then guides version bump, notes, tag, and publish
when-to-use: The user (maintainer) asks to cut a release ("release", "bump version", "publish vX.Y.Z", "prepare a release"). Maintainer-only flow; never bypasses the repo's own release boundary (CI gates, protected branches, required reviews).
---

# Release

A thin, repo-aware release assistant. On first run it inspects the project and CI to derive release rules, caches them in `.omd/RELEASE_RULE.md`, then walks the maintainer through a release using those rules. It hardcodes nothing project-specific — everything is derived from inspection.

**Boundary:** release is maintainer-only. This skill *guides and executes locally* (version files, changelog, commit, tag); anything that reaches a shared remote (push, publish, deployment) happens only after explicit user confirmation.

## Usage

```
release [version] [--refresh]
```

- `version` is optional — `patch`, `minor`, `major`, or an explicit semver like `2.4.0`. If omitted, show current version and ask (prefer `ask_user_question` when available).
- `--refresh` forces re-analysis even when the cached rule file exists.

## Step 0 — Load or build release rules

Check whether `.omd/RELEASE_RULE.md` exists (use `glob`/`read`).

- **Missing or `--refresh`:** run the full analysis (Step 1) and write the file.
- **Present:** read it, then do a delta check — scan CI dirs (`.github/workflows/`, `.circleci/`, `Jenkinsfile`, `gitlab-ci.yml`, `bitbucket-pipelines.yml`, …) for modifications newer than the `last-analyzed` timestamp in the file. If relevant workflow files changed, re-analyze those sections and update the file. Report what changed.

## Step 1 — Repo analysis (first run or --refresh)

Answer the following from inspection and record the answers:

1. **Version sources** — every file containing the current version string (`package.json`, `pyproject.toml`, `Cargo.toml`, `build.gradle`, `VERSION`, …); for each, the field/regex used. Detect release automation scripts (`scripts/release.*`, Makefile target, `changesets`, `semantic-release`, `release-it`, `goreleaser`, …).
2. **Registry / distribution** — npm / PyPI / Cargo / Docker / GitHub Packages / other; whether a CI job publishes automatically on tag push (which workflow, which job).
3. **Release trigger** — tag push (`v*`), `workflow_dispatch`, merge to main, release-branch merge, commit-message pattern.
4. **Test gate** — the test command and where it runs in CI; whether tests must pass before publish; any bypass flags.
5. **Release notes / changelog** — `CHANGELOG.md`/`.rst` presence; convention (Keep a Changelog / Conventional Commits / GitHub auto-generated / none); committed release-body file.
6. **First-time gaps** — no release workflow (offer to scaffold one); build artifacts not gitignored; no git tags yet (`git tag --list`).

## Step 2 — Write `.omd/RELEASE_RULE.md`

```markdown
# Release Rules
<!-- last-analyzed: YYYY-MM-DDTHH:MM:SSZ -->

## Version Sources
## Release Trigger
## Test Gate
## Registry / Distribution
## Release Notes Strategy
## CI Workflow Files
## First-Time Setup Gaps
```

`.omd/RELEASE_RULE.md` is a local cache. Commit it if the team wants shared rules, or leave it under the `.omd/` gitignore umbrella.

## Step 3 — Determine version

Use the argument if given. Otherwise: show the current version, show what `patch`/`minor`/`major` produce, ask the user. Validate the result is a valid semver string.

## Step 4 — Pre-release checklist

Present and walk through (derived from the rules; at minimum):

- [ ] All changes intended for this release are committed and pushed
- [ ] CI is green on the target branch
- [ ] Tests pass locally (run the test-gate command — collect real output as evidence)
- [ ] Version bump applied to **all** version source files
- [ ] Release notes / changelog prepared (Step 5)

## Step 5 — Release notes

Apply the repo's detected convention. Default guidance when none:

- Lead with **what changed for users**, not internals.
- Group by type: `New Features` / `Bug Fixes` / `Breaking Changes` / `Deprecations` / `Internal`.
- One sentence per item; link PR/issue; credit external authors.
- **Breaking changes first**, each with a migration path.
- Omit invisible changes (refactors, CI tweaks) unless they affect build reproducibility.

With Conventional Commits, draft from `git log <prev-tag>..HEAD --no-merges --format="%s"` grouped by type; show the draft and let the user edit.

## Step 6 — Execute

1. **Bump** every version source file (`edit` tool).
2. **Run tests** — the test-gate command; paste real output.
3. **Commit** — `git add <version files> CHANGELOG.md`, message `chore(release): bump version to vX.Y.Z` (dsh `git_commit` is fine).
4. **Tag** — `git tag -a vX.Y.Z -m "vX.Y.Z"` (annotated preferred).
5. **Push** — `git push origin <branch> && git push origin vX.Y.Z`. **Ask for explicit confirmation first** — this is the point of no return for CI-triggered releases.
6. **CI takes over** — if the trigger is a tag push, name the expected workflow file and what it will do (publish, create GitHub release).
7. **Manual publish** — if no CI automation, list the exact manual command (`npm publish --access public`, `twine upload dist/*`, …) and let the user run or confirm it.

## Step 7 — First-time setup suggestions

If Step 1 found gaps, offer concrete help: scaffold a `v*`-tag-triggered release workflow, create the first tag, gitignore build artifacts. Each is a separate, confirmable change.

## Step 8 — Verify after push

- CI status: `gh run list --workflow=<release workflow> --limit=3` (if `gh` exists).
- Registry shows the new version after a few minutes.
- GitHub Release exists: `gh release view vX.Y.Z`.

Report success with evidence, or flag failures precisely.

## State Contract (状态契约)

release **holds no omd mode state**: no `state_write`/`state_clear`. Its only persistent artifact is the `.omd/RELEASE_RULE.md` cache (plus the release commit/tag it creates on user confirmation). Pushes, publishes, and any deployment always require explicit user confirmation before execution.
