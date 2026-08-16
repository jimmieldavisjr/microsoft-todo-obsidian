# Microsoft To Do for Obsidian

An Obsidian plugin that displays your Microsoft To Do lists in a sidebar panel. You can create, edit, complete and delete tasks, and send notes or selected text to a list, without leaving your vault.

The plugin reads and writes your tasks directly through Microsoft Graph, which is the same service the official Microsoft To Do applications use. Changes made in Obsidian appear in Microsoft To Do and Outlook, and changes made there appear in Obsidian on the next refresh. The plugin does not store tasks in your vault or create any notes of its own.

## Requirements

- Obsidian 1.7.2 or later, on desktop or mobile.
- A Microsoft account with Microsoft To Do. Personal, work and school accounts are all supported.

## Features

- Browse every list in your Microsoft To Do account, with task counts.
- My Day and Important views spanning all lists.
- Create tasks with a due date, an importance flag and notes.
- Complete, reopen, rename and delete tasks.
- Create a task from the current note or from selected text, with an optional link back to the note.
- Manual refresh, refresh on open, and optional background refresh at a set interval.
- Interface styled with your Obsidian theme's colours.

## Installation

### From the community plugin directory

1. Open **Settings > Community plugins > Browse**.
2. Search for **Microsoft To Do**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/jimmieldavisjr/microsoft-todo-obsidian/releases/latest).
2. Create the folder `<vault>/.obsidian/plugins/microsoft-todo/` if it does not exist.
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin in **Settings > Community plugins**.

After installation, a check circle icon is added to the left ribbon. Select it to open the panel.

## Signing in

1. Select the ribbon icon, then select **Connect Microsoft account**.
2. Obsidian displays a short device code and opens the Microsoft sign-in page in your browser.
3. Enter the code, sign in to your Microsoft account, then close the browser tab.
4. Obsidian detects that sign-in is complete and loads your lists.

No additional configuration is required before signing in. The plugin includes its own Azure application registration.

