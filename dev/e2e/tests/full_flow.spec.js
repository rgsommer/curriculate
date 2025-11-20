const { test, expect } = require('@playwright/test');

let ROOM = process.env.ROOM || null;
const STUDENT_URL = process.env.STUDENT_URL || 'http://localhost:5173';
const TEACHER_URL = process.env.TEACHER_URL || 'http://localhost:5174';

// If no ROOM provided, create one via the backend REST API inside Playwright's
// request context. This avoids running setupSession.js (which required a local
// MongoDB instance).
test.beforeAll(async ({ request }) => {
  if (ROOM) return;
  const backendBase = process.env.BACKEND_URL || 'http://localhost:4000';

  // create a TaskSet using the upload-csv endpoint
  const csvText = 'task_id,title,prompt,task_type,answer,points\n' +
    't1,Multiplication,What is 6 x 7?,open_text,42,10';

  const tsResp = await request.post(`${backendBase}/upload-csv/from-csv`, {
    data: { csvText, name: 'E2E Test Set' },
  });
  if (!tsResp.ok()) {
    console.error('Failed to create TaskSet', await tsResp.text());
    ROOM = process.env.ROOM || 'TESTCODE';
    return;
  }
  const tsBody = await tsResp.json();
  const taskSetId = tsBody.tasksetId;

  const code = `E2E${Date.now().toString().slice(-4)}`;
  const sessResp = await request.post(`${backendBase}/sessions`, {
    data: { taskSetId, code },
  });
  if (!sessResp.ok()) {
    console.error('Failed to create Session', await sessResp.text());
    ROOM = process.env.ROOM || 'TESTCODE';
    return;
  }
  const sessBody = await sessResp.json();
  ROOM = sessBody.code || code;
  console.log('E2E created ROOM=', ROOM);
});

// Simple smoke test to ensure pages load
test('teacher and multiple students can load and join (smoke)', async ({ browser }) => {
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`${TEACHER_URL}/?code=${ROOM}`);
  await expect(teacherPage).toHaveTitle(/Curriculate|Live Session|/i);
  await expect(teacherPage.locator('text=Code').first()).toBeVisible({ timeout: 5000 }).catch(() => {});

  // Students
  const studentPages = [];
  for (let i = 1; i <= 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${STUDENT_URL}/?code=${ROOM}`);
    // page should show Room or Join UI
    await expect(page.locator(`text=${ROOM}`).first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    studentPages.push(page);
  }

  // Give some time for sockets to connect
  await new Promise((r) => setTimeout(r, 2000));

  // Clean up
  await Promise.all(studentPages.map((p) => p.close()));
  await teacherPage.close();
});

// Full flow: create teams via REST, start session, students submit, teacher scores, assert scores
test('full flow: create teams via REST, start session, students submit, scoring asserted', async ({ browser, request }) => {
  const ROOM_LOCAL = ROOM;

  // create three teams through backend REST API
  const backendBase = process.env.BACKEND_URL || 'http://localhost:4000';
  const teamNames = ['Team A', 'Team B', 'Team C'];
  const createdTeams = [];

  for (const name of teamNames) {
    const resp = await request.post(`${backendBase}/sessions/${ROOM_LOCAL}/teams`, {
      data: { name },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    createdTeams.push(body);
  }

  // open teacher page
  const teacherPage = await browser.newPage();
  await teacherPage.goto(TEACHER_URL + `?code=${ROOM_LOCAL}`);

  // open student pages, each one will join using the created team id
  const studentPages = [];
  for (let i = 0; i < 3; i++) {
    const teamId = createdTeams[i]._id || createdTeams[i].id || createdTeams[i].teamId;
    const p = await browser.newPage();
    await p.goto(STUDENT_URL + `?code=${ROOM_LOCAL}&teamId=${teamId}`);
    studentPages.push(p);
  }

  // Wait for sockets to connect
  await teacherPage.waitForTimeout(500);

  // Start session as teacher by clicking the Start button
  const startBtn = teacherPage.getByRole('button', { name: /Start Session/i });
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  // Wait a moment for server to advance and emit task:started
  await teacherPage.waitForTimeout(500);

  // Students submit answers. Make Team A fastest and correct, Team B slower and correct, Team C incorrect.
  const answers = ['42', '42', '0'];
  for (let i = 0; i < studentPages.length; i++) {
    const p = studentPages[i];
    const input = p.getByRole('textbox');
    const submit = p.getByRole('button', { name: /submit/i });
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(answers[i]);
    if (i === 0) {
      await submit.click();
    } else {
      await p.waitForTimeout(600 + i * 200);
      await submit.click();
    }
  }

  // Wait for submissions to reach server
  await teacherPage.waitForTimeout(800);

  // Click Score Task as teacher
  const scoreBtn = teacherPage.getByRole('button', { name: /Score Task/i });
  await expect(scoreBtn).toBeVisible();
  await scoreBtn.click();

  // Wait for scores:updated and UI to reflect new scores
  await teacherPage.waitForTimeout(800);

  // Read team list items and assert expected scoring
  const listItems = teacherPage.locator('li');
  await expect(listItems).toHaveCount(teamNames.length);

  const scores = {};
  for (let i = 0; i < teamNames.length; i++) {
    const loc = listItems.nth(i);
    const text = await loc.innerText();
    const parts = text.split(':');
    const name = parts[0].trim();
    const score = parseInt((parts[1] || '0').trim(), 10) || 0;
    scores[name] = score;
  }

  expect(scores['Team A']).toBeGreaterThanOrEqual(15);
  expect(scores['Team B']).toBeGreaterThanOrEqual(13);
  expect(scores['Team C']).toBe(0);

  // cleanup pages
  await Promise.all(studentPages.map((p) => p.close()));
  await teacherPage.close();
});

// After all tests, attempt to teardown the session created by setupSession
test.afterAll(() => {
  try {
    execSync('node ./dev/e2e/teardownSession.js', { stdio: 'inherit' });
    console.log('E2E teardown ran');
  } catch (err) {
    console.error('E2E teardown failed', err);
  }
});
