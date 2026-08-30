# Clinic Management & Prescription System

[![Clinic Management CI](https://github.com/kunalsontakke9850/clinic-management-system/actions/workflows/ci.yml/badge.svg)](https://github.com/kunalsontakke9850/clinic-management-system/actions/workflows/ci.yml) [![Node.js 20](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

A locally run Electron desktop application that centralizes patient visits, digital prescriptions, appointments, reception, billing, payments, expenses, and finance workflows.

## Impact

Reduced patient-record and prescription-processing time by approximately 80% by digitizing repetitive clinic workflows.

## Problem

Handwritten and disconnected clinic processes make patient history, prescriptions, appointment follow-up, and payment reconciliation slow to manage. The application brings those workflows into one desktop workspace while keeping clinic-specific configuration local.

## Key Features

- Patient registration, visit history, prescription editing, and printable receipts
- Reception queue, doctor access control, and role-aware workspace navigation
- Appointment scheduling, follow-up records, and previous-record views
- Billing, payment ledger, partial payments, refunds, expenses, and cashbook reporting
- Optional Google Apps Script and Google Sheets synchronization with offline-first local caching
- WhatsApp appointment-reminder preparation that requires review before opening a draft
- Local X-ray/image attachment support for visit records
- Fictional opt-in demo mode for portfolio review

## Tech Stack

Electron · Node.js · JavaScript · HTML/CSS · Google Apps Script · Google Sheets · `node:test` · JSDOM · Docker · GitHub Actions

## Architecture

```text
Electron desktop shell (main.js)
            |
HTML/CSS workspace + JavaScript modules (index.html)
            |
Local browser storage and offline sync queue
            |
Optional Google Apps Script contract
            |
Google Sheets persistence
```

The application is a desktop client, not a hosted web service. Docker validates the Node.js test environment; it does not run the Electron GUI.

## Automated Testing

The default command runs every maintained Node test file:

```bash
npm test
```

The suite covers access control, administration, reception and doctor workflows, prescriptions and medicine parsing, billing and finance calculations, payment/refund rules, Apps Script contracts, WhatsApp draft preparation, desktop navigation, configuration safety, Docker contracts, and module smoke checks. Tests use fictional deterministic fixtures with `node:test` and JSDOM.

## Continuous Integration

GitHub Actions runs the same Node 20 test command on pushes to `main`, pull requests targeting `main`, and manual dispatch. It uses npm dependency caching, `npm ci --ignore-scripts`, and read-only repository permissions.

## Docker Test Environment

Docker provides a reproducible Node.js test environment. It does not run the Electron GUI or create the Windows installer.

```bash
docker build --tag clinic-management-system-test .
docker run --rm clinic-management-system-test
```

The Docker build context is allowlisted and excludes local configuration, credentials, patient-related artifacts, private images, generated installers, and databases.

## Demo

Open the app with `?demo=1` to seed fictional local records for Arjun Mehta, including a sample visit, prescription, appointment, partial bill, and reception data. Demo mode never reads private configuration or sends network requests. Remove demo data with `window.ClinicDemo.reset()` while the same query is active. See [the screenshot guide](docs/SCREENSHOT_GUIDE.md) for safe portfolio captures.

## Local Development Setup

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/kunalsontakke9850/clinic-management-system.git
cd clinic-management-system
npm install
npm start
```

For a private clinic installation, copy `config.local.example.js` to the ignored `config.local.js`, then add local Apps Script and clinic values. Never commit that file.

## Build

Build the unsigned Windows NSIS installer locally with:

```bash
npm run dist
```

The generated `dist/` directory is ignored. GitHub Actions also provides a manual/tagged Windows artifact workflow; it does not publish a release automatically.

## Privacy & Security

The public defaults contain no live Apps Script URL, write key, credential, patient record, medical image, payment QR code, or client identity. Production data and configuration remain outside Git. Strict `.gitignore` and `.dockerignore` allowlists protect local files, and the application keeps Electron Node integration disabled with context isolation enabled.

## Project Structure

- `main.js` — Electron entry point and secure BrowserWindow configuration
- `index.html` — primary workspace and prescription/billing orchestration
- `reception.js`, `access-control.js`, `admin.js` — reception and role/session workflows
- `finance-core.js`, `finance-store.js`, `finance-ui.js`, `payment-ledger.js` — finance, offline sync, billing, and payments
- `prescription-medicines.js`, `whatsapp-messaging.js`, `sheet-operation.js` — focused workflow contracts
- `Apps-Script-Code.gs` — optional server-side Google Sheets contract
- `demo-data.js` — fictional opt-in portfolio data
- `tests/` — automated contract, integration-style JSDOM, and module tests

## Screenshots

No screenshots are included by default. Add only sanitized captures in `docs/screenshots/` after following [the screenshot guide](docs/SCREENSHOT_GUIDE.md).

## Future Improvements

- Expand end-to-end coverage around the Electron shell and hosted Apps Script boundary
- Add an export/import format for moving encrypted local settings between devices
- Add accessibility review and keyboard-navigation coverage for every workspace
- Evaluate a managed deployment option only if a future product version requires it

## Portfolio Notes

See [docs/PORTFOLIO_NOTES.md](docs/PORTFOLIO_NOTES.md) for factual recruiter-facing project notes and resume wording.
