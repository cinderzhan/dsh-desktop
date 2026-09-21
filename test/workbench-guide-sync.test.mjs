// The plugin serves the development guide from its own package directory, so the
// guide cannot read docs/ at runtime and is committed as a copy of two documents.
// Hand-maintaining that copy is how it drifted from its sources before: a change
// to the switch description had to be made twice and was missed once. These tests
// make that drift fail loudly instead.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('does not describe local storage as an official submission', () => {
    const guide = read(GUIDE_SOURCE)
    expect(guide).toContain('旧本机 `pending` 仅为本地草稿')
    expect(guide).not.toContain('POST 到 $DSH_WEB_URL/api/desktop-workbenches/submissions')
  })
})
