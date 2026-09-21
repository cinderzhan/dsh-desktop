// Isolated real-host/UI smoke check. No real user profile or model request.
// CHROME_EXECUTABLE must point to a local Chromium executable.
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const executablePath = process.env.CHROME_EXECUTABLE
if (!executablePath) throw new Error('Set CHROME_EXECUTABLE to a local Chromium executable')
const home = await mkdtemp(join(tmpdir(), 'dsh-huaxue-smoke-'))
const port = Number(process.env.HUAXUE_TEST_PORT || 45739)
const child = spawn(process.execPath, ['--expose-internals', 'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'web', '--patch', resolve('build/dsh-desktop.patch.yml'), '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
})
let browser
let page
let output = ''
try {
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('Harness start timed out: ' + output.slice(-4000))), 45000)
    const scan = data => {
      output += data.toString()
      const match = /dsh web:\s*(\S+)/.exec(output)
      if (match) { clearTimeout(timer); resolveUrl(match[1]) }
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Harness exited ${code}: ${output.slice(-4000)}`)) })
  })
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(url)
  console.log('Isolated Harness ready; checking market UI.')
  const skip = page.getByRole('button', { name: /^(跳过此步|Skip this step)$/ })
  if (await skip.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)) {
    // Test-profile setup only; the separately maintained onboarding modal's
    // skip-all confirmation is currently obscured by its own overlay.
    for (let step = 0; step < 4; step++) await skip.click()
  }
  await page.getByRole('button', { name: '工作台市场', exact: true }).click({ timeout: 20000 })
  const market = page.getByRole('region', { name: '工作台市场', exact: true })
  const card = market.locator('article').filter({ has: page.getByRole('heading', { name: /花少2 · 花学工作台/ }) })
  await card.waitFor()
  assert.equal(await market.getByText('调研记录', { exact: true }).count(), 0)
  assert.equal(await market.getByText('内容创作', { exact: true }).count(), 0)
  await page.screenshot({ path: join(home, 'market.png') })
  await card.getByRole('button', { name: '安装', exact: true }).click()
  await card.getByRole('button', { name: '打开工作台', exact: true }).click()
  const panel = page.getByRole('region', { name: '花学工作台', exact: true })
  await panel.waitFor()
  assert.equal(await panel.getByRole('button', { name: '新建工作区并开始对话', exact: true }).isEnabled(), true)
  assert.equal(await panel.locator('.hx-desktop-person').count(), 7)
  await page.screenshot({ path: join(home, 'huaxue.png') })
  const state = await page.evaluate(async () => (await fetch('/api/desktop-workbenches/state')).json())
  assert.deepEqual(state.state.added, ['huaxue'])
  assert.deepEqual(state.state.sessionBindings, {})
  const workspacePath = await mkdtemp(join(tmpdir(), 'dsh-huaxue-workspace-'))
  const created = await page.request.post(new URL('/api/workspace/create', url).href, {
    data: { type: 'client-request', rpcId: 'huaxue-smoke-create', method: 'workspace/create', payload: { args: { request: { path: workspacePath } } } }
  })
  assert.equal(created.status(), 200, await created.text())
  const { result } = await created.json()
  assert.equal(result.ok, true, JSON.stringify(result))
  const workspaceId = result.value.workspace.workspaceId
  const picker = panel.getByRole('complementary', { name: '选择花学旅伴', exact: true })
  await picker.getByRole('combobox', { name: '花学工作区' }).selectOption(workspaceId)
  await picker.locator('.hx-desktop-person[aria-pressed="true"]').click()
  await page.waitForFunction(async () => {
    const result = await (await fetch('/api/desktop-workbenches/state')).json()
    return Object.values(result.state.sessionBindings).includes('huaxue')
  })
  await panel.locator('[contenteditable="true"]').waitFor()
  assert.equal(await panel.locator('[contenteditable="true"]').count(), 1)
  await page.screenshot({ path: join(home, 'owned-session.png') })
  await panel.getByRole('button', { name: '打开第八位嘉宾游戏', exact: true }).click()
  await panel.locator('.hx-play').waitFor()
  await panel.locator('.hx-scene-card').first().getByRole('button', { name: '进入现场 →', exact: true }).click()
  await panel.getByRole('button', { name: '我来接一句', exact: true }).click()
  await panel.getByRole('radio').first().check()
  await panel.getByRole('button', { name: '发送接话', exact: true }).click()
  await page.waitForFunction(async () => {
    const result = await (await fetch('/api/desktop-workbenches/state')).json()
    return Object.values(result.state.sessionBindings).filter(owner => owner === 'huaxue').length >= 2
  })
  assert.equal(await panel.getByRole('dialog', { name: '第八位嘉宾', exact: true }).isVisible(), true)
  await page.screenshot({ path: join(home, 'game.png') })
  await panel.getByRole('dialog', { name: '第八位嘉宾', exact: true }).getByRole('button', { name: /返回工作台/ }).click()
  await panel.getByRole('button', { name: '工作台首页', exact: true }).click()
  await panel.getByRole('complementary', { name: '选择花学旅伴', exact: true }).waitFor()
  console.log(JSON.stringify({ status: 'market-business-game-and-owned-native-session-pass', home, workspacePath, pageErrors }))
  assert.deepEqual(pageErrors, [])
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(home, 'failure.png') }).catch(() => {})
    console.error('UI at failure:', (await page.locator('body').innerText().catch(() => '')).slice(0, 2000))
  }
  console.error('Test artifacts:', home)
  throw error
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const stopped = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await stopped
    clearTimeout(timer)
  }
}
