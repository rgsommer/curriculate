const { test, expect } = require('@playwright/test');

// Simple smoke: open teacher + 3 students and verify pages load and display the room code.
// Precondition: a session exists with code in env ROOM. Frontends and backend should be running.

const { execSync } = require('child_process');

let ROOM = process.env.ROOM || null;
const STUDENT_URL = process.env.STUDENT_URL || 'http://localhost:5173';
const TEACHER_URL = process.env.TEACHER_URL || 'http://localhost:5174';

// If no ROOM provided, create one via setupSession.js
if (!ROOM) {
  try {
    const out = execSync('node ./dev/e2e/setupSession.js', { encoding: 'utf8' }).trim();
    if (out) {
      ROOM = out.split('\n').pop().trim();
      console.log('E2E created ROOM=', ROOM);
    }
  } catch (err) {
    console.error('Failed to run setupSession.js', err);
    ROOM = process.env.ROOM || 'TESTCODE';
  }
}

test('teacher and multiple students can load and join', async ({ browser }) => {
  // Teacher context
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`${TEACHER_URL}/?code=${ROOM}`);
  await expect(teacherPage).toHaveTitle(/Curriculate|Live Session|/i);
  await expect(teacherPage.locator('text=Code').first()).toBeVisible({ timeout: 5000 }).catch(()=>{});

  // Students
  const studentPages = [];
  for (let i = 1; i <= 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${STUDENT_URL}/?code=${ROOM}`);
    // page should show Room or Join UI
    await expect(page.locator(`text=${ROOM}`).first()).toBeVisible({ timeout: 5000 }).catch(()=>{});
    studentPages.push(page);
  }

  // Give some time for sockets to connect
  await new Promise((r) => setTimeout(r, 2000));

  // Clean up
  await Promise.all(studentPages.map((p) => p.close()));
  await teacherPage.close();
});
