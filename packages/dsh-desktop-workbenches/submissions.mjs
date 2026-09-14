import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { StateError } from './state.mjs'

export const MAX_SUBMISSION_BYTES = 3 * 1024 * 1024
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
const MAX_STORED_BYTES = 32 * 1024 * 1024
const LIMITS = { title: 100, description: 2000, author: 80 }
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = message => { throw new StateError(message) }

function textField(payload, name) {
  const value = payload[name]
  if (typeof value !== 'string') fail(`${name} is required.`)
  const normalized = value.trim()
  if (!normalized) fail(`${name} is required.`)
  if (normalized.length > LIMITS[name]) fail(`${name} is too long.`)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(normalized)) fail(`${name} contains invalid characters.`)
  return normalized
}

export function normalizeGitHubRepository(value) {
  if (typeof value !== 'string' || value.length > 500) fail('A GitHub HTTPS repository URL is required.')
  let url
  try { url = new URL(value.trim()) } catch { fail('A valid GitHub HTTPS repository URL is required.') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password
    || url.search || url.hash) fail('Repository must be a GitHub HTTPS URL.')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) fail('Repository must identify one GitHub repository.')
  let [owner, repository] = parts
  repository = repository.replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
    || !/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === '.' || repository === '..') {
    fail('Repository contains an invalid GitHub owner or repository name.')
  }
  return `https://github.com/${owner}/${repository}`
}

function validSignature(type, bytes) {
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (type === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}

export function validateScreenshot(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') fail('Screenshot must be a PNG, JPEG, or WebP data URL.')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) fail('Screenshot must be a PNG, JPEG, or WebP data URL.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES) throw new StateError('Screenshot is too large.', 413)
  if (bytes.toString('base64') !== match[2] || !validSignature(match[1], bytes)) fail('Screenshot content does not match its image type.')
  return value
}

export function validateSubmission(value) {
  if (!isObject(value)) fail('A JSON submission is required.')
  const allowed = new Set(['title', 'description', 'author', 'repository', 'screenshot'])
  if (Object.keys(value).some(key => !allowed.has(key))) fail('Unknown submission field.')
  return {
    title: textField(value, 'title'),
    description: textField(value, 'description'),
    author: textField(value, 'author'),
    repository: normalizeGitHubRepository(value.repository),
    screenshot: validateScreenshot(value.screenshot)
  }
}

function validateStored(value) {
  if (!isObject(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'submissions'].includes(key))
    || !Array.isArray(value.submissions)) throw new Error('Invalid submissions')
  for (const entry of value.submissions) {
    if (!isObject(entry) || Object.keys(entry).some(key => !['id', 'title', 'description', 'author', 'repository', 'screenshot', 'status', 'createdAt'].includes(key))
      || typeof entry.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)
      || typeof entry.createdAt !== 'string' || Number.isNaN(Date.parse(entry.createdAt))
      || new Date(entry.createdAt).toISOString() !== entry.createdAt || entry.status !== 'pending') throw new Error('Invalid submission')
    const checked = validateSubmission({
      title: entry.title,
      description: entry.description,
      author: entry.author,
      repository: entry.repository,
      screenshot: entry.screenshot
    })
    if (checked.title !== entry.title || checked.description !== entry.description || checked.author !== entry.author
      || checked.repository !== entry.repository || checked.screenshot !== entry.screenshot) throw new Error('Invalid submission')
  }
  if (new Set(value.submissions.map(entry => entry.repository.toLowerCase())).size !== value.submissions.length) throw new Error('Duplicate submissions')
  return structuredClone(value)
}

export function createSubmissionStore(root) {
  const path = join(root, 'submissions.json')
  let pending = Promise.resolve()
  const queue = operation => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }
  async function readFileState() {
    try {
      const raw = await readFile(path)
      if (raw.length > MAX_STORED_BYTES) throw new Error('Stored submissions exceed size limit')
      return validateStored(JSON.parse(raw.toString('utf8')))
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, submissions: [] }
      if (error instanceof StateError) throw error
      throw new StateError('Stored workbench submissions are invalid. Restore or repair submissions.json.', 500)
    }
  }
  return {
    read: () => queue(async () => (await readFileState()).submissions),
    create: input => {
      const submission = validateSubmission(structuredClone(input))
      return queue(async () => {
        const current = await readFileState()
        if (current.submissions.some(item => item.repository.toLowerCase() === submission.repository.toLowerCase())) {
          throw new StateError('This GitHub repository has already been submitted.', 409)
        }
        const saved = { id: randomUUID(), ...submission, status: 'pending', createdAt: new Date().toISOString() }
        const next = { version: 1, submissions: [...current.submissions, saved] }
        const encoded = JSON.stringify(next)
        if (Buffer.byteLength(encoded) > MAX_STORED_BYTES) throw new StateError('Workbench submission storage is full.', 507)
        await mkdir(root, { recursive: true })
        const temporary = join(root, `.submissions-${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 })
          await rename(temporary, path)
        } finally { await rm(temporary, { force: true }) }
        return structuredClone(saved)
      })
    }
  }
}
