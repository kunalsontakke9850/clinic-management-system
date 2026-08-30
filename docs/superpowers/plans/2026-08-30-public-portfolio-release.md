# Public Portfolio Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a truthful, privacy-safe Electron portfolio repository with verified testing, CI, Windows build artifacts, and recruiter-facing documentation.

**Architecture:** Preserve the Electron app and its local-storage-first workflow. Add an opt-in fictional demo seed isolated from production configuration; use GitHub Actions for test and Windows artifact verification; keep strict source and Docker allowlists.

**Tech Stack:** Electron, Node.js 20, JavaScript, node:test, JSDOM, Electron Builder, Docker, GitHub Actions, Google Apps Script, Google Sheets.

**Spec:** `docs/superpowers/specs/2026-08-30-public-portfolio-release-design.md`

## Global Constraints

- Never publish client, patient, credential, medical, payment-QR, production-endpoint, or installer data.
- Keep `config.local.js` ignored and outside the Electron package and Docker context.
- Demo data is fictional and activates only through `?demo=1`; it never sends data or reads private configuration.
- Keep Node.js 20 for CI/release workflows and Docker as a Node test environment only.

---

### Task 1: Synchronize CI and harden source boundaries

**Files:** `.github/workflows/ci.yml`, `.gitignore`, `.dockerignore`, `config.local.example.js`, `tests/github-readiness.test.js`, `tests/docker.test.js`

**Interfaces:** existing public `config.js`, ignored `config.local.js`, and `npm test`.

- [ ] Write failing readiness tests requiring `example.invalid` example endpoints, approved documentation paths only, and a default test command that covers `tests/*.test.js`.
- [ ] Run `node --test tests/github-readiness.test.js tests/docker.test.js` and confirm the contracts fail before source changes.
- [ ] Update the source/Docker allowlists and the example configuration; set the default command to `node --test tests/*.test.js`.
- [ ] Fast-forward the user’s `.github/workflows/ci.yml` commit and change only `actions/checkout@v5` and `actions/setup-node@v5`; retain Node 20, cache, `npm ci --ignore-scripts`, `npm test`, main push/pull/manual triggers, timeout, and `contents: read`.
- [ ] Run `npm test`, then commit the focused safety and CI changes.

### Task 2: Add opt-in fictional demo data

**Files:** create `demo-data.js`, `tests/demo-data.test.js`; modify `index.html`, `package.json`, `.gitignore`, `.dockerignore`, and `README.md`.

**Interfaces:** `window.ClinicDemo.seed()`, `window.ClinicDemo.reset()`, `window.ClinicDemo.isEnabled()`, local-storage key `clinic_reception_patients_v1`, and query parameter `demo=1`.

- [ ] Write `tests/demo-data.test.js` to load the module in JSDOM, require `?demo=1`, assert idempotent fictional data, and assert no `fetch` or `CONFIG` access.
- [ ] Run `node --test tests/demo-data.test.js` and confirm it fails because the module does not exist.
- [ ] Implement the small browser-only module; use only `Arjun Mehta`, age `32`, `9999999999`, `Dr. Demo User`, generic appointment/prescription/bill/expense records, and marker `clinic_demo_seed_v1`.
- [ ] Load it before application modules, run `npm test`, and commit the demo feature.

### Task 3: Create recruiter documentation and screenshot guidance

**Files:** create `docs/PORTFOLIO_NOTES.md`, `docs/SCREENSHOT_GUIDE.md`, `docs/screenshots/.gitkeep`; modify `README.md`, `.gitignore`, `tests/github-readiness.test.js`.

**Interfaces:** verified commands `npm test`, `docker build --tag clinic-management-system-test .`, `docker run --rm clinic-management-system-test`, `npm run dist`, and the demo URL `?demo=1`.

- [ ] Write failing readiness assertions for the required public documents, README sections, CI badge, workflow link, and no invented screenshots.
- [ ] Run the readiness test and confirm missing-document failures.
- [ ] Write the concise README/notes/guide with the verified approximately 80% impact, actual Electron architecture, accurate feature list, CI, Docker truth, local setup, build command, privacy boundary, screenshot filenames/crops, and genuine future improvements.
- [ ] Keep the screenshot directory empty except `.gitkeep`, run `npm test`, and commit the documentation.

### Task 4: Add Windows artifact workflow

**Files:** create `.github/workflows/release.yml`, `tests/workflows.test.js`; modify `.gitignore` and `README.md`.

**Interfaces:** `npm ci`, `npm test`, `npm run dist`, and ignored `dist/**` output.

- [ ] Write a failing workflow contract test for Node 20, `windows-latest`, manual/tag triggers, `npm ci`, complete tests, `npm run dist`, `actions/upload-artifact@v4`, `dist/**`, and read-only permissions.
- [ ] Run `node --test tests/workflows.test.js` and confirm it fails while `release.yml` is absent.
- [ ] Implement an artifact-only workflow: no release publishing, no secrets, no code signing, and no public visibility change from CI.
- [ ] Run workflow contract tests and commit the workflow.

### Task 5: Validate, publish, and report

**Files:** verify all tracked sources, Docker image, ignored Windows output, and GitHub repository settings.

- [ ] Run `npm test`, Docker build/run, `npm run dist`, YAML parsing, `git diff --check`, and stage/privacy scans.
- [ ] Push all commits, verify the remote tree contains approved sources but excludes local configuration, data, screenshots, installers, client identity, and known secret patterns.
- [ ] Change repository visibility to public only after remote verification; confirm `main` and the public repository URL.
- [ ] Report tested outcomes, any manual screenshot work, and factual resume-ready skills/bullets/link placement.

## Plan Self-Review

- The tasks cover public safety, default tests, isolated demo data, documentation, CI/release artifacts, and final public verification.
- All named files and interfaces exist or are created by a preceding task.
- The plan contains no incomplete implementation placeholders.
