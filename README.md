# Microsoft To Do for Obsidian

Your Microsoft To Do tasks, living inside your vault.

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
├──────────────────────────────────────────────┤
│  ⌄ LISTS                                     │
│  ☀  My Day        3    ⌂  Tasks          8   │
│  ☆  Important     2    ⚑  Flagged Emails 3   │
└──────────────────────────────────────────────┘
```

---

## What it is

An Obsidian plugin that puts Microsoft To Do in a panel next to your notes.

These are your real tasks, not a copy. Tick something off in Obsidian and it's ticked off on your phone a second later. Add a task here and it shows up in Outlook. It's the same account, the same lists, just a different window onto them.

## How it helps

**You stop losing tasks to the gap between apps.** You're writing notes and something occurs to you — a follow-up, a deadline, a thing you promised someone. Normally that means leaving Obsidian, finding the To Do app, and by then you've lost your place. Here it's one keystroke.

**Your notes can become tasks.** Highlight a line while writing and send it straight to a list. Or turn a whole note into a task — "finish this draft" — and the plugin attaches a link back, so tapping it on your phone opens that exact note.

**You can see what's due without switching context.** My Day and your lists sit in the sidebar while you work. No alt-tabbing to check whether something's due today.

**It stays out of the way.** No new format to learn, no files it writes into your vault, nothing to migrate. If you uninstall it tomorrow, your notes are exactly as they were and your tasks are all still in Microsoft To Do.

---

## Install

**1. Download** `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).

**2. Put them** in a folder called `microsoft-todo-obsidian` inside your vault:

```text
YourVault/.obsidian/plugins/microsoft-todo-obsidian/
```

`.obsidian` is hidden — paste the path into your file manager's address bar if you can't see it.

**3. Restart Obsidian**, then enable **Microsoft To Do** under **Settings → Community plugins**.

## Connect your account

Microsoft requires any app that touches your tasks to be registered with them. It's free, takes about two minutes, and you only do it once. The upside is that your tasks go straight between Obsidian and Microsoft — nothing passes through anyone else's server.

1. Open [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **New registration**.
2. Name it anything. Leave **Redirect URI** empty. Click **Register**.
3. Copy the **Application (client) ID** shown on the next page.
4. Open **Authentication**, scroll to the bottom, set **Allow public client flows** to **Yes**, and save.
5. Open **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → add **`Tasks.ReadWrite`**.

Then in Obsidian: **Settings → Microsoft To Do**, paste the ID, click **Connect Microsoft account**, and enter the short code it gives you in your browser.

> Steps 4 and 5 are the ones people skip. Without them Microsoft refuses the sign-in.

*Work or school account? Your IT department may need to approve step 5. Personal account? Set **Directory (tenant)** to `consumers`.*

---

## Using it

| To do this | Do that |
| --- | --- |
| Open the panel | Click the ✅ in the ribbon |
| Add a task | Type in the box at the top, press `Enter` |
| Complete or reopen | Click the circle |
| See details or notes | Click the task |
| Rename | Double-click the title |
| Set a due date | Click **Due date** → Today, Tomorrow, Next week, or pick one |
| Mark important | Click the star |
| Send a note as a task | Command Palette → *Add current note as task* |
| Send a highlight as a task | Select text → Command Palette → *Add selected text as task* |

Every command can take a keyboard shortcut in **Settings → Hotkeys**.

---

## How it's made

**TypeScript and React 18**, bundled into a single `main.js` with **esbuild**. React handles the panel; the Obsidian-facing parts — the view, commands, ribbon and settings — are plain TypeScript against Obsidian's own API, so the plugin behaves like a native part of the app rather than a webpage embedded in one.

Tasks come from the **Microsoft Graph API**, the same service the official To Do apps use. Sign-in uses OAuth **device code flow** — the one where you're given a short code to type into a browser. It's chosen because it needs no redirect URL and no client secret, which means it works identically on Windows, macOS and mobile, and there's no secret baked into a plugin anyone can read.

Everything renders from Obsidian's own CSS variables, so the panel follows your theme in light and dark without being told about it.

Prefer to build it yourself rather than download? `npm install && npm run build`.

---

## Good to know

**My Day works a little differently here.** Microsoft doesn't let outside apps read the real My Day list — it's the one part of To Do they keep closed. So this builds its own version: everything due today or overdue, across all your lists. Same idea, usually the same tasks, but it won't match the app exactly.

**Your sign-in is stored in your vault**, in the plugin's folder, unencrypted — Obsidian gives plugins nowhere safer to keep it. If your vault syncs to the cloud, that file goes with it. Signing out removes it.

**Markdown checkboxes aren't synced.** A `- [ ] task` in a note is still just text. Linking the two properly means handling conflicts, deletions and offline edits, and doing that badly loses people's data — so it's a deliberate next step rather than a missing feature.

---

MIT licensed. Not affiliated with or endorsed by Microsoft.
