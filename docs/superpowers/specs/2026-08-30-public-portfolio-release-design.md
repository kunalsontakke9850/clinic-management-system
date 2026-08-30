# Public Portfolio Release Design

## Goal

Prepare Clinic Management & Prescription System as a public, recruiter-ready Electron portfolio repository without changing its production workflow or publishing client, patient, credential, or medical information.

## Current Architecture

The application is an Electron desktop application. `main.js` creates the desktop window with Node integration disabled and context isolation enabled. `index.html` loads the JavaScript modules that implement reception, prescriptions, finance, payments, access control, WhatsApp draft preparation, and the desktop workspace. Browser local storage retains local workflow state. `config.js` provides blank public defaults, while the ignored `config.local.js` can override them for a private clinic installation. Google Apps Script and Google Sheets synchronization are optional integrations.

Electron Builder creates a Windows NSIS installer from the reviewed source allowlist. Docker is a Node.js test environment and does not run the Electron GUI.

## Public Release Boundaries

- The repository will be public only after the final remote-tree privacy audit passes.
- `config.local.js`, environment files, credentials, private documents, generated installers, databases, patient records, screenshots, and clinic-branded artwork remain ignored and outside Docker contexts.
- Tracked configuration remains blank/default-only. The Electron build includes `config.js` but never includes `config.local.js`.
- Example integration addresses and keys will use clear non-live placeholders; no production Apps Script endpoint or usable write key is retained.
- Existing ignored planning documents are not made public. Only this safe release-design document is tracked under `docs/superpowers/specs/`.

## Portfolio Documentation

The README will describe only verified capabilities: Electron/Node.js desktop workflows, optional Apps Script/Sheets synchronization, tests, Docker validation, CI, and Windows packaging. It will state the user-provided approximately 80% workflow-time reduction as project impact and will not add other metrics.

New public documentation will include:

- `docs/PORTFOLIO_NOTES.md` with factual recruiter-facing project notes.
- `docs/SCREENSHOT_GUIDE.md` with instructions for creating screenshots from fictional demo data only.
- `docs/screenshots/.gitkeep` to establish the screenshots folder without fabricated images.

The README will reserve screenshot references for future sanitized images rather than claiming images exist.

## Demo Mode

An opt-in local demo seed will be added only if it can use existing browser-storage contracts without affecting ordinary startup. It will use fictional deterministic data and a visibly documented activation route. It must never call private configuration, Apps Script, Google Sheets, or a real messaging endpoint. If a safe comprehensive seed is not feasible after inspecting the storage contracts, the implementation will retain the application behavior and document the manual fictional-data screenshot workflow instead.

## Automated Testing

The default `npm test` command will execute all existing `*.test.js` files so the CI job covers access control, administration, module-smoke, privacy, Docker, finance, reception, medicines, Apps Script contracts, workspace, and WhatsApp drafting tests. Existing node:test and JSDOM tooling remains unchanged.

New tests will protect public configuration, demo-data isolation if added, documentation links where practical, Docker-context safe-source requirements, and CI/release workflow contracts. Tests use only fictional deterministic records.

## Continuous Integration and Release Artifacts

The existing CI workflow will be retained and updated to `actions/checkout@v5` and `actions/setup-node@v5`, Node 20, npm dependency caching, `npm ci --ignore-scripts`, and `npm test`. It will run on main pushes, main pull requests, and manual dispatch with `contents: read` permissions and a timeout.

A separate Windows release-artifact workflow will run on manual dispatch and version tags. It will use `windows-latest`, Node 20, install dependencies needed for Electron Builder, run the complete test suite, run `npm run dist`, and upload the generated installer/build output as an artifact. It will not publish a GitHub Release or alter repository visibility automatically. Artifact upload uses current stable Actions tooling and only read permissions.

## Verification

Before publication, the implementation will verify:

1. `npm test` passes.
2. Docker build and container test run pass.
3. The Windows build runs successfully when the local environment permits it; otherwise the Windows GitHub workflow documents the remaining hosted validation path.
4. YAML parses and workflow contract tests pass.
5. The staged and remote trees exclude private configuration, generated output, documents, data files, and known secret patterns.
6. The GitHub repository is changed to public only after these checks pass.

## Out of Scope

- Running the Electron GUI in Docker.
- Invented screenshots, cloud deployment, continuous deployment, code signing, or a license.
- Changes to clinic operational behavior beyond an opt-in, isolated fictional demo seed.
- Publishing builds as GitHub Releases.
