# Safe Screenshot Guide

Screenshots are optional. Do not add a screenshot unless every visible value is fictional and the image has been reviewed before committing.

## Start the fictional demo

1. Run `npm install` and `npm start`.
2. Open the app with the URL/query option `?demo=1` documented in the README. The demo seed uses Arjun Mehta, age 32, `9999999999`, and Dr. Demo User.
3. Keep the app offline for screenshots. Demo mode is local-only and does not require Apps Script or Google Sheets configuration.

## Target captures

| Filename | Screen | What to show |
| --- | --- | --- |
| `01-dashboard.png` | Home/dashboard | Fictional patient queue and navigation, with no clinic branding or private settings. |
| `02-patient-record.png` | Patient history | Arjun Mehta's sample visit history and generic clinical fields. |
| `03-prescription.png` | Prescription | Sample mouth-rinse line, generic advice, and the printable prescription layout. |
| `04-appointments.png` | Upcoming Appointments | The fictional follow-up appointment and review-only reminder control. |
| `05-finance.png` | Finance | Sample partial bill, payment, outstanding amount, and cashbook/expense summary. |

## Capture rules

- Use a 1440×900 or larger window and crop tightly to the application workspace.
- Never show real names, phone numbers, addresses, medical histories, prescriptions, X-rays, QR codes, credentials, Apps Script URLs, write keys, or browser tabs.
- Do not open Settings while capturing if it contains local configuration fields.
- Verify the image contains only fictional demo data before saving it under `docs/screenshots/`.
- Use exactly the filenames in the table; do not commit screenshots with other names or unsanitized backups.
