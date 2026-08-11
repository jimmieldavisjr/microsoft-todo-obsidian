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

## What this is

A panel that sits beside your notes and shows your Microsoft To Do lists.

These are your real tasks — not a copy, not an import. Tick something off in Obsidian and it's ticked off on your phone a moment later. Add a task here and it turns up in Outlook. Same account, same lists, just another window onto them.

## What it's good for

**Catching things before they slip away.** You're deep in a note and something occurs to you — a follow-up, a deadline, something you promised someone. Normally that means leaving Obsidian, finding the To Do app, and losing your train of thought on the way back. Here it's a keystroke, and you never look up.

**Turning writing into work.** Highlight a sentence and send it to a list. Or send an entire note — "finish this draft" — and the task carries a link back, so tapping it on your phone opens that note in your vault.

**Seeing what's due while you work.** My Day and your lists stay in the sidebar. No switching windows to find out whether something's due today.

**Leaving no trace.** It doesn't write files into your vault or invent a new format. Uninstall it tomorrow and your notes are untouched, your tasks all still in Microsoft To Do.

---

## Getting it

In Obsidian: **Settings → Community plugins → Browse**, search for **Microsoft To Do**, and click **Install**, then **Enable**.

A ✅ appears in the left ribbon. Click it to open the panel.

## Signing in

Microsoft asks every app that touches your tasks to be registered with them first — this one included. It's free and you only do it once. Five steps, about two minutes:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**.
2. Give it any name you like. Leave **Redirect URI** blank. Click **Register**.
3. Copy the **Application (client) ID** from the page that appears.
4. Click **Authentication** in the left menu, scroll to the bottom, switch **Allow public client flows** to **Yes**, and save.
5. Click **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**, tick **`Tasks.ReadWrite`**, and add it.

Back in Obsidian: **Settings → Microsoft To Do**, paste the ID, click **Connect Microsoft account**, and type the short code it gives you into the browser window that opens.

> Steps 4 and 5 are the ones people skip, and Microsoft turns the sign-in away without them.

*Using a work or school account? Your IT department may need to approve step 5. On a personal Microsoft account, set **Directory (tenant)** to `consumers` in the plugin settings.*

---

## Using it

| To do this | Do that |
| --- | --- |
| Open the panel | Click the ✅ in the ribbon |
| Add a task | Type in the box at the top, press `Enter` |
| Complete or reopen | Click the circle |
| See details and notes | Click the task |
| Rename | Double-click the title |
| Set a due date | Click **Due date** → Today, Tomorrow, Next week, or pick one |
| Mark important | Click the star |
| Send a note as a task | Command Palette → *Add current note as task* |
| Send a highlight as a task | Select the text → Command Palette → *Add selected text as task* |

Any of these can be given a keyboard shortcut in **Settings → Hotkeys**.

---

## Your tasks and your privacy

Your tasks travel directly between Obsidian and Microsoft. There's no server in the middle, no account to create, and nothing is collected, logged or sent anywhere else — which is the reason for the registration step above: it connects you to Microsoft as *you*, rather than through somebody else's app.

Two honest caveats:

**Your sign-in is kept in your vault**, in the plugin's own folder, and it isn't encrypted — Obsidian doesn't give plugins anywhere safer to store it. If your vault syncs to a cloud service, that file travels with it. Signing out removes it.

**My Day works a little differently here.** Microsoft doesn't let outside apps read the real My Day list — it's the one part of To Do they keep closed off. So the plugin builds its own: everything due today or overdue, across all your lists. Same idea, usually the same tasks, but it won't match the app exactly.

And one thing it doesn't do yet: checkboxes written in your notes (`- [ ] like this`) stay as text. Linking those to real tasks means handling conflicts, deletions and offline edits, and doing it badly loses people's work — so it's being saved for its own release rather than rushed.

---

## Under the hood

Built with TypeScript and React, talking to Microsoft Graph — the same service the official Microsoft To Do apps use. The panel borrows its colours from your Obsidian theme, so it looks at home in light mode, dark mode, or whatever you've customised.

Free and open source under the MIT licence. The code is all here if you'd like to look, and issues and suggestions are welcome.

## If you find it useful

This is built and maintained in my own time, and it's free for everyone.

If it saves you some friction and you'd like to say thanks, you can [sponsor the project](https://github.com/sponsors/jimmieldavisjr). There's a ♥ next to the plugin in Obsidian's plugin list that goes to the same place.

Not into sponsoring? Starring the repo, reporting a bug, or telling someone who lives in both apps helps just as much.

---

Not affiliated with or endorsed by Microsoft. Microsoft To Do and Microsoft Graph are trademarks of Microsoft Corporation.
