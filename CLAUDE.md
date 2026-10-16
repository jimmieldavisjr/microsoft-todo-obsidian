# Microsoft To Do for Obsidian

## Rule: the browser preview must always match the real plugin

`preview/` is a browser prototype of the plugin (`npm run preview` → http://localhost:5178/). It exists to visualise plugin UI changes, so it must never drift from what Obsidian actually shows.

- **Never fork UI into the preview.** It renders the real `src/components/*` and the real `styles.css`. Don't copy, restyle, or re-implement plugin components, markup, or CSS inside `preview/`. If something looks wrong in the preview, fix it in `src/` or `styles.css` so both change together.
- **Only the host is simulated.** `preview/src/obsidian-shim.ts` stands in for the `obsidian` module, `preview/src/fake-graph.ts` stands in for Microsoft Graph HTTP, and `preview/src/preview-host.ts` stands in for Obsidian's workspace and vault and for the plugin methods in `main.ts`. The real `TaskService`, `TodoApi` and `PlannerApi` run unchanged.
- **Keep the mirrors in sync in the same change:**
  - New `obsidian` import in UI code → add it to `obsidian-shim.ts`, using Obsidian's own markup and class names. The preview build fails on a missing export; treat that as the reminder.
  - New or changed `MicrosoftTodoPlugin` method or `ViewPreferences` field the components call → update `previewPlugin` in `preview-host.ts` to behave the same way as `main.ts`.
  - New Graph endpoint or field in `TodoApi`/`PlannerApi` → teach `fake-graph.ts` to answer it, and add demo data that exercises it.
  - New view placement or change to `MicrosoftTodoView.onOpen` → mirror it in `PluginView` in `preview/src/main.tsx`.
  - New Obsidian CSS variable used in `styles.css` → define it for both themes in `preview/preview.css`, using Obsidian's default-theme values.
- **Verify both.** After a UI change, run `npm run typecheck`, `npm run build` and `npm run preview:build`. Check the preview in both the main window and the side panel, in dark and light themes, and at narrow and wide side-panel widths (drag the resize handle).

## Project notes

- There are two view types that share one `TaskService`: the main window (`microsoft-todo-view`) and the right side panel (`microsoft-todo-sidebar`). Both render `TodoPanel`, and the layout adapts to width (`PanelState.ts`: wide / medium / narrow). Keep the two placements visually identical apart from what the width dictates.
- `styles.css` reads Obsidian theme variables only. Scope every rule as `.mstd-view .thing`.
