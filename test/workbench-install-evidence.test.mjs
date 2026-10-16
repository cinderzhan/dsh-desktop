import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, cp, readdir, readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstallEvidence } from '../packages/dsh-desktop-workbenches/install-evidence.mjs'
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(spec = 'file:/development/local') {
  const home = await mkdtemp(join(tmpdir(), 'dsh-install-evidence-')); roots.push(home)
  const profile = join(home, 'profiles', 'web'), directory = join(profile, 'node_modules', 'workbench')
  await mkdir(directory, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { workbench: spec } }))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'workbench', version: '1.0.0', description: 'Actual local description', author: { name: 'Local Author' }, dsh: { client: { entry: './client.js' } } }))
  await writeFile(join(directory, 'client.js'), 'local code')
  return { home, directory }
}
describe('actual workbench installation evidence', () => {
  it('does not infer market origin from a stale same-version install record', async () => {
    const { home } = await fixture()
    const result = await readInstallEvidence({ 'o/workbench': { pluginName: 'workbench', version: '1.0.0', source: 'npm' } }, home)
    expect(result.workbench).toMatchObject({ origin: 'local', version: '1.0.0', metadata: { author: 'Local Author', description: 'Actual local description' } })
  })
  it('recognizes historical market archive receipts without treating their content as verified', async () => {
    const { home } = await fixture('file:/tmp/market-release/package.tgz')
    const result = await readInstallEvidence({ 'o/workbench': { pluginName: 'workbench', source: 'release', version: '1.0.0' } }, home)
    expect(result.workbench).toMatchObject({ origin: 'market', contentVerified: false })
  })

  it('verifies market content and detects same-version code replacement', async () => {
    const { home, directory } = await fixture('1.0.0')
    const initial = (await readInstallEvidence({}, home, ['workbench'])).workbench
    expect(initial.origin).toBe('unknown')
    const records = { 'o/workbench': { pluginName: 'workbench', version: '1.0.0', fingerprint: initial.fingerprint } }
    expect((await readInstallEvidence(records, home)).workbench.origin).toBe('market')
    await writeFile(join(directory, 'client.js'), 'different code, unchanged version')
    const next = (await readInstallEvidence(records, home)).workbench
    expect(next).toMatchObject({ origin: 'market', contentVerified: false })
    expect(next.fingerprint).not.toBe(initial.fingerprint)
  })
  it.each(['1.0.0', 'github:owner/workbench#commit', 'file:/tmp/release.tgz'])('recognizes historical market installs from %s', async spec => {
    const { home } = await fixture(spec)
    const records = { market: { pluginName: 'workbench', version: '1.0.0', source: spec.startsWith('file:') ? 'github-release' : 'npm' } }
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'market', contentVerified: false })
    expect((await readInstallEvidence({ market: { ...records.market, version: '0.9.0' } }, home)).workbench.origin).not.toBe('market')
  })

  it('keeps explicit local directory and link sources local even with a matching fingerprint', async () => {
    for (const spec of ['file:/development/local', 'link:/development/local', '/development/local']) {
      const { home } = await fixture(spec)
      const initial = (await readInstallEvidence({}, home, ['workbench'])).workbench
      expect((await readInstallEvidence({ market: { pluginName: 'workbench', version: '1.0.0', fingerprint: initial.fingerprint } }, home)).workbench).toMatchObject({ origin: 'local', contentVerified: false })
    }
  })

  it('recognizes local archives without a market receipt', async () => {
    const { home } = await fixture('file:/development/workbench.tgz')
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.origin).toBe('local')
  })

  it.each(['npm', 'github-source', undefined])('keeps local archives local with unrelated historical %s receipts', async source => {
    const { home } = await fixture('file:/development/workbench.tgz')
    const records = { market: { pluginName: 'workbench', version: '1.0.0', source } }
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'local', contentVerified: false })
  })

  it('keeps a locally replaced archive local when its market fingerprint mismatches', async () => {
    const { home, directory } = await fixture('file:/development/workbench.tgz')
    const initial = (await readInstallEvidence({}, home, ['workbench'])).workbench
    const records = { market: { pluginName: 'workbench', version: '1.0.0', source: 'github-release', fingerprint: initial.fingerprint } }
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'market', contentVerified: true })
    await writeFile(join(directory, 'client.js'), 'locally installed replacement archive code')
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'local', contentVerified: false })
  })

  it('keeps v2 content verification across path and source-spec changes', async () => {
    const { home, directory } = await fixture('1.0.0')
    const initial = (await readInstallEvidence({}, home, ['workbench'])).workbench
    const moved = await fixture('github:owner/workbench#commit')
    await cp(directory, moved.directory, { recursive: true })
    const records = { market: { pluginName: 'workbench', version: '1.0.0', fingerprint: initial.fingerprint } }
    expect(initial.fingerprint).toMatch(/^v2:[a-f0-9]{64}$/)
    expect((await readInstallEvidence(records, moved.home)).workbench).toMatchObject({ origin: 'market', contentVerified: true, fingerprint: initial.fingerprint })
  })

  it('still verifies legacy path-bound fingerprints', async () => {
    const { home, directory } = await fixture('1.0.0')
    const physical = await realpath(directory)
    const hash = createHash('sha256').update(physical).update('\0').update('1.0.0').update('\0')
    for (const name of (await readdir(physical)).sort((a, b) => a.localeCompare(b))) hash.update(name).update('\0').update(await readFile(join(physical, name))).update('\0')
    const records = { market: { pluginName: 'workbench', version: '1.0.0', fingerprint: hash.digest('hex') } }
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'market', contentVerified: true })
  })

  it('reads release generations without sourceSpec and skips unreadable sibling generations', async () => {
    const { home, directory: original } = await fixture('file:/obsolete/local')
    const root = join(home, 'profiles', '.generations'), id = 'workbench+1.0.0+release'
    const directory = join(root, 'live', id, 'node_modules', 'workbench')
    await mkdir(directory, { recursive: true })
    await cp(original, directory, { recursive: true })
    await writeFile(join(root, 'desired.json'), JSON.stringify(['broken', id]))
    await writeFile(join(root, 'live', id, 'generation.json'), JSON.stringify({ pluginName: 'workbench', version: '1.0.0' }))
    const records = { market: { pluginName: 'workbench', version: '1.0.0', source: 'release' } }
    expect((await readInstallEvidence(records, home)).workbench).toMatchObject({ origin: 'market', contentVerified: false })
  })

  it('reads real generation IDs, source specs, and local metadata translations', async () => {
    const { home } = await fixture('1.0.0')
    const root = join(home, 'profiles', '.generations'), id = 'workbench+1.0.0+abc123'
    const directory = join(root, 'live', id, 'node_modules', 'workbench')
    await mkdir(join(directory, 'locale'), { recursive: true })
    await writeFile(join(root, 'desired.json'), JSON.stringify([id]))
    await writeFile(join(root, 'live', id, 'generation.json'), JSON.stringify({ pluginName: 'workbench', version: '1.0.0', sourceSpec: 'file:/development/workbench' }))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'workbench', version: '1.0.0', dsh: { client: { entry: './client.js' } } }))
    await writeFile(join(directory, 'locale', 'zh.json'), JSON.stringify({ meta: { title: '本机名称', description: '本机说明' } }))
    await writeFile(join(directory, 'locale', 'en.json'), JSON.stringify({ meta: { title: 'Actual name', description: 'Actual description' } }))
    const result = (await readInstallEvidence({}, home, ['workbench'])).workbench
    expect(result).toMatchObject({ origin: 'local', metadata: { title: '本机名称', titleEn: 'Actual name', description: '本机说明', descriptionEn: 'Actual description' } })
  })

  it('keeps declared or present unreadable packages unknown while absent packages stay absent', async () => {
    const { home, directory } = await fixture()
    await writeFile(join(directory, 'package.json'), '{invalid')
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.origin).toBe('unknown')
    await rm(directory, { recursive: true })
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.origin).toBe('unknown')
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dependencies: {} }))
    expect(await readInstallEvidence({}, home, ['workbench'])).toEqual({})
  })

  it('does not follow plugin-owned symlinks as verified content', async () => {
    const { home, directory } = await fixture()
    const { symlink } = await import('node:fs/promises')
    await symlink('/tmp', join(directory, 'external'))
    expect((await readInstallEvidence({}, home, ['workbench'])).workbench.fingerprint).toBeUndefined()
  })
})
