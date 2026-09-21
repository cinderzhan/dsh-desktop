import Schema from '@deepseek-ai/schemastery'
import { CatalogError, createCatalogReader } from './catalog.mjs'
import { readSubmissionStatus, SubmissionStatusError } from './submission-status.mjs'
import { createStateStore, MAX_STATE_BYTES, StateError } from './state.mjs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-desktop-workbenches'
export const inject = ['connection']
export const Config = Schema.object({ root: Schema.string().required() })

async function readPayload(request, maximum = MAX_STATE_BYTES, tooLarge = 'Workbench state is too large.') {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximum) throw new StateError(tooLarge, 413)
  const reader = request.body?.getReader()
  if (!reader) throw new StateError('A JSON body is required.')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > maximum) {
        await reader.cancel()
        throw new StateError(tooLarge, 413)
      }
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new StateError('Invalid JSON body.') }
  } finally { reader.releaseLock() }
}

export function apply(ctx, config) {
  const store = createStateStore(config.root)
  const readCatalog = createCatalogReader()
  // Providers must use the same persisted ownership as Desktop, never a second
  // settings namespace that could accidentally authorize an ordinary session.
  ctx.effect(() => ctx.reflect.provide('desktopWorkbenchOwnership', {
    async read() {
      const { revision, state } = await store.read()
      return { revision, sessionBindings: { ...state.sessionBindings }, added: [...state.added] }
    }
  }))
  const guideRoute = path => ({
    path,
    methods: ['GET'],
    async fetch() {
      try {
        const guide = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'development-guide.zh.md'), 'utf8')
        return new Response(guide, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' } })
      } catch {
        return Response.json({ error: 'Could not read the workbench development guide.' }, { status: 500, headers: { 'cache-control': 'no-store' } })
      }
    }
  })
  ctx.connection.fetch.register(guideRoute('/api/desktop-workbenches/development-guide'))
  ctx.connection.fetch.register(guideRoute('/api/desktop-workbenches/author-guide'))
  ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/catalog',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const result = await readCatalog()
        return Response.json(result, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof CatalogError ? error.message : 'Could not read the workbench catalog.' }, {
          status: error instanceof CatalogError ? error.status : 500,
          headers: { 'cache-control': 'no-store' }
        })
      }
    }
  })
  ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/state',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return Response.json(await store.read(), { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof StateError ? error.message : 'Could not access workbench state.' }, {
          status: error instanceof StateError ? error.status : 500,
          headers: { 'cache-control': 'no-store' }
        })
      }
    }
  })
  ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/state/write',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        return Response.json(await store.write(await readPayload(request)), { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof StateError ? error.message : 'Could not access workbench state.' }, {
          status: error instanceof StateError ? error.status : 500,
          headers: { 'cache-control': 'no-store' }
        })
      }
    }
  })
  ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/submission-status',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const status = await readSubmissionStatus(new URL(request.url).searchParams.get('url'))
        return Response.json(status, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof SubmissionStatusError ? error.message : 'Could not read the pull request.' }, {
          status: error instanceof SubmissionStatusError ? error.status : 500, headers: { 'cache-control': 'no-store' }
        })
      }
    }
  })
}
