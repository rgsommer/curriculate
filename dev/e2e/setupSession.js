// dev/e2e/setupSession.js
// Create a TaskSet and Session by calling the backend REST API. This avoids
// requiring a local MongoDB instance during e2e runs.

const fs = require('fs');
const path = require('path');

(async function main() {
  const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

  // deterministic-ish session code unless overridden
  const code = process.env.SESSION_CODE || `E2E${Date.now().toString().slice(-4)}`;

  // 1) create a TaskSet via the upload-csv endpoint (no auth required)
  const csvText =
    'task_id,title,prompt,task_type,answer,points\n' +
    't1,Multiplication,What is 6 x 7?,open_text,42,10';

  const createTsResp = await fetch(`${BACKEND}/upload-csv/from-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csvText, name: 'E2E Test Set' }),
  });

  if (!createTsResp.ok) {
    const txt = await createTsResp.text().catch(() => '<no body>');
    throw new Error(`Failed to create TaskSet: ${createTsResp.status} ${txt}`);
  }

  const tsBody = await createTsResp.json();
  const taskSetId = tsBody.tasksetId;

  // 2) create a Session using the new TaskSet
  const createSessionResp = await fetch(`${BACKEND}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskSetId, code }),
  });

  if (!createSessionResp.ok) {
    const txt = await createSessionResp.text().catch(() => '<no body>');
    throw new Error(`Failed to create Session: ${createSessionResp.status} ${txt}`);
  }

  const sessionBody = await createSessionResp.json();

  const out = { code: sessionBody.code || code, taskSetId, sessionId: sessionBody._id };
  const infoPath = path.resolve(__dirname, 'session-info.json');
  fs.writeFileSync(infoPath, JSON.stringify(out, null, 2));
  console.log(out.code);
})().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
        ```javascript
        // dev/e2e/setupSession.js
        // Create a TaskSet and Session by calling the backend REST API. This avoids
        // requiring a local MongoDB instance during e2e runs.

        const fs = require('fs');
        const path = require('path');

        async function main() {
          const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

          // deterministic-ish session code unless overridden
          const code = process.env.SESSION_CODE || `E2E${Date.now().toString().slice(-4)}`;

          // 1) create a TaskSet via the upload-csv endpoint (no auth required)
          const csvText = `task_id,title,prompt,task_type,answer,points\n` +
            `t1,Multiplication,What is 6 x 7?,open_text,42,10`;

          const createTsResp = await fetch(`${BACKEND}/upload-csv/from-csv`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvText, name: 'E2E Test Set' }),
          });

          if (!createTsResp.ok) {
            const txt = await createTsResp.text().catch(() => '<no body>');
            throw new Error(`Failed to create TaskSet: ${createTsResp.status} ${txt}`);
          }

          const tsBody = await createTsResp.json();
          const taskSetId = tsBody.tasksetId;

          // 2) create a Session using the new TaskSet
          const createSessionResp = await fetch(`${BACKEND}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskSetId, code }),
          });

          if (!createSessionResp.ok) {
            const txt = await createSessionResp.text().catch(() => '<no body>');
            throw new Error(`Failed to create Session: ${createSessionResp.status} ${txt}`);
          }

          const sessionBody = await createSessionResp.json();

          const out = { code: sessionBody.code || code, taskSetId, sessionId: sessionBody._id };
          const infoPath = path.resolve(__dirname, 'session-info.json');
          fs.writeFileSync(infoPath, JSON.stringify(out, null, 2));
          console.log(out.code);
        }

        main().catch((err) => {
          console.error(err && err.message ? err.message : err);
          process.exit(1);
        });

        ```
