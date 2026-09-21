import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { checkWorkbenchPackage } from '../scripts/check-workbench-package.mjs'
import { parsePatchFile } from 'patch-package/dist/patch/parse.js'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('vendor/workbenches/catalog.json', root)))
describe('bundled first-party workbench packages', () => {
  it('ships a parseable Harness dependency-closure patch with valid hunk lengths', async () => {
    const patch = await readFile(new URL('patches/@deepseek-ai+dsh+0.1.5-rc.2.patch', root), 'utf8')
    expect(() => parsePatchFile(patch)).not.toThrow()
  })
  for (const entry of catalog.workbenches) {
    const { package: name, id } = entry
    it(`${name} installs a compatible, complete artifact matching the catalog checksum`, async () => {
      const result = await checkWorkbenchPackage(fileURLToPath(new URL(`node_modules/${name}`, root)))
      expect(result).toEqual({ package: name, id, version: entry.version })
      expect(entry.id).toBe(id)
      const bytes = await readFile(new URL(`vendor/workbenches/${entry.artifact}`, root))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      const pkg = JSON.parse(await readFile(new URL('package.json', root)))
      expect(pkg.dependencies[name]).toBe(`file:vendor/workbenches/${entry.artifact}`)
      const patch = await readFile(new URL('build/dsh-desktop.patch.yml', root), 'utf8')
      expect(patch).toContain(`name: ${name}`)
      const closure = await readFile(new URL('patches/@deepseek-ai+dsh+0.1.5-rc.2.patch', root), 'utf8')
      expect(closure).toContain(`"${name}": "${entry.version}"`)
      expect(entry.source.commit).toMatch(/^[a-f0-9]{40}$/)
    })
  }
})
