// compare-ui.spec.ts：UI 烟雾测试 + 截图回归
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'

test.describe('翻译对比 UI', () => {
  test('任务列表上 docx 卡片有「对比」按钮', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(800)
    // 至少有一个 docx 卡片含对比按钮（依赖样本扫描）
    const compareBtn = page.locator('.card .btn-mini:has-text("对比")').first()
    await expect(compareBtn).toBeVisible({ timeout: 5000 })
  })

  test('点「对比」→ 弹出译文目标选择器', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(800)
    const compareBtn = page.locator('.card .btn-mini:has-text("对比")').first()
    await compareBtn.click()
    await expect(page.locator('.compare-picker')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.compare-picker .modal-name')).toContainText('选择译文对照目标')
  })

  test('取消选择器返回列表', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(800)
    await page.locator('.card .btn-mini:has-text("对比")').first().click()
    await page.locator('.compare-picker .btn-mini:has-text("取消")').click()
    await expect(page.locator('.compare-picker')).toHaveCount(0)
  })
})
