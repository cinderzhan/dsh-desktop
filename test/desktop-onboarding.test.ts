import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { patchPath, projectRoot } from './patch-path'

interface Registration {
  config: {
    name: string
    id?: string
    order?: number
    priority?: number
    inject?: () => Record<string, unknown>
  }
  component: (props: Record<string, unknown>) => unknown
}

interface CtxHarness {
  effect: (fn: () => unknown | (() => void)) => () => void
  locale: {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => void
    bind: (ns: string) => (key: string) => string
  }
  settingsScope: {
    bind: (spec: { namespace: string }) => unknown
    describe: () => unknown
  }
  remote: {
    llm: {
      listProviders: () => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
      listConfigurableProviders: () => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
    }
    credentials: {
      describe: (refs: string[]) => Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { message: string } }>
      set: (ref: string, value: string) => Promise<{ ok: boolean; error?: { message: string } }>
      unset: (ref: string) => Promise<{ ok: boolean; error?: { message: string } }>
    }
    settings: {
      mutate: (
        ns: string,
        ops: unknown[],
        revision?: number
      ) => Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message: string } }>
    }
  }
  settingsSchema: {
    rehydrate: (schema: unknown) => unknown
    nodeAtPath: (root: unknown, path: readonly string[]) => unknown
  }
  slots: {
    inject: (name: string, callback: () => unknown) => unknown
    register: (config: Registration['config'], component: Registration['component']) => () => void
  }
}

function createReactStub() {
  const createElement = (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): { type: unknown; props: Record<string, unknown>; children: unknown[] } => ({
    type,
    props: { ...(props ?? {}) },
    children
  })
  const Fragment = Symbol.for('react.fragment')
  const element = (init: unknown) => [init, () => undefined]
  return {
    Fragment,
    createElement,
    useState: element,
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (factory: (...args: unknown[]) => unknown) => factory,
    useRef: (init: unknown) => ({ current: init }),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()
  } as const
}

function createPrimitiveStub() {
  const passthrough = () => null
  return {
    OnboardingSurface: passthrough,
    Button: passthrough,
    Modal: passthrough,
    Input: passthrough,
    IconApiOutline14: passthrough,
    IconSettingsOutline16: passthrough,
    IconFolderOpenOutline16: passthrough,
    IconChevronRightOutline14: passthrough,
    IconChevronLeftOutline14: passthrough,
    IconCloseOutline16: passthrough,
    IconCheckOutline16: passthrough,
    IconSparkle16: passthrough,
    IconGlobeOutline14: passthrough,
    IconFolderClose16: passthrough,
    IconShieldOutline16: passthrough,
    IconCordisPluginOutline14: passthrough
  } as const
}

function loadPlugin() {
  const source = readFileSync(
    path.join(projectRoot, 'packages', 'dsh-desktop-onboarding', 'client.js'),
    'utf8'
  )
  let definition: {
    id: string
    factory: (require: (id: string) => unknown) => {
      apply: (ctx: CtxHarness) => void
      inject: string[]
    }
  } | undefined
  const appended: Array<{ id?: string; textContent?: string }> = []
  const document = {
    getElementById: vi.fn(() => null),
    createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '' })),
    head: { appendChild: (node: { id?: string; textContent?: string }) => appended.push(node) }
  }
  vm.runInNewContext(source, {
    document,
    navigator: { language: 'en-US' },
    window: {
      __ModuleLoader__: {
        load: (value: typeof definition) => {
          definition = value
        }
      }
    }
  })
  if (!definition) throw new Error('client.js did not register a plugin definition')
  const React = createReactStub()
  const primitives = createPrimitiveStub()
  return {
    plugin: definition.factory((id) => {
      if (id === 'react') return React
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      if (id === '@deepseek-ai/dsh-client-ui-settings-models') return {
        ModelsSection: primitives.OnboardingSurface,
        ModelsSettingsStore: class {
          store = { subscribe: () => () => undefined, getSnapshot: () => ({}) }
        },
        createModelsOperations: () => ({}),
        createSettingsSchemaOperations: () => ({}),
        refreshIfLoaded: () => undefined
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    }),
    appended,
    React,
    primitives
  }
}

