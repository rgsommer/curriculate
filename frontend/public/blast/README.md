# Blast email assets

Files in this directory are referenced by the cold-outreach email
templates in `backend/jobs/blastSender.js`. They're served publicly at
`https://www.curriculate.net/blast/<filename>`.

## Mascot images (drop these in)

The email templates expect THREE mascot JPGs. Save the fox-mascot
images you generated as:

| Filename                  | Used in            | Image description                                                 |
|---------------------------|--------------------|-------------------------------------------------------------------|
| `mascot-curriculate.jpg`  | Curriculate emails | Fox at TECH-ED booth holding a tablet with "Language Quest"       |
| `mascot-fieldday.jpg`     | Field Day emails   | Fox at "Elementary Field Day" with trophy + rainbow medal         |
| `mascot-pulse.jpg`        | Pulse emails       | Fox at classroom desk with stack of tests and phone showing G+    |

Recommended size: ~600px wide JPG (renders at 220px width in email
clients, with retina-sharpness margin). Aspect ratio roughly 16:9 or
3:2 works best with the email layout.

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
