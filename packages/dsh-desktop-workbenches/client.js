window.__ModuleLoader__.load({
  id: 'dsh-desktop-workbenches',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL = 'desktop-workbenches'
    const API = '/api/desktop-workbenches/state'
    const WRITE_API = '/api/desktop-workbenches/state/write'
    const CATALOG_API = '/api/desktop-workbenches/catalog'
    const WORKBENCH_PREF = 'dsh-workbench-enabled'
    const workbenchPreference = {
      listeners: new Set(),
      enabled: (() => { try { return window.localStorage.getItem(WORKBENCH_PREF) !== 'false' } catch { return true } })(),
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) },
      getSnapshot() { return this.enabled },
      set(value) { this.enabled = !!value; try { window.localStorage.setItem(WORKBENCH_PREF, String(this.enabled)) } catch {} ; for (const listener of this.listeners) listener() }
    }
    const EMPTY = () => ({ version: 1, added: [], pinned: [], favorites: [], active: null, sessionBindings: {}, recentSessions: {}, notes: {} })
    // Hide retired built-ins only in navigation; never migrate or erase saved data.
    const visibleWorkbench = (id) => id !== 'research-notebook' && id !== 'writing-notebook'

    // This controller owns navigation and local state only. It never terminates
    // agents, changes a running session's preset, or registers global tools.
    class Workbenches {
      constructor(ctx, request = (...args) => fetch(...args)) {
        this.ctx = ctx
        this.request = request
        this.state = EMPTY()
        this.revision = 0
        this.ready = false
        this.error = ''
        this.blocked = false
        this.marketOpen = false
        this.pending = 0
        this.disposed = false
        this.listeners = new Set()
        this.catalog = new Map()
        this.remoteCatalog = []
        this.catalogError = ''
        this.catalogStale = false
        this.draftNotes = new Map()
        this.noteTimers = new Map()
        this.queue = Promise.resolve()
        this.sessionRequests = new Map()
        this.navigation = 0
        this.suppressSelection = false
        this.lastSession = undefined
        this.publish()
      }
      getSnapshot = () => this.snapshot
      subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
      marketCatalog() {
        const matched = new Set()
        const providers = [...this.catalog.values()]
        const remote = this.remoteCatalog.map((item) => {
          const provider = providers.find(candidate => typeof candidate.repository === 'string'
            && candidate.repository.replace(/\/$/, '').toLowerCase() === item.url.toLowerCase())
          if (provider) matched.add(provider.id)
          return {
            ...item,
            ...(provider || {}),
            id: provider?.id || item.id,
            catalogId: item.id,
            title: item.name,
            category: item.categoryName,
            description: item.description.zh,
            author: item.owner,
            repository: item.url,
            screenshots: item.screenshots.map(image => image.url),
            installed: !!provider
          }
        })
        for (const provider of providers) {
          if (!matched.has(provider.id)) remote.push({ ...provider, catalogId: provider.id, installed: true })
        }
        return remote
      }
      publish() {
        this.snapshot = { state: this.state, drafts: Object.fromEntries(this.draftNotes), ready: this.ready, error: this.error,
          catalogError: this.catalogError, catalogStale: this.catalogStale, pending: this.pending, marketOpen: this.marketOpen, catalog: this.marketCatalog() }
        for (const listener of this.listeners) listener()
      }
      report(error) { if (!this.disposed) { this.error = error instanceof Error ? error.message : String(error); this.publish() } }
      run(promise) { void promise.catch((error) => this.report(error)) }
      async read() {
        const response = await this.request(API, { credentials: 'same-origin', cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        return data
      }
      async readCatalog() {
        const response = await this.request(CATALOG_API, { credentials: 'same-origin', cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        const categories = new Map(data.catalog.categories.map(category => [category.id, category.name.zh]))
        return {
          entries: data.catalog.workbenches.map(entry => ({ ...entry, categoryName: categories.get(entry.category) || entry.category })),
          stale: data.stale === true
        }
      }
      async load() {
        await this.queue
        const ticket = ++this.navigation
        this.ready = false
        this.error = ''
        this.publish()
        try {
          const [data, catalog] = await Promise.all([this.read(), this.readCatalog().catch(error => ({ error }))])
          await this.ctx.sessions.refresh()
          if (this.disposed || ticket !== this.navigation) return
          this.state = data.state
          this.revision = data.revision
          if (catalog.error) this.catalogError = catalog.error instanceof Error ? catalog.error.message : String(catalog.error)
          else {
            this.remoteCatalog = catalog.entries
            this.catalogError = ''
            this.catalogStale = catalog.stale
          }
          this.blocked = false
          this.ready = true
          this.lastSession = this.ctx.sessions.list.getSnapshot().current
          this.publish()
          const active = this.state.active
          if (active && this.catalog.has(active) && this.state.added.includes(active)) await this.open(active)
          else this.selectionChanged()
          for (const id of this.draftNotes.keys()) this.run(this.saveNote(id))
        } catch (error) { this.report(error) }
      }
      commit(change) {
        if (!this.ready || this.blocked || this.disposed) return Promise.reject(new Error('工作台更改尚未保存，请先重新加载。'))
        const next = JSON.parse(JSON.stringify(this.state))
        try { change(next) } catch (error) { return Promise.reject(error) }
        this.state = next
        this.pending++
        this.publish()
        const task = this.queue.then(async () => {
          if (this.blocked) throw new Error('工作台更改尚未保存，请先重新加载。')
          const response = await this.request(WRITE_API, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: this.revision, state: next })
          })
          const data = await response.json()
          if (!response.ok) throw new Error(response.status === 409 ? '工作台已在其他窗口更新，请重新加载后再操作。' : data.error || `HTTP ${response.status}`)
          this.revision = data.revision
        }).catch((error) => { this.blocked = true; this.report(error); throw error })
          .finally(() => { this.pending--; this.publish() })
        this.queue = task.catch(() => {})
        return task
      }
      register(descriptor, Component) {
        if (!descriptor || !/^[a-z][a-z0-9-]{0,79}$/.test(descriptor.id) || !descriptor.title || typeof Component !== 'function') throw new Error('Invalid workbench registration')
        if (this.catalog.has(descriptor.id)) throw new Error(`Duplicate workbench: ${descriptor.id}`)
        if (descriptor.customFrame !== undefined && typeof descriptor.customFrame !== 'boolean') throw new Error('Invalid custom frame flag')
        const layout = descriptor.layout || {}
        if (layout.businessSide !== undefined && !['left', 'right'].includes(layout.businessSide)) throw new Error('Invalid workbench business side')
        if (layout.businessWidth !== undefined && (!Number.isFinite(layout.businessWidth) || layout.businessWidth < 0.25 || layout.businessWidth > 0.7)) throw new Error('Workbench business width must be between 0.25 and 0.7')
        const entry = { ...descriptor,
          category: descriptor.category || '其他',
          screenshot: descriptor.screenshot || '',
          screenshotPosition: descriptor.screenshotPosition || 'center',
          layout: { businessSide: layout.businessSide || 'right', businessWidth: layout.businessWidth ?? 0.36 }, Component }
        this.catalog.set(entry.id, entry)
        this.publish()
        return () => {
          if (this.catalog.get(entry.id) !== entry) return
          this.catalog.delete(entry.id)
          // Unloading the provider cannot erase its sessions or user's notes.
          if (this.state.active === entry.id) this.state = { ...this.state, active: null }
          this.publish()
        }
      }
      add(id) {
        if (!this.catalog.has(id)) return Promise.reject(new Error('工作台当前不可用。'))
        return this.commit((state) => {
          if (!state.added.includes(id)) state.added.push(id)
          if (!state.pinned.includes(id)) state.pinned.push(id)
        })
      }
      async open(id, sessionId) {
        if (!this.catalog.has(id) || !this.state.added.includes(id)) throw new Error('请先添加可用的工作台。')
        if (sessionId && this.state.sessionBindings[sessionId] !== id) throw new Error('会话不属于当前工作台。')
        this.marketOpen = false
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        const defaultWorkspace = this.defaultWorkspace()
        await this.commit((state) => { state.active = id; if (!state.pinned.includes(id)) state.pinned.push(id) })
        if (this.disposed || signal.aborted || ticket !== this.navigation) return
        const target = sessionId || this.state.recentSessions[id]
        const listed = this.ctx.sessions.list.getSnapshot().byId
        this.suppressSelection = true
        try {
          if (target && listed[target] && this.state.sessionBindings[target] === id) this.ctx.sessions.open(target)
          else this.ctx.sessions.clear()
          this.lastSession = this.ctx.sessions.list.getSnapshot().current
          this.ctx.layout.selectPanel(null)
        } finally { this.suppressSelection = false }
        if (target && listed[target]) await this.commit((state) => { state.recentSessions[id] = target })
        else if (this.catalog.get(id)?.initialization === 'new-session' && defaultWorkspace) await this.newSession(defaultWorkspace.workspaceId)
      }
      async home(id = this.state.active) {
        if (!id || !this.catalog.has(id) || !this.state.added.includes(id)) throw new Error('请先添加可用的工作台。')
        this.marketOpen = false
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        await this.commit((state) => { state.active = id; if (!state.pinned.includes(id)) state.pinned.push(id) })
        if (this.disposed || signal.aborted || ticket !== this.navigation) return
        this.suppressSelection = true
        try {
          this.ctx.sessions.clear()
          this.lastSession = null
          this.ctx.layout.selectPanel(null)
        } finally { this.suppressSelection = false }
      }
      showMarket() {
        this.marketOpen = true
        this.publish()
        this.ctx.layout.selectPanel(PANEL)
      }
      toggle(id) {
        return this.state.active === id ? this.leave() : this.open(id)
      }
      async leave() {
        const signal = this.ctx.layout.beginNavigation()
        const ticket = ++this.navigation
        await this.commit((state) => { state.active = null })
        if (!this.disposed && !signal.aborted && ticket === this.navigation) this.ctx.layout.selectPanel(null)
      }
      remove(id) {
        this.ctx.layout.beginNavigation()
        ++this.navigation
        return this.commit((state) => {
          state.added = state.added.filter((item) => item !== id)
          state.pinned = state.pinned.filter((item) => item !== id)
          if (state.active === id) state.active = null
        })
      }
      toggleFavorite(id) {
        if (!this.marketCatalog().some(entry => entry.catalogId === id) && !(this.state.favorites || []).includes(id)) return Promise.reject(new Error('工作台当前不可用。'))
        return this.commit((state) => {
          const favorites = Array.isArray(state.favorites) ? state.favorites : []
          state.favorites = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]
        })
      }
      reorder(id, before) {
        return this.commit((state) => {
          if (id === before || !state.pinned.includes(id) || !state.pinned.includes(before)) return
          const order = state.pinned.filter((item) => item !== id)
          order.splice(order.indexOf(before), 0, id)
          state.pinned = order
        })
      }
      setNote(id, value) { return this.commit((state) => { state.notes[id] = value }) }
      editNote(id, value) {
        this.draftNotes.set(id, value)
        clearTimeout(this.noteTimers.get(id))
        this.noteTimers.set(id, setTimeout(() => { this.noteTimers.delete(id); this.run(this.saveNote(id)) }, 450))
        this.publish()
      }
      async saveNote(id) {
        if (!this.draftNotes.has(id)) return
        const value = this.draftNotes.get(id)
        await this.setNote(id, value)
        if (this.draftNotes.get(id) === value) this.draftNotes.delete(id)
        this.publish()
      }
      workspaceFor(sessionId) {
        return this.ctx.workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(sessionId))
      }
      defaultWorkspace() {
        const current = this.ctx.sessions.list.getSnapshot().current
        return this.workspaceFor(current) || this.ctx.workspaces.list.getSnapshot().items[0]
      }
      routeWorkspaceSession(sessionId) {
        const active = this.state.active
        const workspace = this.workspaceFor(sessionId)
        if (!this.ready || this.blocked || this.disposed || !active || !workspace || !this.state.added.includes(active) || !this.catalog.has(active)) return false
        this.run(this.openOrdinaryWorkspaceSession(workspace.workspaceId, active))
        return true
      }
      async openOrdinaryWorkspaceSession(workspaceId, active) {
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        const workspaces = this.ctx.workspaces.list.getSnapshot()
        const workspace = workspaces.items.find((item) => item.workspaceId === workspaceId)
        if (!workspace) throw new Error('工作区当前不可用。')
        const sessions = this.ctx.sessions.list.getSnapshot()
        const archived = new Set(workspaces.archivedSessionIds || [])
        let sessionId = sessions.ids.find((id) => {
          const summary = sessions.byId[id]
          return summary && summary.blank && workspace.sessionIds.includes(id) && !archived.has(id) && !this.state.sessionBindings[id]
        })
        if (!sessionId) sessionId = await this.ctx.sessions.create({ workspaceId })
        if (this.disposed || signal.aborted || ticket !== this.navigation || this.state.active !== active) return sessionId
        this.suppressSelection = true
        try {
          this.ctx.sessions.open(sessionId)
          this.lastSession = sessionId
          this.ctx.layout.selectPanel(null)
        } finally { this.suppressSelection = false }
        return sessionId
      }
      // Providers keep their own project/profile flows; Desktop owns session identity.
      ensureSession({ workbenchId, folder, sessionId: savedSessionId } = {}) {
        if (!this.ready || this.blocked || this.disposed || this.state.active !== workbenchId || !this.state.added.includes(workbenchId) || !this.catalog.has(workbenchId)) return Promise.reject(new Error('请先打开可用的工作台。'))
        const key = JSON.stringify([workbenchId, folder, savedSessionId || null])
        if (this.sessionRequests.has(key)) return this.sessionRequests.get(key)
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        const request = (async () => {
          await this.ctx.sessions.refresh()
          if (this.disposed || !this.state.added.includes(workbenchId) || !this.catalog.has(workbenchId)) throw new Error('工作台已移除或不可用。')
          let sessionId = savedSessionId && this.ctx.sessions.list.getSnapshot().byId[savedSessionId] ? savedSessionId : null
          if (sessionId) {
            const owner = this.state.sessionBindings[sessionId]
            if (owner && owner !== workbenchId) throw new Error('此会话已属于另一个工作台，不能重新绑定。')
          } else {
            if (typeof folder !== 'string' || !folder.trim()) throw new Error('创建会话需要业务项目文件夹。')
            const workspace = await this.ctx.workspaces.create({ path: folder })
            if (this.disposed || !this.state.added.includes(workbenchId) || !this.catalog.has(workbenchId)) throw new Error('工作台已移除或不可用。')
            sessionId = await this.ctx.sessions.create({ workspaceId: workspace.workspaceId })
          }
          if (this.disposed || !this.state.added.includes(workbenchId) || !this.catalog.has(workbenchId)) throw new Error('工作台已移除或不可用。')
          await this.commit((state) => {
            if (state.sessionBindings[sessionId] && state.sessionBindings[sessionId] !== workbenchId) throw new Error('不能改变已有会话的工作台归属。')
            state.sessionBindings[sessionId] = workbenchId
            state.recentSessions[workbenchId] = sessionId
          })
          if (!this.disposed && !signal.aborted && ticket === this.navigation && this.state.active === workbenchId) {
            this.suppressSelection = true
            try { this.ctx.sessions.open(sessionId); this.lastSession = sessionId; this.ctx.layout.selectPanel(null) }
            finally { this.suppressSelection = false }
          }
          return sessionId
        })().finally(() => { this.sessionRequests.delete(key) })
        this.sessionRequests.set(key, request)
        return request
      }
      newWorkspaceSession() {
        if (this.workspaceCreation) return this.workspaceCreation
        const id = this.state.active
        if (!id || !this.catalog.has(id)) return Promise.reject(new Error('请先打开工作台。'))
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        const current = () => !this.disposed && !signal.aborted && ticket === this.navigation && this.state.active === id && this.state.added.includes(id) && this.catalog.has(id)
        this.workspaceCreation = (async () => {
          const path = await this.ctx.uiWorkspace.pickDirectory()
          if (!path || !current()) return
          const workspace = await this.ctx.workspaces.create({ path })
          if (!current()) return
          return this.newSession(workspace.workspaceId)
        })().finally(() => { this.workspaceCreation = null })
        return this.workspaceCreation
      }
      async newSession(workspaceId) {
        const id = this.state.active
        if (!id || !this.catalog.has(id)) throw new Error('请先打开工作台。')
        const workspace = workspaceId || this.defaultWorkspace()?.workspaceId
        if (!workspace) return this.newWorkspaceSession()
        const ticket = ++this.navigation
        const signal = this.ctx.layout.beginNavigation()
        const sessionId = await this.ctx.sessions.create({ workspaceId: workspace })
        if (this.disposed || !this.state.added.includes(id) || !this.catalog.has(id)) return sessionId
        await this.commit((state) => {
          if (state.sessionBindings[sessionId] && state.sessionBindings[sessionId] !== id) throw new Error('不能改变已有会话的工作台归属。')
          state.sessionBindings[sessionId] = id
          state.recentSessions[id] = sessionId
        })
        if (this.disposed || signal.aborted || ticket !== this.navigation) return sessionId
        this.suppressSelection = true
        try { this.ctx.sessions.open(sessionId); this.lastSession = sessionId; this.ctx.layout.selectPanel(null) }
        finally { this.suppressSelection = false }
        return sessionId
      }
      selectionChanged() {
        if (!this.ready || this.suppressSelection || this.disposed) return
        const current = this.ctx.sessions.list.getSnapshot().current
        if (current === this.lastSession) return
        this.lastSession = current
        ++this.navigation
        const owner = current && this.state.sessionBindings[current]
        // Native workspace/session navigation invalidates pending workbench
        // navigation. Only a currently available owner may replace the active
        // business panel; ordinary sessions and sessions left behind by removed
        // providers stay native without changing the current workbench.
        const active = owner && this.state.added.includes(owner) && this.catalog.has(owner) ? owner : null
        if (!active) return
        this.run(this.commit((state) => {
          state.active = active
          state.recentSessions[active] = current
          if (!state.pinned.includes(active)) state.pinned.push(active)
        }))
      }
      dispose() {
        for (const timer of this.noteTimers.values()) clearTimeout(timer)
        for (const id of this.draftNotes.keys()) this.run(this.saveNote(id))
        this.disposed = true; ++this.navigation; this.listeners.clear()
      }
    }

    const css = `
      .dshWb{font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);box-sizing:border-box}
      .dshWb button,.dshWb input,.dshWb select,.dshWb textarea{font-family:inherit;font-size:13px;line-height:20px;color:inherit;box-sizing:border-box}
      .dshWb button{cursor:pointer;transition:none}.dshWb button:disabled{opacity:1;cursor:default;color:var(--dsw-alias-label-secondary)}
      .dshWb button:focus-visible,.dshWb input:focus-visible,.dshWb select:focus-visible,.dshWb textarea:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
      .dshWbBtn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:6px;padding:5px 10px;white-space:nowrap}
      .dshWb .dshWbBtn:not(.dshWbPrimary):not([role=tab]):hover:not(:disabled),.dshWb .dshWbBtn:not(.dshWbPrimary):not([role=tab]):active:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .dshWb .dshWbPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
      .dshWb .dshWbPrimary:hover:not(:disabled),.dshWb .dshWbPrimary:active:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill));color:var(--dsw-alias-label-primary-foreground)}
      .dshWb .dshWbPrimary:disabled{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
      .dshWbMuted{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.65}
      .dshWbActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .dshWbNav{display:flex;flex-direction:column;gap:3px;padding:4px 0;max-height:32vh;overflow:auto;width:100%;min-width:0}
      .dshWbSetting{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 2px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
      .dshWbSetting span{display:flex;flex-direction:column;gap:4px}.dshWbSetting strong{font-size:14px;font-weight:600}.dshWbSetting small{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
      .dshWbSetting input{width:18px;height:18px;flex:none;accent-color:var(--dsw-alias-label-primary);cursor:pointer}
      .dshWbNavHeader{display:flex;align-items:center;gap:4px;min-width:0;padding-bottom:2px}
      .dshWbNavModes{display:flex;gap:2px;flex-shrink:0}
      .dshWb .dshWbMode{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary)}
      .dshWb .dshWbMode[aria-pressed=true]{background:transparent;color:var(--dsw-alias-label-primary)}
      .dshWbNavItems{display:flex;flex-direction:column;gap:2px}
      .dshWbNavRow{display:flex;align-items:center;gap:2px;border-radius:7px;min-width:0}.dshWbNavRow[data-active=true]{background:var(--dsw-alias-bg-layer-2)}
      .dshWbNavOpen{border:0;background:none;display:flex;align-items:center;gap:9px;text-align:left;padding:5px 7px;flex:1;min-width:0;border-radius:7px}
      .dshWbNavMarket{font-weight:600;letter-spacing:-.01em}.dshWbNavMarket .dshWbNavIcon{background:transparent;color:var(--dsw-alias-label-primary)}
      .dshWbNavMarket[data-active=true]{background:var(--dsw-alias-bg-layer-2)}
      .dshWb .dshWbNavOpen:hover:not(:disabled),.dshWb .dshWbMove:hover:not(:disabled),.dshWb .dshWbMode:hover:not(:disabled),.dshWb .dshWbNavOpen:active:not(:disabled),.dshWb .dshWbMove:active:not(:disabled),.dshWb .dshWbMode:active:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .dshWbNavIcon{display:grid;place-items:center;width:26px;height:26px;flex-shrink:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary)}
      .dshWbNavRow[data-active=true] .dshWbNavIcon{color:var(--dsw-alias-label-primary)}
      .dshWbNavLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshWb .dshWbMove{display:grid;place-items:center;width:22px;height:22px;border:0;background:transparent;padding:0;border-radius:4px;color:var(--dsw-alias-label-secondary)}
      .dshWbNav[data-mode=icons] .dshWbNavItems{flex-direction:row;flex-wrap:wrap;gap:5px;padding:2px 4px}
      .dshWbNav[data-mode=icons] .dshWbNavRow{width:36px;height:36px}
      .dshWbNav[data-mode=icons] .dshWbNavRow .dshWbNavOpen{justify-content:center;padding:5px;width:36px;height:36px}
      .dshWbNav[data-wide=false] .dshWbNavOpen{justify-content:center}
      .dshWbMarket{container-type:inline-size;container-name:workbench-market;overflow:auto;height:100%;width:100%;min-width:0;padding:30px 32px 52px;max-width:1440px;margin:0 auto;scrollbar-color:var(--dsw-alias-border-l2) transparent;scrollbar-width:thin}
      .dshWbMarket::selection,.dshWbMarket *::selection{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground)}
      .dshWbMarketHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:28px}
      .dshWbMarketHeaderText{max-width:70ch}.dshWbMarket h1{font-size:28px;line-height:36px;letter-spacing:-.025em;font-weight:650;margin:0 0 7px;text-wrap:balance}.dshWbMarketHeader p{margin:0}
      .dshWbToolbar{display:flex;flex-direction:column;gap:14px;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dshWbTabs{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .dshWbTabs [role=tablist]{display:flex;gap:4px;min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none}.dshWbTabs [role=tablist]::-webkit-scrollbar{display:none}
      .dshWbTabs [role=tab]{border:0;border-radius:0;background:transparent;padding:7px 3px;margin-right:18px;color:var(--dsw-alias-label-secondary);position:relative}
      .dshWbTabs [aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:600}
      .dshWbTabs [aria-selected=true]::after{content:'';position:absolute;left:3px;right:3px;bottom:-15px;height:2px;border-radius:2px;background:var(--dsw-alias-label-primary)}
      .dshWbTabs [role=tab][aria-selected=false]:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
      .dshWbBrowseTools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .dshWbSearch{position:relative;min-width:220px;max-width:320px;flex:1}.dshWbSearch svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-secondary);pointer-events:none}
      .dshWbSearch input{display:block;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 11px 7px 34px;background:var(--dsw-alias-bg-layer-1)}
      .dshWbCategories{display:flex;align-items:center;gap:6px;overflow:auto;padding:2px;scrollbar-width:none}.dshWbCategories::-webkit-scrollbar{display:none}
      .dshWb .dshWbCategoryFilter{border:0;background:transparent;border-radius:999px;padding:5px 10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .dshWb .dshWbCategoryFilter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dshWb .dshWbCategoryFilter[aria-pressed=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground)}
      .dshWbGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
      .dshWbCard{min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);overflow:hidden;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s cubic-bezier(.2,.8,.2,1)}
      .dshWbCard:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.08)}
      .dshWbCardBody{display:flex;flex-direction:column;gap:10px;padding:16px 16px 15px;flex:1}.dshWbCardTitle{display:flex;align-items:center;gap:8px;min-width:0}
      .dshWbCard h2{overflow-wrap:anywhere;display:flex;align-items:center;gap:7px;min-width:0;font-size:17px;line-height:24px;letter-spacing:-.018em;font-weight:650;margin:0}.dshWbCard p{overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.dshWbCardDescription{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:40px}
      .dshWbCard .dshWbActions{margin-top:auto;gap:8px;padding-top:2px;align-items:center}.dshWbCard .dshWbActions>.dshWbBtn:first-child{margin-right:auto;border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}.dshWbCard .dshWbActions>.dshWbBtn:first-child:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dshWbCardIcon{display:grid;place-items:center;width:20px;height:20px;flex-shrink:0;color:var(--dsw-alias-label-secondary)}.dshWbCard .dshWbBtn{font-size:12px;line-height:18px;padding:6px 11px}
      .dshWbCategory{margin-left:auto;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;padding:0;white-space:nowrap}
      .dshWbMedia{position:relative;aspect-ratio:16/9;background:var(--dsw-alias-bg-module-platform);overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dshWbPreview{position:absolute;inset:0;display:grid;grid-template-rows:22px 1fr;background:var(--dsw-alias-bg-module-platform);overflow:hidden;color:var(--dsw-alias-label-secondary)}
      .dshWbPreviewBar{display:flex;align-items:center;gap:4px;padding:0 9px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}.dshWbPreviewDot{width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-border-l2)}
      .dshWbPreviewCanvas{display:grid;min-height:0}.dshWbPreviewPane{padding:13px;min-width:0;font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshWbPreviewPane+.dshWbPreviewPane{border-left:1px solid var(--dsw-alias-border-l2)}
      .dshWbPreviewPane i{height:4px;background:var(--dsw-alias-border-l2);display:block;border-radius:2px;margin-top:9px;width:78%}.dshWbPreviewPane i:last-child{width:48%}.dshWbPreviewPane em{display:block;width:28px;height:28px;border-radius:7px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);margin-bottom:12px}
      .dshWbCardScreenshot{display:block;width:100%;height:100%;object-fit:cover;background:var(--dsw-alias-bg-module-platform)}
      .dshWbFavorite{position:absolute;right:10px;top:10px;z-index:2;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);box-shadow:0 4px 14px rgba(0,0,0,.12);opacity:0;transform:translateY(-3px);transition:opacity .16s,transform .16s,color .16s}
      .dshWbCard:hover .dshWbFavorite,.dshWbFavorite:focus-visible,.dshWbFavorite[aria-pressed=true]{opacity:1;transform:none}.dshWbFavorite:hover,.dshWbFavorite[aria-pressed=true]{color:var(--dsw-alias-label-primary)}.dshWbFavorite[aria-pressed=true] svg{fill:currentColor}
      .dshWbMeta{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);font-variant-numeric:tabular-nums;min-width:0}
      .dshWbMetaItem{display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;min-width:0}.dshWbMetaItem svg{flex:0 0 auto}.dshWbMetaItem b{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}.dshWbMetaItem small{font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}.dshWbMetaItem:not(:first-child) small{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      .dshWbVersion{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}.dshWbPending{font-weight:600;color:var(--dsw-alias-label-primary)}
      .dshWbEmpty{grid-column:1/-1;display:flex;min-height:240px;align-items:center;justify-content:center;text-align:center;padding:32px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-module-platform)}.dshWbEmpty strong{display:block;font-size:15px;margin-bottom:5px}.dshWbEmpty p{margin:0}
      .dshWbDetail{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1)}
      .dshWbDetail h2{font-size:16px;line-height:24px;margin:0 auto 0 0}.dshWbDetail p{font-size:13px;line-height:21px;margin:10px 0 0}
      .dshWbDetailHeroButton{display:block;width:100%;padding:0;border:0;background:none;margin-top:12px}.dshWbDetailImage{display:block;width:100%;max-height:360px;object-fit:contain;border-radius:6px;background:var(--dsw-alias-bg-module-platform)}
      .dshWbDetailGallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:10px;margin-top:12px}
      .dshWbDetailThumbButton{display:block;padding:0;border:0;border-radius:6px;background:none}.dshWbDetailThumb{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;transition:box-shadow .15s}
      .dshWbDetailThumbButton:hover .dshWbDetailThumb,.dshWbDetailThumbButton:focus-visible .dshWbDetailThumb{box-shadow:0 0 0 2px var(--dsw-alias-label-primary)}
      .dshWbDetailLightbox{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);cursor:pointer}
      .dshWbDetailLightbox img{max-width:92vw;max-height:92vh;object-fit:contain;border-radius:6px}.dshWbLightboxClose{position:fixed;right:22px;top:22px;width:36px;height:36px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:20px;line-height:1}
      .dshWbModalBackdrop{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:rgba(16,16,18,.52);padding:24px;overflow:auto;animation:dshWbFade .16s ease-out}
      .dshWbModal{background:var(--dsw-alias-bg-layer-1);border-radius:14px;max-width:680px;width:100%;max-height:85vh;overflow:auto;padding:24px;box-shadow:0 18px 52px rgba(0,0,0,.24);animation:dshWbRise .2s cubic-bezier(.2,.8,.2,1)}
      .dshWbModal h2{margin:0}.dshWbModal p{font-size:14px;line-height:22px;margin:12px 0 0}.dshWbConfirm{max-width:430px}.dshWbConfirmIcon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--dsw-alias-bg-module-platform);margin-bottom:18px}.dshWbConfirm .dshWbActions{justify-content:flex-end;margin-top:24px}.dshWbDanger{color:#b42318}.dshWbDanger:hover:not(:disabled){background:rgba(180,35,24,.08)!important}
      @keyframes dshWbFade{from{opacity:0}to{opacity:1}}@keyframes dshWbRise{from{opacity:.75;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
      .dshWbDisabledHint{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px 24px;text-align:center;color:var(--dsw-alias-label-secondary);gap:8px}
      .dshWbFrame{height:100%;min-height:0;display:flex;flex-direction:column}
      .dshWbBody{display:flex;flex:1;min-height:0;min-width:0}.dshWbConversation{container-type:inline-size;container-name:workbench-conversation;overflow:hidden;order:1;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
      .dshWbBusiness{order:2;width:var(--workbench-business-width,36%);min-width:220px;border-left:1px solid var(--dsw-alias-border-l2);overflow:auto;padding:18px;box-sizing:border-box}
      .dshWbBusiness[data-side=left]{order:0;border-left:0;border-right:1px solid var(--dsw-alias-border-l2)}
      .dshWbBusiness[data-embedded=true]{padding:0;overflow:hidden;display:flex;flex-direction:column}.dshWbBusiness[data-embedded=true]>div{flex:1;min-height:0}
      .dshWbBusiness h3{margin:0 0 8px;font-size:16px}.dshWbBusiness textarea{display:block;resize:vertical;min-height:260px;width:100%;padding:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;line-height:1.7}
      .dshWbInit{padding:32px;max-width:650px;margin:auto}.dshWbInit h2{font-size:21px}.dshWbInit select{padding:9px;max-width:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
      .dshWbNotice{padding:10px 14px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.6;overflow-wrap:anywhere}
      .dshWb [hidden]{display:none!important}
      @media(hover:none){.dshWbFavorite{opacity:1;transform:none}}
      @media(prefers-reduced-motion:reduce){.dshWbCard,.dshWbFavorite,.dshWbModal,.dshWbModalBackdrop{animation:none;transition:none}}
      @container workbench-market (max-width:980px){.dshWbGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}}
      @container workbench-market (max-width:620px){.dshWbGrid{grid-template-columns:1fr}}
      @media(max-width:900px){.dshWbMarket{padding:24px}.dshWbBusiness{min-width:180px}}
      @media(max-width:640px){.dshWbMarket{padding:20px 16px 40px}.dshWbMarketHeader{flex-direction:column;margin-bottom:22px}.dshWbTabs{min-width:0}.dshWbTabs [role=tablist]{width:100%}.dshWbBody{flex-direction:column}.dshWbBusiness,.dshWbBusiness[data-side=left]{order:2;width:100%;max-width:none;min-width:0;max-height:35%;border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.dshWbBusiness textarea{min-height:100px}.dshWbGrid{grid-template-columns:1fr}.dshWbBrowseTools,.dshWbSearch{width:100%;max-width:none}.dshWbCategories{width:100%}.dshWbConfirm .dshWbActions{flex-direction:column;align-items:stretch}.dshWbConfirm .dshWbActions .dshWbBtn{width:100%}}
    `
    function useWorkbench(service) { return React.useSyncExternalStore(service.subscribe, service.getSnapshot) }
    function Button({ children, primary, ...props }) { return h('button', { type: 'button', className: `dshWbBtn${primary ? ' dshWbPrimary' : ''}`, ...props }, children) }
    function Notice({ service }) {
      const { error, catalogError, catalogStale, pending, ready } = useWorkbench(service)
      if (error) return h('div', { className: 'dshWbNotice', role: 'alert' }, error, ' ', h(Button, { disabled: pending > 0, onClick: () => service.run(service.load()) }, '重新加载'))
      if (!ready) return h('div', { className: 'dshWbNotice', role: 'status' }, '正在读取本地工作台…')
      if (catalogError) return h('div', { className: 'dshWbNotice', role: 'status' }, '在线市场暂时无法读取，仍可使用已安装的工作台。 ', h(Button, { disabled: pending > 0, onClick: () => service.run(service.load()) }, '重试'))
      if (catalogStale) return h('div', { className: 'dshWbNotice', role: 'status' }, '在线市场暂时无法更新，正在显示上一次成功读取的目录。')
      return null
    }
    function ModeIcon({ mode }) {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, 'aria-hidden': true },
        mode === 'list' ? h('path', { d: 'M2 4h1m3 0h8M2 8h1m3 0h8M2 12h1m3 0h8', strokeLinecap: 'round' })
          : [2, 9].flatMap((x) => [2, 9].map((y) => h('rect', { key: `${x}-${y}`, x, y, width: 5, height: 5, rx: 1 }))))
    }
    function Sidebar({ service, wide }) {
      const { state, catalog, ready, pending, marketOpen } = useWorkbench(service)
      const workbenchEnabled = React.useSyncExternalStore(workbenchPreference.subscribe.bind(workbenchPreference), workbenchPreference.getSnapshot.bind(workbenchPreference))
      const [mode, setMode] = React.useState(() => {
        try { return window.localStorage.getItem('dsh-workbench-sidebar-mode') === 'icons' ? 'icons' : 'list' } catch { return 'list' }
      })
      if (!workbenchEnabled) return null
      const changeMode = (next) => {
        setMode(next)
        try { window.localStorage.setItem('dsh-workbench-sidebar-mode', next) } catch { /* Preferences remain usable when storage is unavailable. */ }
      }
      const iconMode = wide && mode === 'icons'
      const pinned = state.pinned.filter(visibleWorkbench)
      const disabled = !ready || pending > 0 || service.blocked
      return h('nav', { className: 'dshWb dshWbNav', 'data-mode': iconMode ? 'icons' : 'list', 'data-wide': !!wide, 'aria-label': '工作台' },
        h('div', { className: 'dshWbNavHeader' },
          h('button', { type: 'button', className: 'dshWbNavOpen dshWbNavMarket', 'data-active': marketOpen, 'aria-current': marketOpen ? 'page' : undefined, title: '工作台市场', 'aria-label': '工作台市场', onClick: () => service.showMarket() }, h('span', { className: 'dshWbNavIcon', 'aria-hidden': true }, h(MarketIcon, { name: 'market', size: 15 })), wide && h('span', { className: 'dshWbNavLabel' }, '工作台市场')),
          wide && h('div', { className: 'dshWbNavModes', role: 'group', 'aria-label': '工作台显示方式' },
            ...['list', 'icons'].map((value) => h('button', { key: value, type: 'button', className: 'dshWbMode', 'aria-label': value === 'list' ? '列表模式' : '图标模式', title: value === 'list' ? '列表模式' : '图标模式', 'aria-pressed': mode === value, onClick: () => changeMode(value) }, h(ModeIcon, { mode: value }))))),
        h('div', { className: 'dshWbNavItems' }, pinned.map((id, index) => {
          const entry = catalog.find((item) => item.id === id)
          const title = entry?.title || `${id}（不可用）`
          return h('div', { key: id, className: 'dshWbNavRow', 'data-active': !marketOpen && state.active === id,
            draggable: !disabled, onDragStart: (event) => event.dataTransfer.setData('application/x-dsh-workbench', id),
            onDragOver: (event) => { if (event.dataTransfer.types.includes('application/x-dsh-workbench')) event.preventDefault() },
            onDrop: (event) => { event.preventDefault(); if (!disabled) service.run(service.reorder(event.dataTransfer.getData('application/x-dsh-workbench'), id)) }
          }, h('button', { type: 'button', className: 'dshWbNavOpen', disabled: disabled || !entry, title: `${title}（${state.active === id ? '点击关闭工作台' : '点击打开工作台'}）`, 'aria-label': title, 'aria-pressed': state.active === id, onClick: () => service.run(service.toggle(id)) }, h('span', { className: 'dshWbNavIcon', 'aria-hidden': true }, h(WorkbenchIcon, { entry, size: 15 })), wide && !iconMode && h('span', { className: 'dshWbNavLabel' }, entry?.title || id)),
          wide && !iconMode && h('button', { type: 'button', className: 'dshWbMove', title: '向上移动', 'aria-label': `${title}向上移动`, disabled: disabled || index === 0, onClick: () => service.run(service.reorder(id, pinned[index - 1])) }, h(MarketIcon, { name: 'chevronUp', size: 13 })),
          wide && !iconMode && h('button', { type: 'button', className: 'dshWbMove', title: '向下移动', 'aria-label': `${title}向下移动`, disabled: disabled || index === pinned.length - 1, onClick: () => service.run(service.reorder(pinned[index + 1], id)) }, h(MarketIcon, { name: 'chevronDown', size: 13 })))
        })))
    }
    function screenshotFor(entry) {
      return typeof entry?.screenshot === 'string' && entry.screenshot ? entry.screenshot
        : Array.isArray(entry?.screenshots) && typeof entry.screenshots[0] === 'string' ? entry.screenshots[0] : ''
    }
    function screenshotsFor(entry) {
      const result = []
      if (typeof entry?.screenshot === 'string' && entry.screenshot) result.push(entry.screenshot)
      if (Array.isArray(entry?.screenshots)) for (const s of entry.screenshots) if (typeof s === 'string' && s) result.push(s)
      return [...new Set(result)]
    }
    function compactCount(value) {
      if (!Number.isFinite(value) || value < 0) return '暂无'
      return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    }
    function MarketIcon({ name, size = 15 }) {
      const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
      if (name === 'author') return h('svg', common, h('circle', { cx: 12, cy: 8, r: 3.5 }), h('path', { d: 'M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6' }))
      if (name === 'install') return h('svg', common, h('path', { d: 'M12 3v12m0 0 4-4m-4 4-4-4M5 20h14' }))
      if (name === 'like') return h('svg', common, h('path', { d: 'M7 10v10H4V10h3Zm0 9h9.2a2 2 0 0 0 1.9-1.4l1.6-5A2 2 0 0 0 17.8 10H14l.7-3.1A2.4 2.4 0 0 0 12.4 4L7 10v9Z' }))
      if (name === 'search') return h('svg', common, h('circle', { cx: 10.5, cy: 10.5, r: 6.5 }), h('path', { d: 'm16 16 4 4' }))
      if (name === 'plus') return h('svg', common, h('path', { d: 'M12 5v14M5 12h14' }))
      if (name === 'remove') return h('svg', common, h('path', { d: 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5' }))
      if (name === 'market') return h('svg', common, h('rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }))
      if (name === 'chevronUp') return h('svg', common, h('path', { d: 'm7 14 5-5 5 5' }))
      if (name === 'chevronDown') return h('svg', common, h('path', { d: 'm7 10 5 5 5-5' }))
      return h('svg', common, h('path', { d: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z' }))
    }
    function WorkbenchIcon({ size = 16 }) { return h(MarketIcon, { name: 'market', size }) }
    function MetaItem({ icon, label, value }) {
      return h('span', { className: 'dshWbMetaItem' }, h(MarketIcon, { name: icon }), h('b', { title: value }, value), h('small', null, label))
    }
    function EntryMeta({ entry }) {
      const installs = entry.metrics?.npmDownloads30d?.value ?? entry.installations ?? entry.installCount
      const likes = entry.metrics?.githubStars?.value ?? entry.likes ?? entry.likeCount
      return h('div', { className: 'dshWbMeta', 'aria-label': '工作台信息' },
        h(MetaItem, { icon: 'author', label: entry.version ? `作者 · v${entry.version}` : '作者', value: entry.author || '暂无' }),
        Number.isFinite(installs) && installs >= 0 && h(MetaItem, { icon: 'install', label: '近 30 天下载', value: compactCount(installs) }),
        Number.isFinite(likes) && likes >= 0 && h(MetaItem, { icon: 'like', label: 'GitHub Stars', value: compactCount(likes) }))
    }
    function Preview({ entry, detail = false }) {
      const screenshot = screenshotFor(entry)
      const [failedScreenshot, setFailedScreenshot] = React.useState('')
      React.useEffect(() => { setFailedScreenshot('') }, [screenshot])
      if (detail) return null
      if (screenshot && failedScreenshot !== screenshot) return h('img', { className: 'dshWbCardScreenshot', src: screenshot, alt: `${entry.title || '工作台'}产品截图`, loading: 'lazy', style: { objectPosition: entry.screenshotPosition || 'center' }, onError: () => setFailedScreenshot(screenshot) })
      const columns = entry.layout?.businessSide === 'left' ? '1fr 1.8fr' : '1.45fr 1fr'
      return h('div', { className: 'dshWbPreview', role: 'img', 'aria-label': `${entry.title}界面预览（模拟）` },
        h('div', { className: 'dshWbPreviewBar', 'aria-hidden': true }, h('span', { className: 'dshWbPreviewDot' }), h('span', { className: 'dshWbPreviewDot' }), h('span', { className: 'dshWbPreviewDot' })),
        h('div', { className: 'dshWbPreviewCanvas', style: { gridTemplateColumns: columns } },
          h('div', { className: 'dshWbPreviewPane', style: { order: entry.layout?.businessSide === 'left' ? 2 : 1 } }, h('em'), '原生会话', h('i'), h('i')),
          h('div', { className: 'dshWbPreviewPane', style: { order: entry.layout?.businessSide === 'left' ? 1 : 2 } }, h('em'), entry.panelTitle || '业务区域', h('i'), h('i'))))
    }
    function ScreenshotGallery({ entry }) {
      const screenshots = screenshotsFor(entry)
      const [lightbox, setLightbox] = React.useState(null)
      const lightboxCloseRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      React.useEffect(() => {
        if (!lightbox) return undefined
        lightboxCloseRef.current?.focus()
        const handler = (event) => { if (event.key === 'Escape') setLightbox(null) }
        document.addEventListener('keydown', handler)
        return () => { document.removeEventListener('keydown', handler); triggerRef.current?.focus() }
      }, [lightbox])
      const openLightbox = (event, src) => { triggerRef.current = event.currentTarget; setLightbox(src) }
      if (screenshots.length === 0) return null
      const gallery = screenshots.length === 1
        ? h('button', { type: 'button', className: 'dshWbDetailHeroButton', 'aria-label': `放大${entry.title || '工作台'}产品截图`, onClick: (event) => openLightbox(event, screenshots[0]) }, h('img', { className: 'dshWbDetailImage', src: screenshots[0], alt: `${entry.title || '工作台'}产品截图`, loading: 'lazy' }))
        : h('div', { className: 'dshWbDetailGallery' }, screenshots.map((src, index) => h('button', { key: index, type: 'button', className: 'dshWbDetailThumbButton', 'aria-label': `放大${entry.title || '工作台'}截图 ${index + 1}`, onClick: (event) => openLightbox(event, src) }, h('img', { className: 'dshWbDetailThumb', src, alt: '', loading: 'lazy' }))))
      if (!lightbox) return gallery
      return h(React.Fragment, null, gallery, h('div', { className: 'dshWbDetailLightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': '截图放大预览', onClick: () => setLightbox(null) },
        h('button', { ref: lightboxCloseRef, type: 'button', className: 'dshWbLightboxClose', 'aria-label': '关闭截图预览', onClick: () => setLightbox(null) }, '×'),
        h('img', { src: lightbox, alt: `${entry.title || '工作台'}截图放大`, onClick: (event) => event.stopPropagation() })))
    }
    function useDialogFocus(open, onClose, dialogRef) {
      const closeRef = React.useRef(onClose)
      closeRef.current = onClose
      React.useEffect(() => {
        if (!open) return undefined
        const previousFocus = document.activeElement
        const market = document.querySelector('.dshWbMarket')
        const wasInert = market?.inert === true
        if (market) market.inert = true
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const handler = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
          if (event.key !== 'Tab' || !dialogRef.current) return
          const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')]
          if (focusable.length === 0) { event.preventDefault(); dialogRef.current.focus(); return }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', handler)
        return () => {
          document.removeEventListener('keydown', handler)
          document.body.style.overflow = previousOverflow
          if (market && !wasInert) market.inert = false
          if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
        }
      }, [open, dialogRef])
    }
    function DetailModal({ entry, onClose }) {
      const dialogRef = React.useRef(null)
      useDialogFocus(!!entry, onClose, dialogRef)
      if (!entry) return null
      // Render through a portal to body: the market panel declares container-type,
      // which would otherwise resolve a fixed-position overlay against that panel
      // and clip it with its own overflow.
      return require('react-dom').createPortal(
        h('div', { className: 'dshWbModalBackdrop', onClick: onClose },
          h('div', { ref: dialogRef, className: 'dshWbModal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${entry.title || '工作台'} 详情`, tabIndex: -1, onClick: (event) => event.stopPropagation() },
            h('div', { className: 'dshWbActions', style: { marginBottom: 14 } },
              h('h2', { style: { fontSize: 18, lineHeight: '26px', flex: 1, display: 'flex', alignItems: 'center', gap: 8 } }, h('span', { className: 'dshWbCardIcon', 'aria-hidden': true }, h(WorkbenchIcon, { entry, size: 16 })), entry.title),
              entry.pending && h('span', { className: 'dshWbPending' }, '本机草稿'),
              h(Button, { autoFocus: true, onClick: onClose }, '关闭')
            ),
            h(ScreenshotGallery, { entry }),
            entry.description && h('p', null, entry.description),
            h(EntryMeta, { entry }),
            !entry.pending && h('p', { className: 'dshWbMuted' }, `适用人群：${entry.audience || '暂无'}。${entry.requirements || ''}`),
            entry.repository && h('p', { className: 'dshWbMuted' }, 'GitHub：', h('a', { href: entry.repository, target: '_blank', rel: 'noopener noreferrer' }, entry.repository))
          )
        ),
        document.body
      )
    }
    function ConfirmRemoveModal({ entry, disabled, onCancel, onConfirm }) {
      const dialogRef = React.useRef(null)
      useDialogFocus(!!entry, onCancel, dialogRef)
      if (!entry) return null
      return require('react-dom').createPortal(
        h('div', { className: 'dshWbModalBackdrop', onClick: onCancel },
          h('div', { ref: dialogRef, className: 'dshWbModal dshWbConfirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-workbench-remove-title', 'aria-describedby': 'dsh-workbench-remove-description', tabIndex: -1, onClick: (event) => event.stopPropagation() },
            h('div', { className: 'dshWbConfirmIcon', 'aria-hidden': true }, h(MarketIcon, { name: 'remove', size: 18 })),
            h('h2', { id: 'dsh-workbench-remove-title', style: { fontSize: 18, lineHeight: '26px' } }, `移除「${entry.title || entry.id}」？`),
            h('p', { id: 'dsh-workbench-remove-description', className: 'dshWbMuted' }, '这会移除本地工作台和左侧固定入口。已有会话、项目文件和工作台笔记都会保留，之后重新安装仍可继续使用。'),
            h('div', { className: 'dshWbActions' },
              h(Button, { autoFocus: true, onClick: onCancel }, '取消'),
              h(Button, { className: 'dshWbBtn dshWbDanger', disabled, onClick: onConfirm }, '确认移除')))),
        document.body)
    }
    function Market({ service }) {
      const { state, catalog, ready, pending } = useWorkbench(service)
      const workbenchEnabled = React.useSyncExternalStore(workbenchPreference.subscribe.bind(workbenchPreference), workbenchPreference.getSnapshot.bind(workbenchPreference))
      const [tab, setTab] = React.useState('market')
      const [search, setSearch] = React.useState('')
      const [category, setCategory] = React.useState('全部')
      const [detail, setDetail] = React.useState(null)
      const [removing, setRemoving] = React.useState(null)
      if (!workbenchEnabled) return h('section', { className: 'dshWb dshWbMarket', 'aria-label': '工作台市场' },
        h('div', { className: 'dshWbDisabledHint' }, h('h1', null, '工作台功能已关闭'), h('p', { className: 'dshWbMuted' }, '可在 设置 → 通用 中重新开启。')))
      const disabled = !ready || pending > 0 || service.blocked
      const added = state.added.filter(visibleWorkbench)
      const favorites = (state.favorites || []).filter(visibleWorkbench)
      const unavailableEntry = (id) => ({ id, title: id, category: '其他', unavailable: true, description: '提供此工作台的插件当前未加载。' })
      const allEntries = tab === 'mine'
        ? added.map((id) => catalog.find((entry) => entry.id === id) || unavailableEntry(id))
        : tab === 'favorites'
          ? favorites.map((id) => catalog.find((entry) => entry.catalogId === id || entry.id === id) || unavailableEntry(id))
          : tab === 'market' ? [...catalog].filter((entry) => visibleWorkbench(entry.id)) : []
      const categories = ['全部', ...new Set(allEntries.map((entry) => entry.category || '其他'))]
      const query = search.toLowerCase().trim()
      const entries = allEntries.filter((entry) => (category === '全部' || (entry.category || '其他') === category) && `${entry.title || ''} ${entry.description || ''} ${entry.author || ''} ${entry.category || ''}`.toLowerCase().includes(query))
      const selected = allEntries.find((entry) => (entry.catalogId || entry.id) === detail)
      const removingEntry = allEntries.find((entry) => entry.id === removing) || catalog.find((entry) => entry.id === removing)
      const selectCollection = (value) => { setTab(value); setCategory('全部'); setDetail(null) }
      const navigateCollections = (event) => {
        const values = ['market', 'favorites', 'mine']
        const current = values.indexOf(tab)
        let next = current
        if (event.key === 'ArrowRight') next = (current + 1) % values.length
        else if (event.key === 'ArrowLeft') next = (current - 1 + values.length) % values.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = values.length - 1
        else return
        event.preventDefault()
        selectCollection(values[next])
        requestAnimationFrame(() => document.getElementById(`dsh-workbench-${values[next]}-tab`)?.focus())
      }
      return h('section', { className: 'dshWb dshWbMarket', 'aria-label': '工作台市场' },
        h('header', { className: 'dshWbMarketHeader' },
          h('div', { className: 'dshWbMarketHeaderText' },
            h('h1', null, '切换工作台，进入不同工作方式'),
            h('p', { className: 'dshWbMuted' }, '工作台把专属界面、会话和资料组织在一起。选择适合当前任务的工作台，并随时从左侧切换。'))),
        h(Notice, { service }),
        h('div', { className: 'dshWbToolbar' },
          h('div', { className: 'dshWbTabs' }, h('div', { role: 'tablist', 'aria-label': '工作台集合' },
            h(Button, { id: 'dsh-workbench-market-tab', role: 'tab', tabIndex: tab === 'market' ? 0 : -1, 'aria-selected': tab === 'market', 'aria-controls': 'dsh-workbench-market-panel', onKeyDown: navigateCollections, onClick: () => selectCollection('market') }, '工作台市场'),
            h(Button, { id: 'dsh-workbench-favorites-tab', role: 'tab', tabIndex: tab === 'favorites' ? 0 : -1, 'aria-selected': tab === 'favorites', 'aria-controls': 'dsh-workbench-favorites-panel', onKeyDown: navigateCollections, onClick: () => selectCollection('favorites') }, `我的收藏 (${favorites.length})`),
            h(Button, { id: 'dsh-workbench-mine-tab', role: 'tab', tabIndex: tab === 'mine' ? 0 : -1, 'aria-selected': tab === 'mine', 'aria-controls': 'dsh-workbench-mine-panel', onKeyDown: navigateCollections, onClick: () => selectCollection('mine') }, `已安装的工作台 (${added.length})`))),
          h('div', { className: 'dshWbBrowseTools' },
            h('label', { className: 'dshWbSearch' }, h(MarketIcon, { name: 'search' }), h('input', { type: 'search', placeholder: '搜索名称、作者或分类', 'aria-label': '搜索工作台', value: search, onChange: (event) => setSearch(event.target.value) })),
            h('div', { className: 'dshWbCategories', role: 'group', 'aria-label': '按分类筛选' }, categories.map((value) => h('button', { key: value, type: 'button', className: 'dshWbCategoryFilter', 'aria-pressed': category === value, onClick: () => setCategory(value) }, value))))),
        h('section', { id: `dsh-workbench-${tab}-panel`, role: 'tabpanel', 'aria-labelledby': `dsh-workbench-${tab}-tab`, tabIndex: 0 },
          h('div', { className: 'dshWbGrid', 'data-tab': tab }, entries.map((entry) => {
            const catalogId = entry.catalogId || entry.id
            const isFavorite = favorites.includes(catalogId)
            return h('article', { key: catalogId, className: 'dshWbCard' },
              h('div', { className: 'dshWbMedia' }, h(Preview, { entry }), h('button', { type: 'button', className: 'dshWbFavorite', title: isFavorite ? '取消收藏' : '收藏工作台', 'aria-label': isFavorite ? `取消收藏${entry.title}` : `收藏${entry.title}`, 'aria-pressed': isFavorite, disabled: disabled, onClick: () => service.run(service.toggleFavorite(catalogId)) }, h(MarketIcon, { name: 'favorite', size: 17 }))),
              h('div', { className: 'dshWbCardBody' },
                h('div', { className: 'dshWbCardTitle' }, h('h2', null, h('span', { className: 'dshWbCardIcon', 'aria-hidden': true }, h(WorkbenchIcon, { entry, size: 15 })), entry.title), h('span', { className: 'dshWbCategory' }, entry.category || '其他')),
                h('p', { className: 'dshWbMuted dshWbCardDescription' }, entry.description || '这个工作台暂时还没有填写介绍。'),
                h(EntryMeta, { entry }),
                h('div', { className: 'dshWbActions' }, h(Button, { onClick: () => setDetail(catalogId) }, '查看详情'),
                  state.added.includes(entry.id)
                    ? h(Button, { primary: true, disabled: disabled || entry.unavailable, onClick: () => service.run(service.open(entry.id)) }, '打开工作台')
                    : entry.installed
                      ? h(Button, { primary: true, disabled: disabled || entry.unavailable, onClick: () => service.run(service.add(entry.id)) }, '添加到我的工作台')
                      : h('a', { className: 'dshWbBtn dshWbPrimary', href: entry.repository, target: '_blank', rel: 'noopener noreferrer' }, '查看安装说明'),
                  tab === 'mine' && h(Button, { className: 'dshWbBtn dshWbDanger', disabled, onClick: () => setRemoving(entry.id) }, '移除'))))
          }), entries.length === 0 && h('div', { className: 'dshWbEmpty' }, h('div', null,
            h('strong', null, tab === 'favorites' && !search ? '还没有收藏工作台' : tab === 'mine' && !search ? '还没有安装工作台' : '没有找到匹配的工作台'),
            h('p', { className: 'dshWbMuted' }, tab === 'favorites' && !search ? '把鼠标移到市场卡片上，点击星标即可收藏。' : tab === 'mine' && !search ? '到工作台市场选择一个工作台开始。' : '试试其他关键词或分类。'))))),
        detail != null && h(DetailModal, { entry: selected, onClose: () => setDetail(null) }),
        removing != null && h(ConfirmRemoveModal, { entry: removingEntry, disabled, onCancel: () => setRemoving(null), onConfirm: () => service.run(service.remove(removing).then(() => setRemoving(null))) }))
    }
    function Notebook({ service, entry }) {
      const { state, drafts, pending, error } = useWorkbench(service)
      const value = drafts[entry.id] ?? state.notes[entry.id] ?? ''
      const dirty = Object.hasOwn(drafts, entry.id)
      return h('div', null, h('h3', null, entry.panelTitle), h('p', { className: 'dshWbMuted' }, entry.hint),
        h('textarea', { value, maxLength: 100000, 'aria-label': entry.panelTitle, placeholder: entry.placeholder, onChange: (event) => service.editNote(entry.id, event.target.value) }),
        h('p', { className: 'dshWbMuted', role: 'status' }, error ? '保存失败，当前内容仍保留在界面中。' : dirty || pending ? '正在保存…' : '已保存在本地 · 此工作台的会话共用这份笔记'))
    }
    class PanelBoundary extends React.Component {
      state = { error: false }
      static getDerivedStateFromError() { return { error: true } }
      render() { return this.state.error ? h('div', { role: 'alert' }, '业务面板加载失败。原生会话和公共入口仍可使用。') : this.props.children }
    }
    // The portal destination stays stable; providers may dock its mount anywhere
    // inside their own main-area layout without remounting the native input.
    function ConversationMount({ container }) {
      const previous = React.useRef(null)
      const attach = React.useCallback((node) => {
        if (node) node.appendChild(container)
        else if (container.parentNode === previous.current) container.remove()
        previous.current = node
      }, [container])
      return h('div', { ref: attach, style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, height: '100%' } })
    }
    function Frame({ service, conversation }) {
      const { state, catalog, ready, pending } = useWorkbench(service)
      const workbenchEnabled = React.useSyncExternalStore(workbenchPreference.subscribe.bind(workbenchPreference), workbenchPreference.getSnapshot.bind(workbenchPreference))
      const sessions = React.useSyncExternalStore(React.useCallback((listener) => service.ctx.sessions.list.subscribe(listener), [service]), () => service.ctx.sessions.list.getSnapshot())
      const workspaces = React.useSyncExternalStore(React.useCallback((listener) => service.ctx.workspaces.list.subscribe(listener), [service]), () => service.ctx.workspaces.list.getSnapshot())
      const [workspaceId, setWorkspaceId] = React.useState('')
      const [conversationContainer] = React.useState(() => {
        const node = document.createElement('div')
        Object.assign(node.style, { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', minWidth: '0', height: '100%' })
        return node
      })
      if (!workbenchEnabled) return h('div', { className: 'dshWb dshWbFrame' }, h('div', { className: 'dshWbDisabledHint' }, h('h2', null, '工作台功能已关闭'), h('p', { className: 'dshWbMuted' }, '可在 设置 → 通用 中重新开启。')))
      const entry = state.active && catalog.find((item) => item.id === state.active)
      const id = entry?.id
      const customFrame = entry?.customFrame === true
      const conversationMount = h(ConversationMount, { container: conversationContainer })
      const hasCurrentSession = sessions.current != null
      const disabled = !ready || pending > 0 || service.blocked
      const chosen = workspaces.items.find((item) => item.workspaceId === workspaceId) || service.defaultWorkspace()
      return h('div', { className: 'dshWb dshWbFrame' }, h(Notice, { service }),
        require('react-dom').createPortal(conversation, conversationContainer),
        ...catalog.filter((item) => item.customFrame === true && state.added.includes(item.id)).map((item) => h('div', { key: item.id, hidden: id !== item.id, style: { position: 'relative', overflow: 'hidden', flex: 1, minHeight: 0, minWidth: 0, width: '100%', maxWidth: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' } }, h(PanelBoundary, null, h(item.Component, { service, entry: item, active: id === item.id, conversation: id === item.id ? conversationMount : null })))),
        h('div', { className: 'dshWbBody', hidden: customFrame, style: { '--workbench-business-width': `${(entry?.layout?.businessWidth ?? 0.36) * 100}%` } },
          h('div', { className: 'dshWbConversation' },
            entry && !hasCurrentSession && h('section', { className: 'dshWbInit' }, h('h2', null, `开始使用${entry.title}`), h('p', { className: 'dshWbMuted' }, '可以直接新建工作区并开始对话，也可以使用已有工作区。新会话会自动关联这个工作台。'),
              h(Button, { primary: !chosen, disabled, onClick: () => service.run(service.newWorkspaceSession()) }, '新建工作区并开始对话'),
              workspaces.items.length > 0 && h('div', { className: 'dshWbActions' }, h('select', { 'aria-label': '选择工作区', value: chosen?.workspaceId || '', disabled, onChange: (event) => setWorkspaceId(event.target.value) }, h('option', { value: '', disabled: true }, '选择已有工作区'), ...workspaces.items.map((item) => h('option', { key: item.workspaceId, value: item.workspaceId }, item.title)))),
              h('p', { className: 'dshWbMuted' }, chosen ? `将使用工作区：${chosen.title}` : '选择或新建一个项目文件夹，即可创建工作区并开始对话。'),
              chosen && h(Button, { primary: true, disabled, onClick: () => service.run(service.newSession(chosen.workspaceId)) }, '在此工作区新建会话')),
            // One fixed position for the native conversation: changing workbench
            // content or moving to a custom dock does not remount its input tree.
            h('div', { style: { display: entry && !hasCurrentSession ? 'none' : 'contents' } }, !customFrame && conversationMount)),
          ...catalog.filter((item) => !item.customFrame && state.added.includes(item.id)).map((item) => h('aside', { key: item.id, className: 'dshWbBusiness', 'data-side': item.layout?.businessSide, 'data-embedded': item.embedded === true, hidden: id !== item.id, 'aria-label': item.panelTitle }, h(PanelBoundary, null, h(item.Component, { service, entry: item }))))))
    }
    function apply(ctx) {
      const service = new Workbenches(ctx)
      ctx.effect(() => ctx.reflect.provide('desktopWorkbenches', service), 'workbenches: service')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'dsh-desktop-workbenches'
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      }, 'workbenches: styles')
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, inject: () => ({ service }) }, Market))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: PANEL, order: -20, inject: () => ({ service }) }, Sidebar))
      function WorkbenchEnableSetting() {
        const enabled = React.useSyncExternalStore(workbenchPreference.subscribe.bind(workbenchPreference), workbenchPreference.getSnapshot.bind(workbenchPreference))
        return h('label', { className: 'dshWbSetting' }, h('span', null, h('strong', null, '启用工作台功能'), h('small', null, '开启后可使用工作台市场和已安装的工作台；关闭后所有工作台不加载，不影响已保存的会话和数据。')),
          h('input', { type: 'checkbox', role: 'switch', checked: enabled, onChange: (event) => { workbenchPreference.set(event.target.checked); if (!event.target.checked) ctx.layout.selectPanel(null) }, 'aria-label': '启用或关闭工作台功能' }))
      }
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'desktop-workbench-enable', order: 34 }, WorkbenchEnableSetting))
      ctx.slots.inject('desktop.workbench.frame', () => ctx.slots.register({ name: 'desktop.workbench.frame', inject: () => ({ service }) }, Frame))
      ctx.effect(() => ctx.sessions.list.subscribe(() => service.selectionChanged()), 'workbenches: session navigation')
      ctx.effect(() => ctx.uiWorkspace.registerSessionOpener((sessionId, source = 'explicit-session') => {
        if (source === 'workspace' && service.routeWorkspaceSession(sessionId)) return true
        const id = service.state.sessionBindings[sessionId]
        if (!service.ready || !id || !service.state.added.includes(id) || !service.catalog.has(id)) return false
        service.run(service.open(id, sessionId))
        return true
      }), 'workbenches: open linked session')
      ctx.effect(() => {
        service.run(service.load())
        const beforeUnload = (event) => { if (service.pending || service.blocked || service.draftNotes.size) { event.preventDefault(); event.returnValue = '' } }
        window.addEventListener('beforeunload', beforeUnload)
        return () => { window.removeEventListener('beforeunload', beforeUnload); service.dispose() }
      }, 'workbenches: lifecycle')
    }
    return { apply, inject: ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace'], Workbenches, Frame, Market, Notebook }
  }
})