If your organisation restricts unapproved third-party applications, an administrator may need to approve the application, or you can supply your own registration. See [Using your own Azure app registration](#using-your-own-azure-app-registration).

## The panel

The panel opens in the right sidebar. It can be moved to the left sidebar or to a tab.

**Header.** The name of the current list, a refresh button and a button that opens the plugin settings.

**Task entry.** A text field for new tasks. When the field is in use, a toolbar appears below it with a due date control, an importance toggle and, in the My Day and Important views, a list selector.

**Task list.** Open tasks, followed by a collapsed **Completed** group when completed tasks are present.

**List navigation.** My Day and Important, followed by every list in your account with its task count. The section can be collapsed. Below it, the plugin shows the time of the last sync and a link to Microsoft To Do on the web.

## Task actions

| Action                    | Method                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Open the panel            | Select the ribbon icon                                                                        |
| Change list               | Select a list in the list navigation                                                          |
| Add a task                | Type in the field at the top of the panel and press `Enter`                                   |
| Complete or reopen a task | Select the circle to the left of the title                                                    |
| Mark a task important     | Select the star                                                                               |
| Rename a task             | Double-click the title, or select the pencil                                                  |
| View task details         | Select the task title                                                                         |
| Set a due date            | Open the task, select **Due date**, then choose Today, Tomorrow, Next week or a specific date |
| Clear a due date          | Select **Remove due date** in the date menu, or select the cross on the date control          |
| Edit task notes           | Open the task, edit the notes field, then click outside it to save                            |
| Delete a task             | Open the task, select the delete icon, then confirm                                           |
| Refresh                   | Select the refresh button in the panel header                                                 |

`Escape` cancels the current menu, rename or draft task.

Task changes are applied to the panel immediately and sent to Microsoft in the background. If a request fails, the panel displays the reason with an option to retry, and the task reverts to its previous state.

## Commands

Each command can be assigned a keyboard shortcut in **Settings > Hotkeys**. In the Command Palette the commands are prefixed with **Microsoft To Do**.

| Command                   | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| Open                      | Opens and focuses the panel                          |
| Open My Day               | Opens the panel with the My Day view selected        |
| Add task                  | Opens a dialog for a title, list, due date and notes |
| Add selected text as task | Creates a task from the current editor selection     |
| Add current note as task  | Creates a task from the active note                  |
| Refresh                   | Retrieves the current tasks from Microsoft           |
| Sign in to Microsoft      | Starts sign-in. Available when signed out            |
| Sign out                  | Removes the stored sign-in. Available when signed in |

## Creating tasks from notes

**Add current note as task** uses the note name as the task title.

**Add selected text as task** uses the first non-empty line of the selection as the task title, and any remaining lines as the task notes. Markdown syntax is removed from the title, including list bullets, numbered list markers, headings, block quotes and task checkboxes.

Both commands can add a reference to the source note in the task notes. Two formats are available:

- An `obsidian://` link, which can be selected from the Microsoft To Do applications to open the note. This is the default.
- The vault path of the note as plain text.

The reference can be disabled in the settings. Each command can also be assigned its own target list, or left to use the default list.

## Settings

Open **Settings > Community plugins > Microsoft To Do**, or select the settings button in the panel header.

### Microsoft account

| Setting                 | Description                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application (client) ID | Optional. The plugin includes a registration, so this is not normally required. See [Using your own Azure app registration](#using-your-own-azure-app-registration).                                            |
| Directory (tenant)      | Optional. `common` accepts both personal and work or school accounts and is the default. Use `consumers` for personal accounts only, `organizations` for work or school accounts only, or a specific tenant ID. |
| Connection              | Connects or disconnects the account. Disconnecting removes the stored sign-in from this vault.                                                                                                                  |

Changing either the client ID or the tenant clears the stored sign-in, because the existing tokens belong to the previous configuration.

### Behaviour

| Setting                              | Description                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default view                         | The list shown when the panel opens: last used, My Day, Important, or the default list.                                                                                     |
| Default list                         | The list used for new tasks when no other list applies, including tasks created from the Command Palette.                                                                   |
| Open Microsoft To Do on startup      | Opens the panel in the sidebar when Obsidian loads.                                                                                                                         |
| Refresh when the panel opens         | Retrieves current tasks each time the panel is opened or revealed. Enabled by default.                                                                                      |
| Auto-refresh                         | Background refresh interval: off, 5, 15, 30 or 60 minutes. Refresh runs only while the panel is open.                                                                       |
| Load completed tasks                 | Retrieves completed tasks from Microsoft on refresh. Disabled by default. Tasks completed within Obsidian remain visible until the next refresh regardless of this setting. |
| Show task counts in the list sidebar | Loads every list on refresh so that counts, My Day and Important remain accurate. Disable it to reduce the number of requests if you have many lists.                       |

### Obsidian integration

| Setting                     | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Add a link back to the note | Adds a reference to the source note when a task is created from a note or selection. |
| Link style                  | Selects an `obsidian://` link or a plain vault path.                                 |
| List for selected text      | The target list for **Add selected text as task**.                                   |
| List for the current note   | The target list for **Add current note as task**.                                    |

## Privacy and data storage

Requests are made directly between Obsidian and Microsoft. There is no intermediate server, no account to create with the plugin, and no telemetry, analytics or logging of any kind.

Sign-in is handled by Microsoft. During sign-in you are shown a consent screen listing the access the plugin requests, which is your Microsoft To Do tasks and nothing else. Access can be revoked at any time at [My Apps](https://myapplications.microsoft.com/).

The sign-in token is stored in your vault at `.obsidian/plugins/microsoft-todo/data.json`. It is not encrypted, because Obsidian does not provide plugins with encrypted storage. If your vault is synchronised to another location, this file is included. Signing out deletes it.

## Limitations

**My Day is an approximation.** Microsoft Graph does not expose the My Day list to third-party applications. The plugin derives an equivalent view containing every task that is due today or overdue, across all lists. The contents usually match the Microsoft To Do applications but are not guaranteed to be identical. The Important view is derived in the same way, from tasks marked with high importance.

**Markdown checkboxes are not synchronised.** Checkboxes written in your notes, such as `- [ ] example`, remain plain text. Linking them to Microsoft To Do tasks requires handling edit conflicts, deletions and offline changes, and is planned as a separate release rather than included here.

**Task counts depend on a setting.** With **Show task counts in the list sidebar** disabled, only the selected list is loaded, so counts for other lists and for the My Day and Important views are not shown.

## Troubleshooting

**"Microsoft is treating this app registration as a confidential client."** Your registration does not permit public client flows. In the Azure portal, open the registration, go to **Authentication > Advanced settings**, set **Allow public client flows** to **Yes**, save, then connect again.

**"This app registration only accepts accounts from a single Microsoft directory."** The registration is single-tenant. Either set **Directory (tenant)** in the plugin settings to your organisation's tenant ID, or change the registration's supported account types to include any directory and personal Microsoft accounts.

**"That Microsoft account is not allowed to use this app registration."** The account belongs to a different directory from the one the registration permits. Sign in with an account from that organisation, or use your own registration.

**Sign-in is blocked by your organisation.** Some organisations do not permit unapproved third-party applications. Request approval from your administrator, or register your own application in your tenant.

**No lists appear after signing in.** Select the refresh button in the panel header. If the previously selected list has been deleted in Microsoft To Do, the panel reports this and another list can be selected.

Sign-in failures also write the message returned by Microsoft to the developer console, which can be opened with `Ctrl+Shift+I` or `Cmd+Option+I`. Include that message when reporting an issue.

## Using your own Azure app registration

This is required only if your organisation blocks unapproved applications, or if you prefer to use a registration that you control.

1. Open [Azure Portal > App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and select **New registration**.
2. Enter any name. Leave **Redirect URI** empty. Select **Register**.
3. Copy the **Application (client) ID**.
4. Open **Authentication**, set **Allow public client flows** to **Yes**, and save.
5. Open **API permissions**, select **Add a permission > Microsoft Graph > Delegated permissions**, and add **`Tasks.ReadWrite`**.

Enter the ID in **Settings > Microsoft To Do > Application (client) ID**, then connect. Clearing the field restores the included registration.

Steps 4 and 5 are required. Sign-in fails without them.

## Technical details

The plugin is written in TypeScript and React and calls the Microsoft Graph v1.0 To Do endpoints. The requested scope is `Tasks.ReadWrite`, together with `openid`, `profile` and `offline_access`.

Authentication uses the OAuth 2.0 device code flow. This flow requires no redirect URI and no client secret, so it behaves identically on desktop and mobile and does not require a client secret to be distributed with the plugin.

## Contributing and support

The source is available in this repository. Bug reports and feature requests can be submitted through [GitHub issues](https://github.com/jimmieldavisjr/microsoft-todo-obsidian/issues).

The plugin is free and is developed outside working hours. If you wish to support its development, sponsorship is available at [GitHub Sponsors](https://github.com/sponsors/jimmieldavisjr). The heart icon beside the plugin in Obsidian's plugin list links to the same page.

## Licence

MIT. See [LICENSE](LICENSE).

## Trademarks

This project is not affiliated with or endorsed by Microsoft. Microsoft To Do and Microsoft Graph are trademarks of Microsoft Corporation.
