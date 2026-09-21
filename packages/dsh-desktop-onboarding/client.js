window.__ModuleLoader__.load({
  id: 'dsh-desktop-onboarding',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const {
      OnboardingSurface,
      Button,
      Modal,
      IconSettingsOutline16,
      IconFolderOpenOutline16,
      IconCheckOutline16,
      IconSparkle16,
      IconGlobeOutline14,
      IconFolderClose16
    } = primitives
    // The model step reuses the settings page's own section: same store, same
    // operations, same reading rules — upstream exports these exactly so the
    // first-run wizard never re-implements model setup.
    const modelsPackage = require('@deepseek-ai/dsh-client-ui-settings-models')
    const {
      ModelsSection,
      ModelsSettingsStore,
      createModelsOperations,
      createSettingsSchemaOperations
    } = modelsPackage

    const NS = 'desktop-onboarding'
    const WIZARD_VERSION = '2026-09-18.2'
    const MODELS_NS = 'settings.models'

    // Settings owned by the wizard. The host half (index.js) registered the
    // schema; the value object the mirror hands back has exactly this shape.
    const WIZARD_ACK_FIELD = 'wizardVersion'

    // DSH Desktop whale mark (same artwork as the sidebar brand seat), drawn
    // in currentColor so it follows the header text color in both themes.
    const BRAND_MARK_VIEWBOX = { x: 42, y: 218, width: 898, height: 564 }
    const BRAND_MARK_PATH = 'M478.318 218C605.318 218 683.318 287 687.318 404L691.318 472C693.318 525 697.319 556 726.318 574C746.318 587 774.318 585 790.318 562C799.318 550 802.318 539 792.318 534C747.319 513 727.318 472 738.318 428C739.652 420 742.652 418.667 747.318 424C774.318 450 815.318 460 831.318 501C855.318 457 898.318 456 930.318 436C936.318 431.333 939.318 433.333 939.318 442C938.318 496 903.318 535 850.318 547C841.318 570 833.318 592 819.318 622C773.318 723 661.318 782 491.318 782H294.318C161.319 782 74.3183 714 53.3184 592C41.3184 526 38.3184 433 50.3184 375C70.3184 277 113.82 218 234.32 218H478.318ZM571.82 350.5C469.82 333.5 277.82 329.5 164.82 350.5C138.82 355.5 114.318 379 110.318 404C100.318 451 102.318 551 124.318 596C155.318 660 214.319 697 315.318 705C324.318 678 346.319 662 376.318 662C404.318 662 427.318 678 435.318 705C493.318 699 526.318 680 562.318 652C621.318 606 633.749 527.103 633.749 424C633.749 385.144 604.82 355.5 571.82 350.5ZM179.32 264C167.722 264 158.32 273.402 158.32 285C158.32 296.598 167.722 306 179.32 306C190.918 306 200.32 296.598 200.32 285C200.32 273.402 190.918 264 179.32 264ZM245.551 264C233.953 264 224.551 273.402 224.551 285C224.551 296.598 233.953 306 245.551 306C257.149 306 266.551 296.598 266.551 285C266.551 273.402 257.149 264 245.551 264ZM311.782 264C300.184 264 290.782 273.402 290.782 285C290.782 296.598 300.184 306 311.782 306C323.38 306 332.782 296.598 332.782 285C332.782 273.402 323.38 264 311.782 264Z'

    const STYLE_ID = 'dsh-desktop-onboarding-style'
    // Compact single-screen layout: the chrome (header / progress / footer)
    // stays fixed; only the card body scrolls when the provider list is long.
    const STYLE = `
      .dshDeskOnbRoot{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:12px;padding:16px 28px 12px;overflow:hidden}
      .dshDeskOnbHeader{flex:none;display:flex;align-items:center;gap:10px}
      .dshDeskOnbBrandMark{display:inline-flex;align-items:center;color:var(--dsw-alias-label-primary)}
      .dshDeskOnbBrandName{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:22px}
      .dshDeskOnbBrandBy{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
      .dshDeskOnbSkipAll{margin-left:auto;border:0;background:none;padding:4px 8px;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;border-radius:6px}
      .dshDeskOnbSkipAll:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .dshDeskOnbProgress{flex:none;display:flex;gap:6px;align-items:center;width:100%;max-width:640px;margin:0 auto}
      .dshDeskOnbSegment{flex:1;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:4px;overflow:hidden;position:relative}
      .dshDeskOnbSegment::after{content:"";background:var(--dsw-alias-brand-primary);width:0;height:100%;display:block;transition:width .24s ease}
      .dshDeskOnbSegment[data-state=done]::after{width:100%}
      .dshDeskOnbSegment[data-state=active]::after{width:60%}
      .dshDeskOnbLegend{flex:none;display:flex;gap:18px;justify-content:space-between;align-items:center;width:100%;max-width:640px;margin:0 auto}
      .dshDeskOnbLegendItem{color:var(--dsw-alias-label-tertiary);gap:5px;align-items:center;font-size:11px;line-height:16px;display:inline-flex;white-space:nowrap}
      .dshDeskOnbLegendItem[data-state=active]{color:var(--dsw-alias-label-primary)}
      .dshDeskOnbLegendItem[data-state=done]{color:var(--dsw-alias-label-secondary)}
      .dshDeskOnbLegendItem::before{content:"";border-radius:50%;background:currentColor;width:5px;height:5px}
      .dshDeskOnbCard{flex:1;min-height:0;box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-secondary);border-radius:14px;padding:14px 20px;display:flex;flex-direction:column;overflow:hidden}
      .dshDeskOnbCardHeader{flex:none}
      .dshDeskOnbHeading{color:var(--dsw-alias-label-primary);margin:0;font-size:17px;font-weight:600;line-height:24px}
      .dshDeskOnbLead{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:12px;line-height:18px}
      .dshDeskOnbCardBody{flex:1;min-height:0;margin-top:10px;overflow-y:auto}
      .dshDeskOnbModelsHost>div>h2:first-child{display:none}
      .dshDeskOnbModelsHost>div>h2:first-child+p{display:none}
      .dshDeskOnbFeatures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .dshDeskOnbFeature{box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--dsw-alias-border-secondary);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
      .dshDeskOnbFeatureIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary)}
      .dshDeskOnbFeatureTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:18px}
      .dshDeskOnbFeatureDesc{margin:3px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:17px}
      .dshDeskOnbWorkspace{display:flex;gap:14px;align-items:flex-start}
      .dshDeskOnbWorkspaceArt{flex:none;display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
      .dshDeskOnbHint{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:18px}
      .dshDeskOnbLink{border:0;background:none;padding:0;cursor:pointer;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;display:inline-flex;gap:6px;align-items:center;margin-top:12px}
      .dshDeskOnbFooter{flex:none;display:flex;align-items:center;gap:10px;width:100%;max-width:640px;margin:0 auto}
      .dshDeskOnbSpacer{flex:1}
      .dshDeskOnbGhost{border:0;background:none;padding:6px 10px;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;border-radius:8px}
      .dshDeskOnbGhost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .dshDeskOnbGhost:disabled{opacity:0;pointer-events:none}
      .dshDeskOnbPrimary{border:0;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand,#fff);padding:6px 16px;cursor:pointer;font-size:13px;font-weight:500;line-height:20px;border-radius:8px}
      .dshDeskOnbPrimary:disabled{opacity:.5;cursor:default}
      .dshDeskOnbParagraph{margin:0 0 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskOnbSubheading{margin:14px 0 6px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:20px}
      .dshDeskOnbLinkList{display:flex;flex-direction:column;gap:6px;margin:4px 0 10px}
      .dshDeskOnbTextLink{color:var(--dsw-alias-brand-primary);font-size:13px;line-height:18px;text-decoration:none;display:inline-flex;gap:6px;align-items:center}
      .dshDeskOnbTextLink:hover{text-decoration:underline}
      @media (width<=620px){.dshDeskOnbFeatures{grid-template-columns:1fr}}
      @media (prefers-reduced-motion:reduce){.dshDeskOnbSegment::after{transition:none}}
    `

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-desktop-onboarding'
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    // ---------- locale dictionaries ----------

    const en = {
      brandName: 'DSH Desktop',
      brandBy: 'by dataelem',
      step0Title: 'Internal Testing Notice',
      declarationBody: "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
      desktopIntroTitle: 'About DSH Desktop',
      desktopIntroBody: 'DSH Desktop is maintained by the DataElem team as the desktop edition of DeepSeek Harness — local-first and cross-platform.',
      officialSite: 'Official site',
      officialSiteUrl: 'https://www.dshdesktop.com/',
      feedbackLink: 'GitHub Issues',
      desktopIntroFeedback: 'Found a bug or have a suggestion? Let us know via GitHub Issues, or reach us through the official site.',
      step1Title: 'Connect a model',
      step1Lead: 'Same model settings as the Settings panel — pick a provider and save an API key, or add a custom service.',
      step2Title: 'Make DSH Desktop yours',
      step2Lead: 'You can revisit anything from the settings panel (gear icon at the bottom of the sidebar).',
      featureMarketTitle: 'Plugin market',
      featureMarketDesc: 'Install community plugins and workbenches to extend what DSH can do.',
      featurePptTitle: 'PPT mode',
      featurePptDesc: 'Generate presentation drafts from a prompt — accessible from the home hero.',
      featureWorkspaceTitle: 'Workspaces & permissions',
      featureWorkspaceDesc: 'Control which folders DSH can read, write, and run commands in.',
      featureAppearanceTitle: 'Appearance & language',
      featureAppearanceDesc: 'Theme, font size, language and notification preferences.',
      openSettings: 'Open settings',
      step3Title: 'Choose a workspace',
      step3Lead: 'A workspace is the folder DSH will work inside — for files, commands, and new conversations.',
      workspaceAction: 'Use the picker on the home screen or the sidebar.',
      startUsing: 'Start using DSH',
      previous: 'Back',
      next: 'Next',
      skipStep: 'Skip this step',
      skip: 'Skip the wizard',
      skipConfirmTitle: 'Skip the onboarding wizard?',
      skipConfirmDescription: 'You can always reopen the wizard from settings.',
      skipConfirmCancel: 'Keep going',
      skipConfirmAction: 'Skip'
    }

    const zh = {
      brandName: 'DSH Desktop',
      brandBy: 'by dataelem',
      step0Title: '内测声明',
      declarationBody: 'DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。',
      desktopIntroTitle: '关于 DSH Desktop',
      desktopIntroBody: 'DSH Desktop 是由 DataElem 团队维护的 DeepSeek Harness 桌面版本，为 Harness 提供本地优先、跨平台的桌面体验。',
      officialSite: '官网',
      officialSiteUrl: 'https://dshdesktop.com/zh/',
      feedbackLink: 'GitHub Issues',
      desktopIntroFeedback: '遇到问题或有功能建议？欢迎通过 GitHub Issues 反馈，或在官网联系我们。',
      step1Title: '连接一个模型',
      step1Lead: '与「设置 → 模型」相同的配置界面：选择提供方并保存 API Key，或添加自定义服务。',
      step2Title: '了解 DSH Desktop 的功能',
      step2Lead: '所有项目都可以在设置面板（左下角齿轮图标）中随时调整。',
      featureMarketTitle: '插件市场',
      featureMarketDesc: '安装社区插件与工作台，扩展 DSH 的能力。',
      featurePptTitle: 'PPT 模式',
      featurePptDesc: '一键从提示词生成演示文稿，入口在首页。',
      featureWorkspaceTitle: '工作区与权限',
      featureWorkspaceDesc: '控制 DSH 可访问的文件夹、可执行的命令。',
      featureAppearanceTitle: '外观与语言',
      featureAppearanceDesc: '主题、字号、语言与通知偏好。',
      openSettings: '打开设置',
      step3Title: '选择一个工作区',
      step3Lead: '工作区是 DSH 工作的文件夹——文件读写、命令执行、新对话都会使用它。',
      workspaceAction: '在首页的工作区选择器或侧栏中添加。',
      startUsing: '开始使用',
      previous: '上一步',
      next: '下一步',
      skipStep: '跳过此步',
      skip: '跳过引导',
      skipConfirmTitle: '跳过新手引导？',
      skipConfirmDescription: '之后随时可以在设置中重新打开。',
      skipConfirmCancel: '继续',
      skipConfirmAction: '跳过'
    }

    // ---------- shared helpers ----------

    // The slot machinery hands slot entries a hook built with
    // useSyncExternalStoreWithSelector; rendered outside the slot tree, the
    // wizard builds the same selector hook directly over the store.
    function createSnapshotHook(store) {
      return function useSnapshot(selector) {
        return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
      }
    }

    function BrandHeader({ t, onSkipAll }) {
      const height = 18
      return React.createElement(
        'div',
        { className: 'dshDeskOnbHeader' },
        React.createElement(
          'span',
          { className: 'dshDeskOnbBrandMark', 'aria-hidden': 'true' },
          React.createElement(
            'svg',
            {
              width: height * BRAND_MARK_VIEWBOX.width / BRAND_MARK_VIEWBOX.height,
              height,
              viewBox: BRAND_MARK_VIEWBOX.x + ' ' + BRAND_MARK_VIEWBOX.y + ' ' + BRAND_MARK_VIEWBOX.width + ' ' + BRAND_MARK_VIEWBOX.height,
              fill: 'none'
            },
            React.createElement('path', { d: BRAND_MARK_PATH, fill: 'currentColor' })
          )
        ),
        React.createElement('span', { className: 'dshDeskOnbBrandName' }, t('brandName')),
        React.createElement('span', { className: 'dshDeskOnbBrandBy' }, t('brandBy')),
        React.createElement(
          'button',
          { type: 'button', className: 'dshDeskOnbSkipAll', onClick: onSkipAll },
          t('skip')
        )
      )
    }

    function ProgressRail({ t, page, stepLabels }) {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { className: 'dshDeskOnbProgress' },
          stepLabels.map((label, idx) =>
            React.createElement('div', {
              key: idx,
              className: 'dshDeskOnbSegment',
              'data-state': idx < page ? 'done' : idx === page ? 'active' : 'idle'
            })
          )
        ),
        React.createElement(
          'div',
          { className: 'dshDeskOnbLegend' },
          stepLabels.map((label, idx) =>
            React.createElement(
              'span',
              {
                key: idx,
                className: 'dshDeskOnbLegendItem',
                'data-state': idx < page ? 'done' : idx === page ? 'active' : 'idle'
              },
              (idx + 1) + '. ' + label
            )
          )
        )
      )
    }

    function CardShell({ labelledby, children }) {
      return React.createElement(
        'section',
        { className: 'dshDeskOnbCard', 'aria-labelledby': labelledby },
        children
      )
    }

    function CardHeader({ id, title, lead }) {
      return React.createElement(
        'div',
        { className: 'dshDeskOnbCardHeader' },
        React.createElement('h2', { id, className: 'dshDeskOnbHeading' }, title),
        lead ? React.createElement('p', { className: 'dshDeskOnbLead' }, lead) : null
      )
    }

    // The cordis plugin icon is named IconCordisPluginOutline14; the wrapper
    // import is a tiny convenience so the feature list reads naturally.
    function IconCordisFeatureIcon(props) {
      return React.createElement(primitives.IconCordisPluginOutline14, props)
    }

    // ---------- step pages (module scope: stable identities, no remounts) ----------

    // Step 0: the restored internal-testing declaration (previously the
    // WelcomeNotice modal from the models package), now folded into the
    // wizard together with the DSH Desktop / DataElem introduction and the
    // project's public links. External links open in the system browser via
    // the main process's window-open handler.
    function DeclarationPage({ t }) {
      const paragraphs = t('declarationBody').split('\n\n')
      const links = [
        { label: 'GitHub', href: 'https://github.com/dataelement/dsh-desktop' },
        { label: t('officialSite'), href: t('officialSiteUrl') },
        { label: t('feedbackLink'), href: 'https://github.com/dataelement/dsh-desktop/issues' }
      ]
      return React.createElement(
        CardShell,
        { labelledby: 'dshDeskOnbStep0' },
        React.createElement(CardHeader, { id: 'dshDeskOnbStep0', title: t('step0Title') }),
        React.createElement(
          'div',
          { className: 'dshDeskOnbCardBody' },
          paragraphs.map((paragraph, idx) =>
            React.createElement('p', { key: idx, className: 'dshDeskOnbParagraph' }, paragraph)
          ),
          React.createElement('h3', { className: 'dshDeskOnbSubheading' }, t('desktopIntroTitle')),
          React.createElement('p', { className: 'dshDeskOnbParagraph' }, t('desktopIntroBody')),
          React.createElement(
            'div',
            { className: 'dshDeskOnbLinkList' },
            links.map((link) =>
              React.createElement(
                'a',
                { key: link.href, className: 'dshDeskOnbTextLink', href: link.href, target: '_blank', rel: 'noreferrer' },
                link.label
              )
            )
          ),
          React.createElement('p', { className: 'dshDeskOnbHint' }, t('desktopIntroFeedback'))
        )
      )
    }

    function ConnectModelPage({ t, models }) {
      return React.createElement(
        CardShell,
        { labelledby: 'dshDeskOnbStep1' },
        React.createElement(CardHeader, { id: 'dshDeskOnbStep1', title: t('step1Title'), lead: t('step1Lead') }),
        React.createElement(
          'div',
          { className: 'dshDeskOnbCardBody dshDeskOnbModelsHost' },
          React.createElement(ModelsSection, {
            controller: models.controller,
            useSnapshot: models.useSnapshot,
            operations: models.operations,
            schema: models.schema,
            t: models.t,
            renderSlot: () => null
          })
        )
      )
    }

    function FeaturesPage({ t, onOpenSettings }) {
      const features = [
        { id: 'market', icon: IconCordisFeatureIcon, title: t('featureMarketTitle'), desc: t('featureMarketDesc') },
        { id: 'ppt', icon: IconSparkle16, title: t('featurePptTitle'), desc: t('featurePptDesc') },
        { id: 'workspace', icon: IconFolderClose16, title: t('featureWorkspaceTitle'), desc: t('featureWorkspaceDesc') },
        { id: 'appearance', icon: IconGlobeOutline14, title: t('featureAppearanceTitle'), desc: t('featureAppearanceDesc') }
      ]
      return React.createElement(
        CardShell,
        { labelledby: 'dshDeskOnbStep2' },
        React.createElement(CardHeader, { id: 'dshDeskOnbStep2', title: t('step2Title'), lead: t('step2Lead') }),
        React.createElement(
          'div',
          { className: 'dshDeskOnbCardBody' },
          React.createElement(
            'div',
            { className: 'dshDeskOnbFeatures' },
            features.map((feature) =>
              React.createElement(
                'div',
                { key: feature.id, className: 'dshDeskOnbFeature' },
                React.createElement(
                  'span',
                  { className: 'dshDeskOnbFeatureIcon' },
                  React.createElement(feature.icon, { size: 16 })
                ),
                React.createElement(
                  'div',
                  null,
                  React.createElement('p', { className: 'dshDeskOnbFeatureTitle' }, feature.title),
                  React.createElement('p', { className: 'dshDeskOnbFeatureDesc' }, feature.desc)
                )
              )
            )
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dshDeskOnbLink', onClick: onOpenSettings },
            React.createElement(IconSettingsOutline16, { size: 14 }),
            React.createElement('span', null, t('openSettings'))
          )
        )
      )
    }

    function WorkspacePage({ t }) {
      return React.createElement(
        CardShell,
        { labelledby: 'dshDeskOnbStep3' },
        React.createElement(
          'div',
          { className: 'dshDeskOnbCardBody' },
          React.createElement(
            'div',
            { className: 'dshDeskOnbWorkspace' },
            React.createElement(
              'span',
              { className: 'dshDeskOnbWorkspaceArt' },
              React.createElement(IconFolderOpenOutline16, { size: 30 })
            ),
            React.createElement(
              'div',
              null,
              React.createElement(CardHeader, { id: 'dshDeskOnbStep3', title: t('step3Title'), lead: t('step3Lead') }),
              React.createElement('p', { className: 'dshDeskOnbHint' }, t('workspaceAction'))
            )
          )
        )
      )
    }

    function WizardFooter({ t, page, totalSteps, onBack, onSkipStep, onNext, onFinish }) {
      const last = page === totalSteps - 1
      return React.createElement(
        'div',
        { className: 'dshDeskOnbFooter' },
        React.createElement(
          'button',
          { type: 'button', className: 'dshDeskOnbGhost', onClick: onBack, disabled: page === 0 },
          t('previous')
        ),
        React.createElement('div', { className: 'dshDeskOnbSpacer' }),
        React.createElement(
          'button',
          { type: 'button', className: 'dshDeskOnbGhost', onClick: onSkipStep },
          t('skipStep')
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'dshDeskOnbPrimary', onClick: last ? onFinish : onNext },
          last ? t('startUsing') : t('next')
        )
      )
    }

    function SkipConfirmDialog({ open, t, onCancel, onConfirm }) {
      if (!open) return null
      return React.createElement(
        Modal,
        {
          open: true,
          title: t('skipConfirmTitle'),
          onClose: onCancel,
          closeLabel: t('skipConfirmCancel'),
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(Button, { variant: 'outline', onClick: onCancel }, t('skipConfirmCancel')),
            React.createElement(Button, { variant: 'primary', onClick: onConfirm }, t('skipConfirmAction'))
          )
        },
        React.createElement('p', null, t('skipConfirmDescription'))
      )
    }

    // ---------- the wizard component ----------

    function DesktopOnboardingWizard(props) {
      const { complete, openSection, t } = props
      const [page, setPage] = useState(0)
      const [wizardAcked, setWizardAcked] = useState(null) // null=loading, true, false
      const [skipDialogOpen, setSkipDialogOpen] = useState(false)
      const wizardScope = props.controller.scope
      const models = props.controller.models

      // Track whether the wizard has been completed/skipped at least once on
      // this browser; the actual durable ack is written by ackAndComplete.
      const finishedRef = useRef(false)

      const ackAndComplete = useCallback(() => {
        if (finishedRef.current) return
        finishedRef.current = true
        const scope = wizardScope.getSnapshot()
        const persist = scope.mode === 'memory'
          ? Promise.resolve()
          : wizardScope.set(WIZARD_ACK_FIELD, WIZARD_VERSION).catch(() => undefined)
        Promise.resolve(persist).finally(() => {
          complete()
        })
      }, [complete, wizardScope])

      // Subscribe to the durable ack so a re-run with a new version can re-show
      // the wizard without bouncing the user out of it on the first mount.
      useEffect(() => {
        let unsubscribe
        try {
          unsubscribe = wizardScope.subscribe(() => {
            const snap = wizardScope.getSnapshot()
            const persisted = snap.value?.wizardVersion
            // Exact-version comparison: bumping WIZARD_VERSION re-prompts the
            // wizard for users who acknowledged an older release.
            const acked = snap.mode === 'memory'
              ? false
              : persisted === WIZARD_VERSION
            setWizardAcked(acked)
          })
        } catch {
          // Scope errors are non-fatal: a failing scope must not block boot.
        }
        return () => { if (unsubscribe) unsubscribe() }
      }, [wizardScope])

      // Auto-complete when the durable ack (or current version) already covers
      // this wizard. First-run users see the wizard; returning users do not.
      useEffect(() => {
        if (wizardAcked === null) return
        if (wizardAcked === true) {
          finishedRef.current = true
          complete()
        }
      }, [wizardAcked, complete])

      // Nothing to render while the ack state is unknown.
      if (wizardAcked === null) return null

      const totalSteps = 4
      const stepLabels = [t('step0Title'), t('step1Title'), t('step2Title'), t('step3Title')]

      function gotoPage(next) {
        if (next < 0 || next >= totalSteps) return
        setPage(next)
      }

      function skipStep() {
        if (page < totalSteps - 1) setPage(page + 1)
        else ackAndComplete()
      }

      function openSettingsPanel() {
        ackAndComplete()
        if (typeof openSection === 'function') openSection('models')
      }

      return React.createElement(
        OnboardingSurface,
        null,
        React.createElement(
          'div',
          { className: 'dshDeskOnbRoot' },
          React.createElement(BrandHeader, { t, onSkipAll: () => setSkipDialogOpen(true) }),
          React.createElement(ProgressRail, { t, page, stepLabels }),
          page === 0
            ? React.createElement(DeclarationPage, { key: 'declaration', t })
            : page === 1
              ? React.createElement(ConnectModelPage, { key: 'connect', t, models })
              : page === 2
                ? React.createElement(FeaturesPage, { key: 'features', t, onOpenSettings: openSettingsPanel })
                : React.createElement(WorkspacePage, { key: 'workspace', t }),
          React.createElement(WizardFooter, {
            t,
            page,
            totalSteps,
            onBack: () => gotoPage(page - 1),
            onSkipStep: skipStep,
            onNext: () => gotoPage(page + 1),
            onFinish: ackAndComplete
          })
        ),
        React.createElement(SkipConfirmDialog, {
          open: skipDialogOpen,
          t,
          onCancel: () => setSkipDialogOpen(false),
          onConfirm: () => {
            setSkipDialogOpen(false)
            ackAndComplete()
          }
        })
      )
    }

    // ---------- composition ----------

    function apply(ctx) {
      installStyles()
      const t = ctx.locale.bind(NS)

      const wizardScope = ctx.settingsScope.bind({
        namespace: NS,
        decode: (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {})
      })

      // The same models stack the settings page runs on: identical store,
      // operations and schema helpers, so the wizard's first step *is* the
      // product model configuration rather than a parallel implementation.
      const modelsSchema = createSettingsSchemaOperations(ctx.settingsSchema)
      const modelsOperations = createModelsOperations(ctx)
      const modelsController = new ModelsSettingsStore(ctx, modelsSchema, ctx.settingsScope.describe())
      const models = {
        controller: modelsController,
        operations: modelsOperations,
        schema: modelsSchema,
        t: ctx.locale.bind(MODELS_NS),
        useSnapshot: createSnapshotHook(modelsController.store)
      }

      // Keep the wizard's store in lockstep with the settings page: the same
      // push events the settings section subscribes to also refresh this
      // controller, otherwise saves made inside the wizard would look stale
      // until the page remounts.
      ctx.effect(() => {
        const refreshModels = () => {
          try {
            modelsPackage.refreshIfLoaded(modelsController)
          } catch {
            // A refresh failure is non-fatal; the store keeps its last state.
          }
        }
        const disposers = [
          ctx.remote.$on('settings/document-updated', refreshModels),
          ctx.remote.$on('credentials/reference-updated', refreshModels),
          ctx.remote.$on('llm/adapters-updated', refreshModels),
          ctx.on('connection/reset', refreshModels)
        ]
        return () => {
          for (const dispose of disposers) dispose()
        }
      }, 'dsh-desktop-onboarding: models store invalidations')

      ctx.locale.register(NS, { zh, en })

      const controller = {
        scope: wizardScope,
        models
      }

      // The stock welcome-notice / official-DeepSeek onboarding entries are
      // removed upstream by the settings-models patch (the desktop wizard owns
      // first-run), so this wizard registers under its own id — no shadowing.
      ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
        name: 'settings.onboarding',
        id: 'dsh-desktop-onboarding',
        order: 0,
        inject: () => ({ controller, t })
      }, DesktopOnboardingWizard))
    }

    const inject = [
      'slots',
      'locale',
      'remote',
      'remote.credentials',
      'remote.llm',
      'remote.settings',
      'settingsScope',
      'settingsSchema'
    ]

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