function createCtx(overrides: Partial<CtxHarness> = {}): { ctx: CtxHarness; registrations: Registration[] } {
  const registrations: Registration[] = []
  const slots: CtxHarness['slots'] = {
    inject: (_name, callback) => callback(),
    register: (config, component) => {
      registrations.push({ config, component })
      return () => undefined
    }
  }
  const noopEffect = () => () => undefined
  const ctx: CtxHarness = {
    effect: noopEffect,
    locale: {
      register: () => undefined,
      bind: () => (key: string) => key
    },
    settingsScope: {
      bind: () => ({ getSnapshot: () => ({ mode: 'memory', value: {} }), subscribe: () => () => undefined, set: async () => undefined }),
      describe: () => ({ ensure: async () => undefined, getSnapshot: () => ({ view: undefined }) })
    },
    remote: {
      llm: { listProviders: async () => ({ ok: true, value: [] }), listConfigurableProviders: async () => ({ ok: true, value: [] }) },
      credentials: {
        describe: async () => ({ ok: true, value: {} }),
        set: async () => ({ ok: true }),
        unset: async () => ({ ok: true })
      },
      settings: { mutate: async () => ({ ok: true, value: {} }) }
    },
    settingsSchema: {
      rehydrate: () => ({}),
      nodeAtPath: () => undefined
    },
    slots,
    ...overrides
  }
  return { ctx, registrations }
}

describe('DSH Desktop onboarding wizard', () => {
  it('keeps the first render stable and skips only the current step', () => {
    const source = readFileSync(
      path.join(projectRoot, 'packages', 'dsh-desktop-onboarding', 'client.js'),
      'utf8'
    )
    expect(source).toContain("const WIZARD_ACK_FIELD = 'wizardVersion'")
    expect(source).toContain('function gotoPage(next)')
    expect(source).toContain('totalSteps = 4')
    expect(source).toContain('skipConfirmTitle')
  })

  it('shadows the stock deepseek-official onboarding step with a lower-priority desktop step', () => {
    const { plugin, appended } = loadPlugin()
    const { ctx, registrations } = createCtx()
    plugin.apply(ctx)

    expect(plugin.inject).toEqual([
      'slots',
      'locale',
      'remote',
      'remote.credentials',
      'remote.llm',
      'remote.settings',
      'settingsScope',
      'settingsSchema'
    ])
    const onboardingRegistrations = registrations.filter(({ config }) => config.name === 'settings.onboarding')
    expect(onboardingRegistrations).toHaveLength(1)
    const [onboardingRegistration] = onboardingRegistrations
    expect(onboardingRegistration).toBeDefined()
    const { config } = onboardingRegistration as Registration
    expect(config.id).toBe('dsh-desktop-onboarding')
    expect(config.order).toBe(0)
    expect(typeof config.inject).toBe('function')

    expect(appended).toHaveLength(1)
    const [styleTag] = appended
    expect(styleTag?.id).toBe('dsh-desktop-onboarding-style')
  })

  it('registers both Chinese and English dictionaries on the desktop-onboarding namespace', () => {
    const localeSpy = vi.fn()
    const { plugin } = loadPlugin()
    const { ctx } = createCtx({
      locale: {
        register: localeSpy,
        bind: () => (key: string) => key
      }
    })
    plugin.apply(ctx)
    expect(localeSpy).toHaveBeenCalledTimes(1)
    const [ns, dicts] = localeSpy.mock.calls[0]!
    expect(ns).toBe('desktop-onboarding')
    expect(Object.keys(dicts as object).sort()).toEqual(['en', 'zh'])
    const dictsRecord = dicts as Record<string, Record<string, string>>
    const zh = dictsRecord.zh ?? {}
    const en = dictsRecord.en ?? {}
    expect(zh.step1Title).toBeTruthy()
    expect(zh.step2Title).toBeTruthy()
    expect(zh.step3Title).toBeTruthy()
    expect(en.step1Title).toBeTruthy()
    expect(en.step2Title).toBeTruthy()
    expect(en.step3Title).toBeTruthy()
  })
})

describe('DSH Desktop onboarding composition', () => {
  it('is mounted by the desktop profile patch yml', async () => {
    const patch = await readFile(
      path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'),
      'utf8'
    )
    const normalized = patch.replaceAll('\r\n', '\n')
    expect(normalized).toMatch(/- id: dsh-desktop-onboarding\n      name: dsh-desktop-onboarding/u)
  })

  it('declares a file dependency from the root manifest', async () => {
    const manifest = await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string> }
    expect(parsed.dependencies?.['dsh-desktop-onboarding']).toBe('file:packages/dsh-desktop-onboarding')
  })

  it('is reachable from the @deepseek-ai/dsh dependency closure', async () => {
    const dshPatch = await readFile(patchPath('@deepseek-ai/dsh'), 'utf8')
    expect(dshPatch).toContain('+    "dsh-desktop-onboarding": "0.1.0",')
  })
})
