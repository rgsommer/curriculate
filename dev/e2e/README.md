# Playwright E2E smoke tests

This folder contains a minimal Playwright setup to smoke-test the student and teacher frontends.

Prerequisites
- Backend running (http://localhost:4000)
- Student app running (http://localhost:5173)
- Teacher app running (http://localhost:5174)
- A session created with a room code (e.g. `TESTCODE`). You can create via the teacher UI or the API: POST /sessions with a `taskSetId`.

Quick run

```bash
cd dev/e2e
npm install
# set ROOM env and URLs if different
ROOM=YOURCODE STUDENT_URL=http://localhost:5173 TEACHER_URL=http://localhost:5174 npm test
```

Notes
- This test only checks pages load and displays the room code; it does not create sessions or teams. For full end-to-end, create the session and teams via the backend before running the test.
