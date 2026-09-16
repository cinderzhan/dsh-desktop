// Regenerates the workbench development guide that ships inside the workbench
// plugin, by concatenating the two documents it is a copy of.
//
// The plugin serves the guide from its own package directory, so it cannot read
// docs/ at runtime and the bundle has to be committed. Keeping the copy in sync
// by hand is how the bundled copy and its sources drifted apart before, so the
// bundle is generated instead, and `--check` fails when it is out of date.
//
//   node scripts/build-workbench-guide.mjs           rewrite the bundle
//   node scripts/build-workbench-guide.mjs --check    fail if the bundle drifted

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const GUIDE_TARGET = 'packages/dsh-desktop-workbenches/development-guide.zh.md'
export const GUIDE_SOURCES = {
  standard: 'docs/workbench-standard.zh.md',
  implementation: 'docs/workbenches.md'
}

const GUIDE_HEADER = `# DSH Desktop 工作台开发指南

本文随 DSH Desktop 分发，也发布在独立的工作台市场栏目，供任意 Agent 直接读取。

`

const GUIDE_BETWEEN = `

---

# 实现与交付说明

`

const withTrailingNewline = text => (text.endsWith('\n') ? text : `${text}\n`)

export function renderGuide({ standard, implementation }) {
  return `${GUIDE_HEADER}${withTrailingNewline(standard)}${GUIDE_BETWEEN}${withTrailingNewline(implementation)}`
}

export function readGuideSources(readFile = path => readFileSync(join(root, path), 'utf8')) {
  return { standard: readFile(GUIDE_SOURCES.standard), implementation: readFile(GUIDE_SOURCES.implementation) }
}

export function renderGuideFromSources(readFile) {
  return renderGuide(readGuideSources(readFile))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = renderGuideFromSources()
  const target = join(root, GUIDE_TARGET)
  const current = readFileSync(target, 'utf8')
  if (process.argv.includes('--check')) {
    if (rendered !== current) {
      console.error(`${GUIDE_TARGET} is out of date. Run: node scripts/build-workbench-guide.mjs`)
      process.exit(1)
    }
    console.log(`${GUIDE_TARGET} matches its sources.`)
  } else if (rendered === current) {
    console.log(`${GUIDE_TARGET} is already up to date.`)
  } else {
    writeFileSync(target, rendered)
    console.log(`wrote ${GUIDE_TARGET}`)
  }
}
