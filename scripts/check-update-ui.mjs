import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Exercise the real packaged preload, IPC and settings file with an isolated QA profile. */
export async function checkUpdateUi(cdp, profileDir, screenshotPath) {
  await cdp.evaluate(`document.querySelector('button[aria-label="软件更新"]')?.click()`)
  await cdp.waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('每 6 小时自动检查更新')`)
  const before = await cdp.evaluate(`window.api.getUpdateState()`)
  if (before.settings.autoCheck !== true || !before.settings.downloadDirectory || before.currentVersion === '') {
    throw new Error(`Unexpected update defaults: ${JSON.stringify(before)}`)
  }
  const denied = await cdp.evaluate(`window.api.installUpdate()`)
  if (denied !== false) throw new Error('Installation was allowed without a verified download')
  await cdp.evaluate(`document.querySelector('[role="dialog"] input[type="checkbox"]').click()`)
  await cdp.waitFor(`document.querySelector('[role="dialog"] input[type="checkbox"]:not(:checked):not(:disabled)') !== null`)
  const persisted = JSON.parse(await readFile(path.join(profileDir, 'update-settings.json'), 'utf8'))
  if (persisted.autoCheck !== false) throw new Error('Auto-check preference was not persisted')
  await new Promise((resolve) => setTimeout(resolve, 400))
  await cdp.capture(screenshotPath.replace(/\.png$/i, '-updates-dark.png'))
  await cdp.evaluate(`document.querySelector('[role="dialog"] button[aria-label="关闭弹窗"]').click()`)
  await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)
  await cdp.evaluate(`document.querySelector('button[aria-label="Switch to English"]').click()`)
  await cdp.evaluate(`document.querySelector('button[aria-label="Switch to light mode"]').click()`)
  await cdp.evaluate(`document.querySelector('button[aria-label="Software updates"]').click()`)
  await cdp.waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Automatically check every 6 hours')`)
  const checked = await cdp.evaluate(`document.querySelector('[role="dialog"] input[type="checkbox"]').checked`)
  if (checked) throw new Error('Disabled auto-check did not survive reopening the panel')
  await new Promise((resolve) => setTimeout(resolve, 400))
  await cdp.capture(screenshotPath.replace(/\.png$/i, '-updates-light.png'))
  // No network dependency in CI. A separate opt-in smoke check uses the real GitHub endpoint.
  if (process.env.ZCLIP_QA_LIVE_UPDATE === '1') {
    const result = await cdp.evaluate(`window.api.checkForUpdates()`)
    if (!['up-to-date', 'available'].includes(result.status)) throw new Error(`Live update check failed: ${JSON.stringify(result)}`)
    console.log(`Live GitHub update check: ${result.status}, current ${result.currentVersion}`)
  }
  await cdp.evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close dialog"]').click()`)
  await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)
  await cdp.evaluate(`document.querySelector('button[aria-label="Switch to dark mode"]').click()`)
  await cdp.evaluate(`document.querySelector('button[aria-label="切换为中文"]').click()`)
  console.log('Update UI QA: bilingual themes, six-hour defaults, persistent opt-out and unverified-install rejection passed')
}
