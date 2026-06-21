import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,        // 单进程跑，避免本地端口冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: [
    {
      command: 'cd ../server && ONLYOFFICE_HOST=http://localhost:8080 ONLYOFFICE_JWT_SECRET=mvtndSBp0a7fa400u81Cq2MSfddXD090 HOST_FOR_DOCKER=http://host.docker.internal:5180 node src/index.mjs',
      url: 'http://localhost:5180/api/health',
      reuseExistingServer: true,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5188',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
})