# Contributing to Yakodonyo Studio

Thanks for helping improve the project. This repo uses a protected `main`
branch, short-lived feature branches, pull requests, and CI checks.

> Maintainer note: branch protection is **not enabled yet** (checked 2026-11-26:
> `protectedByBranchProtections: false`). Follow [Repository settings](#repository-settings-maintainer)
> below to turn it on. Until then, please still use PRs for all changes.

## Local setup

```powershell
# Backend
cd backend
python -m venv .venv
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend
npm ci
npm run dev
```

Optional: keep both dev servers alive automatically with the watchdog:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\dev-watch.ps1" -Force
```

Never commit secrets. Copy `backend/.env.example` to `backend/.env` and
`frontend/.env.local.example` to `frontend/.env.local`; both targets are ignored.

## Branching model

| Branch | Purpose | Notes |
|---|---|---|
| `main` | Default, deployable branch | Protected; only changed via merged PRs. |
| `feature/<short-name>` | New user-facing features | e.g. `feature/profile-page`. |
| `fix/<short-name>` | Bug fixes | e.g. `fix/ci-import-path`. |
| `chore/<short-name>` | Tooling, dependencies, CI | e.g. `chore/release-workflow`. |
| `docs/<short-name>` | Documentation only | e.g. `docs/contributing-guide`. |
| `release/vX.Y.Z` | Release preparation (optional) | Tag `vX.Y.Z` on `main` when done. |

Keep branches short-lived and focused on one issue. Start from an up-to-date
`main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/profile-page
```

## Commit messages (Conventional Commits)

Format: `type(scope): imperative summary` (lowercase, no trailing period,
under ~72 characters). Bodies and footers are optional but useful.

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `test` | Tests only |
| `refactor` | Code change with no behavior change |
| `perf` | Performance improvement |
| `chore` | Tooling, dependencies, CI, config |
| `build` | Build system or output |
| `ci` | CI workflow changes |

Examples from this repo:

```text
feat(auth): add profile page and account settings endpoints
fix(ci): make ML imports lazy so CI can collect tests
docs(readme): document account and profile behavior
chore(dev): add dev server watchdog with auto-restart
```

Breaking changes: add `!` after the type/scope (`feat(api)!: ...`) and a
`BREAKING CHANGE:` footer. Link issues in the footer (`Closes #123`).

## Pull requests

1. Create a branch as described above and make small, self-contained commits.
2. Run the same checks CI runs:
   ```powershell
   cd backend; python -m compileall app tests; python -m pytest -q
   cd ../frontend; npm run lint -- --no-cache; npm test; npm run build
   ```
3. Push the branch and open a PR against `main` using
   [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
4. Link the issue the PR closes, describe what changed and how you tested it.
5. Request a review. Required checks **must pass**: `backend` (compile +
   pytest) and `frontend` (lint + test + build). Dependency audits are
   report-only and do not block merging.
6. Squash-merge, then delete the branch. Keep `main` deployable at all times.

## Issues and project tracking

- Use the bug report or feature request templates in
  [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE) so reports are reproducible.
- Labels: `bug`, `enhancement`, `documentation`, `security`, `good first issue`.
- Use milestones for release-sized groups of work; the repo has GitHub Projects
  enabled for kanban tracking.
- Report security issues privately as described in [SECURITY.md](SECURITY.md),
  not in public issues.

## Releases and versioning

Use semantic versions `vMAJOR.MINOR.PATCH` (e.g. `v0.2.0`):

```powershell
git switch main
git pull --ff-only origin main
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which creates a
GitHub Release with auto-generated notes. Do not hand-edit release artifacts.

## Repository settings (maintainer)

These are one-time GitHub settings, not files in the repo. As of 2026-11-26 the
default branch is `main`, `has_issues` and `has_projects` are enabled, but
branch protection is **off**. To enable it:

1. Go to **Settings → Branches → Add branch ruleset** (or classic branch
   protection) for `main`.
2. Require a pull request before merging with at least 1 approval.
3. Require status checks to pass: `backend` and `frontend`.
4. Require branches to be up to date before merging.
5. Block force pushes and branch deletion; include administrators.
6. Optionally require signed commits and linear history.

After enabling, direct pushes to `main` will be rejected — use a PR instead.
