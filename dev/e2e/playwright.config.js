// Playwright config for simple end-to-end checks
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  timeout: 60_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
  testDir: './tests',
};

module.exports = config;
