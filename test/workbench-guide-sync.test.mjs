// The plugin serves the development guide from its own package directory, so the
// guide cannot read docs/ at runtime and is committed as a copy of two documents.
// Hand-maintaining that copy is how it drifted from its sources before: a change
// to the switch description had to be made twice and was missed once. These tests
// make that drift fail loudly instead.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../packages/dsh-desktop-workbenches/index.js'
import { GUIDE_SOURCE, GUIDE_TARGET, renderGuideFromSource } from '../scripts/build-workbench-guide.mjs'

const root = join(import.meta.dirname, '..')
const read = path => readFileSync(join(root, path), 'utf8')

describe('bundled workbench development guide', () => {
  it('equals the single author guide shipped to Agents', () => {
    expect(read(GUIDE_TARGET)).toBe(renderGuideFromSource(read))
  })

  it('contains development, local acceptance and publication in one document', () => {
    const guide = read(GUIDE_TARGET)
    expect(guide).toBe(read(GUIDE_SOURCE))
    expect(guide).toContain('## 3. 工作台的基本规则')
    expect(guide).toContain('## 5. 本地安装与验收')
    expect(guide).toContain('## 7. 首次市场收录 PR')
    expect(guide).toContain('## 8. 后续版本更新')
    // The guide is self-contained: it must not depend on a path only this
    // repository has, because readers see it outside the checkout.
    expect(guide).not.toContain('../../docs/')
  })

  it('sends submissions through an awesome-dsh-workbench PR and keeps no local submission state', () => {
    const guide = read(GUIDE_SOURCE)
    expect(guide).toContain('data/workbenches/<owner>__<repo>.yml')
    expect(guide).toContain('本机不保存投稿状态')
    expect(guide).not.toContain('submissions.json')
    expect(guide).not.toContain('/api/desktop-workbenches/submissions')
    expect(guide).not.toContain('screenshots.json')
  })

  it('is served by the local host under both guide paths and exposes no submission API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-guide-'))
    try {
      const routes = []
      apply({ effect: fn => fn(), reflect: { provide() {} }, connection: { fetch: { register(route) { routes.push(route) } } } }, { root })
      for (const path of ['/api/desktop-workbenches/development-guide', '/api/desktop-workbenches/author-guide']) {
        const response = await routes.find(value => value.path === path).fetch(new Request(`http://localhost${path}`))
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(read(GUIDE_TARGET))
      }
      expect(routes.some(value => value.path === '/api/desktop-workbenches/submissions')).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
