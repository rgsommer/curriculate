const { test } = require('@playwright/test');

// simple no-op placeholder so this file won't cause parse/run errors
test.skip('legacy join.spec placeholder', async () => {});

test('full flow: create teams via REST, start session, students submit, scoring asserted', async ({ browser, request }) => {
  const ROOM_LOCAL = ROOM || (await (async () => { execSync('node ./dev/e2e/setupSession.js'); return process.env.ROOM || 'TESTCODE'; })());

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
      await teacherPage.waitForTimeout(800);

      // Click Score Task as teacher
      const scoreBtn = teacherPage.getByRole('button', { name: /Score Task/i });
      await expect(scoreBtn).toBeVisible();
      await scoreBtn.click();

      // Wait for scores:updated and UI to reflect new scores
      await teacherPage.waitForTimeout(800);

      // Read team list items and assert expected scoring:
      // Baseline: basePoints=10, speed bonus fastest=5, next=3 (matching computeScores defaults from scoring util)
      // Expect: Team A = 15, Team B = 13, Team C = 0
      const listItems = teacherPage.locator('li');
      await expect(listItems).toHaveCount(teamNames.length);

      const scores = {};
      for (let i = 0; i < teamNames.length; i++) {
        const loc = listItems.nth(i);
        const text = await loc.innerText();
        // text format like 'Team A: 15' (LiveSession uses `{t.name}: {t.score}`)
        const parts = text.split(':');
        const name = parts[0].trim();
        const score = parseInt((parts[1] || '0').trim(), 10) || 0;
        scores[name] = score;
      }

      expect(scores['Team A']).toBeGreaterThanOrEqual(15);
      expect(scores['Team B']).toBeGreaterThanOrEqual(13);
      expect(scores['Team C']).toBe(0);
    });
      execSync('node ./dev/e2e/teardownSession.js', { stdio: 'inherit' });
      console.log('E2E teardown ran');
    } catch (err) {
      console.error('E2E teardown failed', err);
    }
  }
});
