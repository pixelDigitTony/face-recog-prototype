import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: process.env.PROTOTYPE_URL || 'http://127.0.0.1:5190',
    channel: 'chrome',
    headless: true,
    launchOptions: { args: ['--use-fake-device-for-media-stream'] },
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
});
