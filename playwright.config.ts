import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 800, height: 450 }, // 横屏设计分辨率
  },
  webServer: {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } }],
});
