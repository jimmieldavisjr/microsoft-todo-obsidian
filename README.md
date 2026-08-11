# Microsoft To Do for Obsidian

Your Microsoft To Do tasks, living inside your vault.

Obsidian is where you think. Microsoft To Do is where the work goes. This plugin puts them in the same window, so a task you notice while writing a note doesn't have to survive a trip to another app to get captured.

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

Everything is real — the same tasks you see in the Microsoft To Do app on your phone. Tick something off here and it's ticked off there.

---

## What you can do

- **See all your lists and tasks** in a panel docked beside your notes.
- **Add, rename, complete and reopen tasks** without leaving Obsidian.
- **Set due dates and mark things important**, and read the notes attached to a task.
- **Turn a note into a task** — or highlight a line while writing and send just that.
- **Jump back to the note** a task came from, from inside Microsoft To Do.
- **Open it however you like** — ribbon icon, Command Palette, or your own keyboard shortcut.

The one thing it does *not* do is sync your Markdown checkboxes. `- [ ] something` in a note stays a note. See [Good to know](#good-to-know).

---

## Getting started

### 1. Install

Copy `main.js`, `manifest.json` and `styles.css` from a [release](../../releases) into:

```text
<your vault>/.obsidian/plugins/microsoft-todo-obsidian/
```

Restart Obsidian, then turn on **Microsoft To Do** in **Settings → Community plugins**.

### 2. Connect your Microsoft account

Microsoft requires every app that touches your tasks to be registered with them — including this one. It's free and takes about two minutes, and it means your tasks travel straight between Obsidian and Microsoft with nobody in between.

1. Open [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**.
2. Name it anything (`Obsidian To Do` works). Leave **Redirect URI** empty. Click **Register**.
3. Copy the **Application (client) ID** from the page that appears.
4. Go to **Authentication**, scroll to the bottom, and set **Allow public client flows** to **Yes**. Save.
5. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**, and add **`Tasks.ReadWrite`**.

Then in Obsidian: **Settings → Microsoft To Do**, paste the ID, and click **Connect Microsoft account**. You'll get a short code to enter in your browser. Your lists appear as soon as you're signed in.

> Steps 4 and 5 are the two people miss. Without them Microsoft turns the sign-in away.

*Using a work or school account? Your IT department may need to approve step 5. If it's a personal Microsoft account, you can set **Directory (tenant)** to `consumers` in the settings.*

---

## Using it

| To do this | Do that |
| --- | --- |
| Open the panel | Click the ✅ in the ribbon, or search "Microsoft To Do" in the Command Palette |
| Add a task | Type in the box at the top and press `Enter` |
| Complete or reopen | Click the circle |
| See details | Click the task |
| Rename | Double-click the title |
| Set a due date | Click **Due date** and pick Today, Tomorrow, Next week, or any date |
| Mark important | Click the star on the right |
| Send a note as a task | Command Palette → *Add current note as task* |
| Send a highlight as a task | Select the text → Command Palette → *Add selected text as task* |

Every command can be given a keyboard shortcut in **Settings → Hotkeys**.

When you send a note or a highlight to To Do, the plugin attaches a link back to the note. Clicking it from the Microsoft To Do app on any device opens that note in your vault.

---

## Settings worth knowing

- **Default view** — which list opens first, so the panel starts where you actually work.
- **Default list** — where tasks land when you send them from a note.
- **Auto-refresh** — check for changes every few minutes, or leave it manual.
- **Open on startup** — have the panel there waiting when Obsidian launches.

---

## Good to know

**My Day works a little differently here.** Microsoft doesn't let outside apps read the real My Day list — it's the one part of To Do they keep closed. So this plugin builds its own: everything due today or overdue, across all your lists. It's the same idea and usually the same tasks, but it won't match the app exactly, and adding something to My Day here won't add it there.

**Your sign-in is stored in your vault.** It sits in a file called `data.json` inside the plugin's folder, and it isn't encrypted — Obsidian doesn't give plugins anywhere safer to put it. If your vault syncs to a cloud service, that file goes along with it. Signing out removes it.

**Markdown checkboxes aren't synced.** A `- [ ] task` in a note is still just text. Connecting the two properly means solving conflicts, deletions, offline edits and duplicates, and doing it badly loses people's data. It's the natural next step for this plugin, but it deserves to be built carefully rather than bolted on.

**Tasks are ordered by due date**, then importance, then when you created them — not by the manual drag-order from the Microsoft apps, which isn't available to outside apps either.

---

## Building it yourself

```bash
npm install
npm run build
npm run install-to-vault -- "C:/path/to/your vault"
```

`npm run dev` rebuilds as you edit. Releases are cut by tagging a version (`git tag 1.0.1 && git push origin 1.0.1`), which builds and drafts a GitHub release automatically.

---

## License

MIT — see [LICENSE](LICENSE). Not affiliated with or endorsed by Microsoft.
