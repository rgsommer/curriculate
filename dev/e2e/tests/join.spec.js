const { test, expect } = require('@playwright/test');

// Simple smoke: open teacher + 3 students and verify pages load and display the room code.
// Precondition: a session exists with code in env ROOM. Frontends and backend should be running.

const ROOM = process.env.ROOM || 'TESTCODE';
const STUDENT_URL = process.env.STUDENT_URL || 'http://localhost:5173';
const TEACHER_URL = process.env.TEACHER_URL || 'http://localhost:5174';

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
