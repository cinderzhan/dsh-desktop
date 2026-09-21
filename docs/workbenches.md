# Workbench market

DSH Desktop reads the published catalog from `https://market.dshdesktop.com/index.json`. Awesome owns market metadata and distribution discovery: repository identity, localized descriptions, screenshots, version, license, metrics and the selected npm, GitHub Release or source distribution. Desktop does not carry a second catalog, third-party tarballs or provider review metadata.

The host validates catalog protocol version 2, limits responses to 2 MB, applies a 10-second timeout and caches successful results for 15 minutes. A failed refresh may serve the last successful catalog as stale. The market can display and favorite remote entries even when their provider is not loaded. Installation from the catalog distribution is a separate host integration; until that exists, an unloaded entry opens its repository instructions and is never shown as installed.

A loaded provider registers its runtime ID and business component through `desktopWorkbenches.register`. To associate that runtime provider with an Awesome entry, its descriptor must expose the canonical GitHub repository URL in `repository`. Repository identity drives market cards and favorites; the runtime ID drives installed state, navigation and session ownership. Loaded providers absent from Awesome remain available locally.

The host stores `desktop-workbenches/state.json` under the active DSH home. Version 1 records added, pinned and favorite IDs, foreground workbench, session bindings, recent sessions and notes. Removing a workbench keeps its conversations, project files, notes and favorites. Only explicitly opened bound sessions route to a workbench; native workspace navigation and New Session remain ordinary and unbound.

## Author and submission flow

Users open **Make my workbench** from a separate action beside the three collection tabs: **Workbench market**, **Favorites**, and **Installed workbenches**. The UI guides three sequential steps: read the author guide and have the user's own Agent develop the workbench, have that Agent install it locally and confirm it opens, and submit it only when the user chooses to follow the Awesome repository requirements. Local use is a prerequisite for submission: review requires a workbench installed and verified on a real DSH Desktop version.

Two copyable prompts cover the Agent handoff. The development prompt asks the Agent to validate, install through an available project or plugin mechanism, and verify personal use. The submission prompt asks the Agent to publish through an available external source and prepare the first directory pull request. Both use the bundled author guide, require relevant tests and build plus `scripts/check-workbench-package.mjs` when available, and ask the user only for metadata or authorization that cannot be verified from the project.

The first listing adds one `data/workbenches/owner__repo.yml` record to `dataelement/awesome-dsh-workbench`; later package versions are discovered by catalog automation. Publishing prefers npm, then GitHub Release, then GitHub source. Desktop does not mirror public packages. A real pull-request URL is required before the Agent may report that a workbench was submitted, and a merged record visible in the public catalog is required before it may report that the workbench was listed.

Existing local submissions remain local drafts. Version-1 `pending` records migrate to version-2 `local-draft` records with a one-time exact metadata backup; package archives remain unchanged. Local drafts are never mixed into public market results and never imply that GitHub review has started.

The implementation is in `packages/dsh-desktop-workbenches/`. Run the focused checks with:

```sh
npx vitest run test/workbench-catalog.test.mjs test/workbench-client.test.mjs test/workbench-state.test.mjs test/workbench-navigation.test.mjs
```
