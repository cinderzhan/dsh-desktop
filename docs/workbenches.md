# Workbench market

DSH Desktop reads the published catalog from `https://market.dshdesktop.com/index.json`. Awesome owns market metadata and distribution discovery: repository identity, localized descriptions, screenshots, version, license, metrics and the selected npm, GitHub Release or source distribution. Desktop does not carry a second catalog, third-party tarballs or provider review metadata.

The host validates catalog protocol version 2, limits responses to 2 MB, applies a 10-second timeout and caches successful results for 15 minutes. A failed refresh may serve the last successful catalog as stale. The market can display and favorite remote entries even when their provider is not loaded. Installation from the catalog distribution is a separate host integration; until that exists, an unloaded entry opens its repository instructions and is never shown as installed.

A loaded provider registers its runtime ID and business component through `desktopWorkbenches.register`. To associate that runtime provider with an Awesome entry, its descriptor must expose the canonical GitHub repository URL in `repository`. Repository identity drives market cards and favorites; the runtime ID drives installed state, navigation and session ownership. Loaded providers absent from Awesome remain available locally.

The host stores `desktop-workbenches/state.json` under the active DSH home. Version 1 records added, pinned and favorite IDs, foreground workbench, session bindings, recent sessions and notes. Removing a workbench keeps its conversations, project files, notes and favorites. Only explicitly opened bound sessions route to a workbench; native workspace navigation and New Session remain ordinary and unbound.

The implementation is in `packages/dsh-desktop-workbenches/`. Run the focused checks with:

```sh
npx vitest run test/workbench-catalog.test.mjs test/workbench-client.test.mjs test/workbench-state.test.mjs test/workbench-navigation.test.mjs
```
