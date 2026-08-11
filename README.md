# Microsoft To Do for Obsidian

Use Microsoft To Do as a task surface inside your vault. The plugin adds a dockable panel that talks to your account over Microsoft Graph, so you can browse lists, create and edit tasks, and push notes or selected text into To Do without leaving Obsidian.

```text
┌──────────────────────────────────────────────┐
│  ☀  My Day                          ⟳    ⚙  │
│     Monday, 10 August                        │
│  ─────────────────────────────────────────   │
│  +  Add a task                               │
│     [ 📅 Due date ]  [ ★ Important ]   [Add] │
├══════════════════════════════════════════════┤
│  ○  Finish WGU assignment                    │
│       📅 Yesterday   Tasks                ★  │
│  ○  Review internship material               │
│       📅 Today   School                      │
│  ○  Work on project                          │
│       📅 Today   Work                        │
│                                              │
│  ▸ Completed                             1   │
├──────────────────────────────────────────────┤
│  ⌄ LISTS                                     │
│  ☀  My Day                               3   │
│  ☆  Important                            2   │
│  ─────────────────────────────────────────   │
│  ⌂  Tasks                                8   │
│  ⚑  Flagged Emails                       3   │
│  ▤  Work                                 5   │
├──────────────────────────────────────────────┤
│  Synced just now        Open Microsoft To Do │
└──────────────────────────────────────────────┘
```

---

## Features

- **Dockable panel** in the Obsidian sidebar, themed with your vault's colours.
- **Lists and tasks** from Microsoft To Do, including shared and flagged-email lists.
- **Create, rename, complete, reopen and delete** tasks.
- **Due dates, importance and notes**, viewable and editable inline.
- **My Day and Important** smart views that span every list.
- **Ribbon icon** and **Command Palette** commands, all rebindable to your own hotkeys.
- **Send Obsidian content to To Do** — selected text or the current note, with a clickable link back to the note.
- **Manual and automatic refresh**, with optimistic updates so the UI never waits on the network.

---

## Requirements

- Obsidian 1.4.0 or later.
- A Microsoft account (personal, work or school) with Microsoft To Do.
- A free **Azure app registration** — see below. The plugin ships without a client ID on purpose: you connect to Microsoft through your own registration, so no third party sits between Obsidian and your tasks.

---

## 1. Register an Azure application

This takes about two minutes and is free. You only do it once.

