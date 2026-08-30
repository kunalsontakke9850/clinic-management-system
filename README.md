# Clinic Management & Prescription System

A desktop clinic management and digital prescription application built with Electron. It centralizes patient visits, prescriptions, appointments, billing, finance records, and routine reception workflows in one locally run workspace.

## Impact

Reduced patient-record and prescription-processing time by approximately 80% by digitizing repetitive clinic workflows.

## Problem

Routine clinic workflows often depend on handwritten or disconnected manual processes. This application was built to centralize everyday clinical administration while keeping clinic-specific configuration outside the source repository.

## Key Features

- Patient visit records and editable prescription workflows
- Digital prescription and receipt printing
- Appointment, follow-up, and previous-record views
- Reception workflow with doctor access controls
- Billing, payment ledger, expenses, refunds, and cashbook reporting
- Optional Google Apps Script/Google Sheets synchronization
- WhatsApp appointment-reminder preparation
- Local X-ray image attachment support for visits

## Tech Stack

- JavaScript and HTML/CSS
- Electron
- Node.js
- Google Apps Script and Google Sheets (optional synchronization)
- `node:test` and JSDOM for automated checks

## Architecture

```text
Electron desktop shell
        ↓
Clinic workflow interface and local browser storage
        ↓
Optional Google Apps Script API
        ↓
Google Sheets persistence
```

## Project Structure

- `index.html` — primary application interface and workflow orchestration
- `main.js` — Electron desktop entry point
- `finance-*.js`, `payment-ledger.js` — billing, payments, and finance workflows
- `reception.js`, `access-control.js`, `admin.js` — reception and access-control features
- `Apps-Script-Code.gs` — optional Google Apps Script backend
- `tests/` — automated contract and module tests
- `config.js` — safe public defaults
- `config.local.example.js` — local configuration template

## Local Development Setup

Requirements: Node.js 20+ and npm.

```bash
git clone <your-private-repository-url>
cd clinic-management-system
npm install
```

Create your local clinic configuration. This file is ignored by Git and must never be committed.

Windows PowerShell:

```powershell
Copy-Item config.local.example.js config.local.js
```

macOS/Linux:

```bash
cp config.local.example.js config.local.js
```

Update `config.local.js` with your own Apps Script URL, write key, and clinic details, then run:

```bash
npm start
```

Run the automated checks with:

```bash
npm test
```

## Docker Test Environment

Docker provides a reproducible Node.js test environment. It does not run the Electron GUI or create the Windows installer; those remain native desktop operations.

```bash
docker build --tag clinic-management-system-test .
docker run --rm clinic-management-system-test
```

The build context uses an allowlist, so local clinic configuration, patient-related artifacts, generated installers, and private images are not sent to the Docker daemon.

## Environment and Local Configuration

The desktop application reads clinic-specific values from `config.local.js`, not from version-controlled source files. The `.env.example` file documents the corresponding variable names for deployment tooling, while `config.local.example.js` is the runnable local template.

For Google Apps Script synchronization, configure the same `APP_WRITE_KEY` as a Script Property in the Apps Script project. The repository deliberately contains no fallback write key.

## Privacy & Security

This repository does not contain production patient records, medical data, credentials, payment QR codes, client identity, or other confidential client information. Demo/sample data, where provided, is fictional. Generated installers, local configuration, backups, screenshots, internal notes, databases, uploads, and reports are excluded from Git.

## Screenshots

Screenshots are intentionally omitted because the original images may contain clinic-specific information. Add only sanitized screenshots after a privacy review.

## Future Improvements

- Dockerize the application
- Add continuous integration checks
- Introduce a managed deployment configuration
- Expand automated end-to-end coverage
