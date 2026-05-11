# Blast email assets

Files in this directory are referenced by the cold-outreach email
templates in `backend/jobs/blastSender.js`. They're served publicly at
`https://www.curriculate.net/blast/<filename>`.

## Mascot images

Mascot images live alongside the rest of the project's mascot library
at `frontend/public/images/mascot/<scenario>/1.png`. The email
templates reference them via:

| Email      | Path                                            |
|------------|-------------------------------------------------|
| Curriculate| `/images/mascot/ambassador/1.png`               |
| Field Day  | `/images/mascot/fieldday/1.png`                 |
| Pulse      | `/images/mascot/grading/1.png`                  |

To swap which variant is used, either rename the file you want to
`1.png`, or update the path in `backend/jobs/blastSender.js`
(search for `heroImage(`).

## Sample PDFs (already in place)

| Filename                              | Linked from        |
|---------------------------------------|--------------------|
| `Curriculate-Report-WATER-42.pdf`     | Pulse email — "see a real graded paper" link |
| `Curriculate-FieldDay-Sample.pdf`     | Field Day email — "see a sample event sheet" link |

These are checked into the repo. If you replace them, keep the
filename the same OR update the references in `blastSender.js`.

## Why a separate folder?

Keeps the public asset namespace tidy and makes it easy to spot files
that are only referenced by outbound email (vs. files that ship to
the public marketing site).