1. Go to the [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**.
2. **Name**: anything, e.g. `Obsidian To Do`.
3. **Supported account types**: pick the one that matches the account you'll sign in with.
   - *Accounts in any organizational directory and personal Microsoft accounts* is the safe general choice.
4. Leave **Redirect URI** empty — the plugin uses the device code flow, which doesn't need one.
5. Select **Register**.
6. On the app's **Overview** page, copy the **Application (client) ID**.
7. Go to **Authentication** → scroll to **Advanced settings** → set **Allow public client flows** to **Yes** → **Save**.
   *This step is required.* Without it, Microsoft rejects the sign-in with `invalid_client` or `unauthorized_client`.
8. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → add **`Tasks.ReadWrite`**.
   `openid`, `profile` and `offline_access` are requested automatically at sign-in.
   - On a work or school account your tenant may require an administrator to grant consent.

Then, in Obsidian: **Settings → Microsoft To Do**, paste the **Application (client) ID**, and select **Connect Microsoft account**.

A dialog shows a short code. Copy it, open the sign-in page, paste the code, and sign in. The dialog closes itself and your lists load.

### Tenant setting

| Value | Use it for |
| --- | --- |
| `common` (default) | Personal *and* work/school accounts |
| `consumers` | Personal Microsoft accounts only |
| `organizations` | Work or school accounts only |
| A tenant GUID | One specific organisation |

---

## 2. Install the plugin

### From a release

Copy `main.js`, `manifest.json` and `styles.css` into:

```text
<your vault>/.obsidian/plugins/microsoft-todo-obsidian/
```

Then reload Obsidian and enable **Microsoft To Do** under **Settings → Community plugins**.

### From source

```bash
npm install
npm run build                       # typecheck + bundle to main.js
npm run install-to-vault -- "C:/path/to/your vault"
```

`install-to-vault` copies `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/microsoft-todo-obsidian/` for you. You can also set `OBSIDIAN_VAULT_PATH` instead of passing the path.

For development, `npm run dev` rebuilds `main.js` on save; pair it with the [Hot Reload plugin](https://github.com/pjeby/hot-reload) to skip restarting Obsidian.

Obsidian writes `data.json` alongside those files once you change a setting or sign in.

---

## Commands

All commands appear in the Command Palette under **Microsoft To Do**, and can be bound to hotkeys in **Settings → Hotkeys**.

| Command | What it does |
| --- | --- |
| `Open` | Opens or focuses the panel |
| `Open My Day` | Opens the panel on the My Day view |
| `Add task` | Dialog for a task title, list, due date and notes |
| `Add selected text as task` | First line of the selection becomes the title, the rest becomes the task's notes |
| `Add current note as task` | Note title becomes the task title |
| `Refresh` | Re-fetches lists and tasks |
| `Sign in to Microsoft` / `Sign out` | Connection management |

`Add selected text as task` strips Markdown list markers, checkboxes, headings and quote markers from the title, so selecting `- [ ] Email the registrar` creates a task called *Email the registrar*.

---

## Panel gestures

| Action | Result |
| --- | --- |
| Click the circle | Complete or reopen a task |
| Click a task title | Expand details (due date, importance, notes, delete) |
| Double-click a title, or click the pencil | Rename inline — `Enter` saves, `Escape` cancels |
| Type in the add box | `Enter` creates the task; focusing the box reveals due date and importance |

Creating a task inside **My Day** dates it today, and creating one inside **Important** flags it — otherwise it would vanish from the view you just created it in.

---

## Settings

**Microsoft account** — client ID, tenant, connection status, connect/disconnect.

**Behaviour**

- *Default view* — which list the panel opens on (last used, My Day, Important, or a chosen list).
- *Default list* — where Command Palette tasks go by default.
- *Open Microsoft To Do on startup* — reveal the panel when Obsidian loads.
- *Refresh when the panel opens*.
- *Auto-refresh* — off, or every 5–60 minutes while the panel is open.
- *Load completed tasks* — whether refreshes fetch completed tasks. Tasks you complete inside Obsidian stay visible until the next refresh either way.
- *Show task counts in the list sidebar* — loads every list on refresh so counts and smart views stay accurate. Turn it off if you have many lists and want fewer requests.

**Obsidian integration**

- *Add a link back to the note* — appends a reference to the source note when creating tasks from Obsidian.
- *Link style* — an `obsidian://` URI (clickable from the Microsoft To Do apps) or a plain vault path.
- Separate default lists for *selected text* and *current note* tasks.

---

## Known limitations

**My Day is derived, not synced.** Microsoft Graph does not expose To Do's My Day list — it isn't available as a `todoTaskList`, and there's no endpoint for adding or removing a task from it. ([Graph To Do overview](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0))

This plugin's **My Day** is therefore a client-side view of *every task due today or overdue, across all lists*. It's the closest faithful equivalent, but it will not match the My Day list in the Microsoft To Do apps, and adding a task to it here does not add it to My Day there. **Important** is derived the same way, from tasks marked high importance — that one does match, since importance is a real task property.

**Sign-in tokens live in `data.json`.** The refresh token is stored in the plugin's `data.json` inside your vault, unencrypted — Obsidian gives plugins no secure credential store. Anyone with read access to that file, including a vault sync service, can act on your To Do account. Use **Sign out** to remove it, and consider excluding `.obsidian/plugins/microsoft-todo-obsidian/data.json` from sync.

**No Markdown synchronisation.** Checkboxes in your notes are not linked to To Do tasks in either direction; see below.

**Task ordering** is computed locally (due date, then importance, then creation order) rather than mirroring To Do's manual ordering, which Graph does not expose.

---

## Architecture

```text
Obsidian  ──▶  MicrosoftTodoView  ──▶  components/*.tsx
                                            │
                                            ▼
                                       TaskService          state, cache, smart views
                                            │
                                            ▼
                                        TodoApi             task vocabulary → endpoints
                                            │
                                            ▼
                                      GraphClient           tokens, retries, paging
                                            │
                                            ▼
                                   Microsoft Graph  ──▶  Microsoft To Do
```

```text
src/
├── main.ts                        plugin lifecycle, commands, ribbon
├── errors.ts                      error taxonomy shared by every layer
├── auth/
│   ├── MicrosoftAuth.ts           device code flow, token refresh, persistence
│   └── DeviceCodeModal.ts         the sign-in dialog
├── graph/
│   ├── GraphClient.ts             HTTP, 401 retry, throttle backoff, paging
│   └── TodoApi.ts                 To Do endpoints
├── services/
│   └── TaskService.ts             observable state, optimistic mutations
├── views/
│   ├── MicrosoftTodoView.ts       dockable ItemView hosting React
│   └── AddTaskModal.ts            Command Palette task dialog
├── components/                    TodoPanel, TaskList, TaskItem, TaskDetails, AddTask
├── settings/MicrosoftTodoSettings.ts
├── types/microsoft-todo.ts
└── util/                          date and concurrency helpers
```

A few decisions worth knowing about:

- **Device code flow, not PKCE.** Obsidian has no redirect target that works on every platform — no loopback server on mobile, and `obsidian://` custom-scheme redirects need extra Azure configuration users get wrong. Device code needs no redirect URI and no client secret, which a distributed plugin could not keep anyway.
- **`requestUrl`, not `fetch`.** The Microsoft identity endpoints send no CORS headers for non-SPA clients, so a renderer `fetch` would be blocked before reaching Microsoft. Obsidian's `requestUrl` bypasses that entirely.
- **Due dates are calendar dates.** Graph wraps them in a `DateTimeTimeZone`, which is where most off-by-one-day bugs in To Do clients come from. The plugin writes midnight UTC and reads back only the `YYYY-MM-DD` portion, never letting a timezone shift it.
- **Optimistic mutations.** Completing or renaming updates the cache immediately and rolls back on failure, so the panel stays responsive on a slow connection.

---

## Error handling

Failures surface in the interface rather than the console:

| Situation | What you see |
| --- | --- |
| No client ID configured | Setup card in the panel, with a link to settings |
| Not signed in | Sign-in card |
| Session expired or revoked | Error banner with a **Reconnect** action |
| Graph unavailable, throttled, or offline | Banner with **Try again**; 429/503 responses are retried automatically with `Retry-After` backoff |
| Permission denied | Banner naming the missing consent |
| A task action fails | Notice, and the optimistic change is rolled back |
| One list fails to load | The other lists still render; the failure is reported |

---

## Roadmap

Deliberately out of scope for this release, and a separate subsystem rather than a follow-up tweak:

- **Markdown ↔ To Do synchronisation** — mapping `- [ ] Finish project` to a real task. This needs remote/local ID mapping, file watching, conflict resolution, duplicate and deletion detection, offline mutations, recurring tasks, and multi-vault/multi-device behaviour.
- **Note ↔ task relationships** — surfacing which note a task came from, and navigating back to it from the panel.
- Advanced task management: steps, reminders, recurrence editing, drag-to-reorder.

---

## Development

```bash
npm install
npm run dev          # watch build
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production bundle
```

---

## License

MIT — see [LICENSE](LICENSE).
