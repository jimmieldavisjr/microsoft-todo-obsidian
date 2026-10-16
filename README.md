# Microsoft To Do for Obsidian

**Your Microsoft To Do tasks, right inside Obsidian.**

See your lists, add and tick off tasks, and link tasks to your notes, without switching apps. Everything stays in sync with Microsoft To Do on your phone, on the web and in Outlook.

## What it does

- **Shows your To Do lists in Obsidian**: in the main window, in the right side panel next to your other tools, or both at once.
- **Lets you manage tasks**: add, complete, edit, move and delete them, with due dates, importance, subtasks, tags and notes.
- **Connects tasks to notes**: turn a note or some selected text into a task, attach notes to a task, and add task links to the note you're writing.
- **Stays in sync**: changes you make here show up in Microsoft To Do, and changes made there show up here.

## Features

- 📋 **All your lists**, plus smart views: My Tasks, Today, Important, Planned, Assigned to me and Flagged email
- ✅ **Quick task entry** with due dates and an importance star
- 🧩 **Subtasks, tags and notes** on every task
- 🔗 **Linked notes**: attach Obsidian notes to tasks and open them in one click
- 🔍 **Search** across every list, with filters for Today, Upcoming, Overdue and Completed
- 🎨 **Colours and icons** for your lists
- 🪟 **Main window or side panel**: the layout adapts to the space you give it
- 🌗 **Matches your theme**, light or dark, in your accent colour
- 📱 **Desktop and mobile**

## Getting started

1. Install **Microsoft To Do** from **Settings → Community plugins → Browse** in Obsidian, then turn it on.
2. Select the ✓ icon in the left ribbon and choose **Connect Microsoft account**.
3. Sign in with the short code Obsidian shows you. Your lists appear a moment later.

There's nothing to set up first. Personal, work and school Microsoft accounts all work.

## How you'll use it

**Keep it where it suits you.** Open Microsoft To Do in the main window when you're planning, or in the side panel to keep your tasks beside your notes while you write. You can have both open, and they always show the same tasks.

**Manage tasks at a glance.** Add a task in seconds, tick it off with one click, and star the ones that matter. Select any task to set a due date, break it into subtasks, add tags and notes, or move it to another list.

**Turn notes into tasks.** Make the note you're reading, or any text you highlight, into a task that links back to where it came from. Link a task into the note you're writing so you never lose track of it.

**Find anything fast.** Search every list at once, or filter to what's due today, coming up or overdue.

All actions are also in Obsidian's Command Palette under **Microsoft To Do**, and you can give any of them a keyboard shortcut.

## Good to know

- **"Today" isn't quite Microsoft's "My Day".** Microsoft doesn't share My Day with other apps, so Today shows everything due today or overdue instead.
- **Assigned to me** shows your Planner tasks (work and school accounts only), and is view-only.
- **List colours and icons** are saved in Obsidian only. They don't appear in the Microsoft apps.
- **Moving a task to another list** creates a fresh copy, so older links to that task stop working.
- **Checkboxes in your notes** are not synced with To Do.

## Privacy

The plugin talks directly to Microsoft. There's no middleman server, no extra account to create, and no tracking or analytics. It only asks for access to your tasks, and you can revoke that any time from your Microsoft account at [My Apps](https://myapplications.microsoft.com/).

Your sign-in is saved inside your vault's plugin folder. Keep that in mind if you share your vault. Signing out removes it.

The plugin only reads your notes for actions you choose:

- **Adding a note or selected text as a task** sends that note's title or the selected text to Microsoft To Do, with a link back to the note.
- **Linking a note to a task** lists the notes in your vault so you can pick one. A linked note's `description` or `summary` property then shows in the task's details.
- **Adding a task link to a note** inserts the link at your cursor. Nothing else in the note changes.
- **Copy buttons** (for the sign-in code and a task's link) write to your clipboard. The plugin never reads from it.

## Trouble signing in?

Some workplaces and schools only allow approved apps. If sign-in is blocked, ask your IT team to approve the app. If you manage your own Microsoft setup, you can also connect through your own Azure app registration in the plugin's settings.

For anything else, [open an issue on GitHub](https://github.com/jimmieldavisjr/microsoft-todo-obsidian/issues) and describe what happened.

## What's new

See [version updates](version-updates/) for what changed in each version. The latest is [1.0.6](version-updates/v1.0.6.md).

## Support

Found a bug or have an idea? Open a [GitHub issue](https://github.com/jimmieldavisjr/microsoft-todo-obsidian/issues).

The plugin is free and built in spare time. If it helps you, you can support it through [GitHub Sponsors](https://github.com/sponsors/jimmieldavisjr).

## Licence

MIT. See [LICENSE](LICENSE).

*Not affiliated with or endorsed by Microsoft. Microsoft To Do and Microsoft Graph are trademarks of Microsoft Corporation.*
