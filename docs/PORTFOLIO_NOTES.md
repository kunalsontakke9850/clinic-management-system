# Portfolio Notes

## Project

Clinic Management & Prescription System

## Type

Client-facing Electron desktop application for clinic administration and digital prescriptions.

## Problem

Manual and handwritten clinic workflows made patient records, prescriptions, appointment follow-up, and payment reconciliation repetitive and slow.

## Impact

Reduced patient-record and prescription-processing time by approximately 80% by digitizing repetitive clinic workflows.

## Actual Technologies

Electron, Node.js, JavaScript, HTML/CSS, Google Apps Script, Google Sheets, node:test, JSDOM, Docker, GitHub Actions, Git, and GitHub.

## Engineering Work

- Built a local-first Electron workspace for reception, doctor, prescription, appointment, billing, payment, expense, refund, and cashbook workflows.
- Implemented role-aware access control and session handling for reception and doctor workflows.
- Added offline caching and synchronization contracts for optional Google Apps Script/Google Sheets persistence.
- Added medicine parsing, printable prescription/receipt flows, payment reconciliation, and review-before-open WhatsApp reminder preparation.
- Added opt-in fictional demo data that never reads private configuration or sends network requests.

## Testing Strategy

The repository uses Node's built-in test runner and JSDOM. Tests cover access control, administration, reception/home flows, prescriptions, medicine parsing, finance and payment rules, refunds, Apps Script contracts, WhatsApp draft preparation, desktop navigation, configuration safety, Docker contracts, demo isolation, and module smoke checks.

## Docker and CI

Docker provides a reproducible Node.js test environment; it does not run the Electron GUI. GitHub Actions runs the complete Node 20 test suite on main pushes, pull requests, and manual dispatch. A separate Windows workflow verifies the unsigned Electron Builder installer and uploads it as a workflow artifact without publishing a release.

## Architecture

```text
Electron shell
  -> HTML/CSS workspace and JavaScript modules
  -> browser local storage and offline sync queue
  -> optional Google Apps Script contract
  -> Google Sheets persistence
```

## Privacy Considerations

Production patient records, medical data, clinic identity, credentials, payment QR codes, local configuration, screenshots, databases, and generated installers are excluded from the public repository. Public defaults are blank or neutral, and fictional demo records are opt-in only.
