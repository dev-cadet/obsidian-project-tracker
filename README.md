# Project Tracker

A Jira and GitHub inspired project tracker for Obsidian. Simplifying the complexity of a Jira workflow, while delivering the ease of a GitHub Project.

Boards, backlogs, saved views and per-project workflows — built entirely out of ordinary markdown notes that stay readable, searchable, and yours.

---

## Design philosophy

**Your vault is the database.** There is no sidecar store and no proprietary format. A project is a folder with a config note in it. A task is a note with frontmatter. Everything the plugin knows, it read out of your vault, and everything it writes, you can read back without it. Sync, Git, backups and every other plugin see exactly what Project Tracker sees.

**Configuration travels with the project.** A project's statuses, labels, custom fields and saved views live in that project's own config note, under plain markdown headings. Move the folder, and the whole workflow moves with it. Share the folder, and you have shared the workflow.

**Stock Obsidian, as far as it goes.** The interface is built from Obsidian's own components and design tokens, so it inherits your theme, your accent colour and your platform. It looks like part of the app on desktop, and like a mobile app on a phone — because it is using the same pieces the app is.

**As much process as you want, and no more.** A project can be four statuses and a board. Or it can be seven statuses with automatic transitions, overdue warnings, story points and a filtered backlog. The complexity is opt-in, per project, and hidden behind an Advanced toggle until you ask for it.

**Nothing happens behind your back.** Edits are written when you save them, timed status changes are a setting you turn on, and every change to a task is appended to a Change Log inside the note itself.

---

## Features

### Projects

- One page listing every project, with its colour, icon, description and a live count for each status.
- Drag to reorder the list — the ordering carries through to the sidebar dock automatically.
- Each project gets its own accent colour and icon, applied through the whole interface when you are inside it.
- Rename or move a project folder freely; the plugin follows it without a reload.

### Boards and tables

- **Saved views**, as many per project as you like, each with its own layout, filters, sort, grouping and columns.
- **Board layout** — columns are your statuses in the order you set them. Drag a card between columns to change its status.
- **Table layout** — group by status, by label, or not at all; sort on any field; choose exactly which columns appear.
- **Hide statuses from a view.** This is the Jira half of the idea: the board shows the work in flight, while the backlog and the archive live in their own table views instead of cluttering the board.
- **Filters** on status, label, priority, and dates — including relative windows like *within the last 7 days* or *older than 30 days*.
- A quick text filter across the top of every view, and a footer telling you how many tasks the current filters are hiding.
- On a phone, table views render as cards, still respecting the view's sort, grouping and column choices.

### Statuses

- Named, coloured and ordered. The order is the board.
- **Next status** — define the natural flow through your workflow.
- **Auto-advance** — move a task on once it has sat in a status longer than a duration you set.
- **Overdue warnings** — flag a task whose start or due date has passed while it sits in a given status.
- Renaming a status rewrites its key everywhere: on every task, and in every view filter that referred to it.
- Set a **status template** once in settings, and every new project starts from your workflow instead of the plugin's defaults.

### Tasks

- Title, status, priority flag, start date, due date, labels, parent task, description and notes.
- **Labels**, named and coloured, any number per task.
- **Custom fields** per project — text, list, number, checkbox, date or datetime, mirroring Obsidian's own property types, with optional defaults seeded into new tasks.
- Sub-tasks through a parent task link, shown on the card.
- Every edit appends a dated entry to the task's **Change Log**, in the note.
- Task notes are just notes. Write whatever else you want in them.

### Docks

- **Projects browser** — the project list, docked in a sidebar.
- **Task column** — one status of one project, pinned where you can see it. Each column keeps its own project, status and card settings, so you can open several and watch different things at once.

### Everything is a note

- A project is a folder containing a config note tagged `ProjectConfig`.
- A task is a note tagged `ProjectTask`, with its fields as frontmatter properties — so Obsidian's Properties panel, Bases, Dataview and plain search all see them.
- Project configuration sits under plain headings in the config note: *Project Title*, *Description*, *Status Config*, *Label Config*, *Board Config*, *Custom Fields*. Anything the configuration screens write, you can write by hand.
- Opt a note out with the `ProjectTrackerIgnore` tag, or document the format without indexing it using the `ProjectConfigIgnore` / `ProjectTaskIgnore` variants.

### Settings

- A default folder for new projects.
- Open new tasks in the editor, or stay on the board.
- Run timed status changes, or leave every transition manual.
- Keep project links repaired automatically.
- The status template used for every new project.

---

## Requirements

Obsidian 1.13.0 or later. Works on desktop and mobile.

---

## Screenshots

### Projects at a glance

Every project as a card in its own colour and icon, with its description and a live count for each status. Cards drag to reorder, and the ordering carries through to the sidebar dock. On the right, a docked task column pinned to one status of one project.

![The projects page](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Project_List.png)

### Board view

Columns are the project's statuses, in the order you set. Drag a card between them to change its status. Cards carry labels, start and due dates, the parent task and a priority flame — overdue dates in red. Statuses left out of this view stay off the board, and the footer says how many tasks the filters are hiding.

![A project board](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Board_View.png)

### Table view

The same project as a saved table view — here a bug list, grouped by status, sorted by due date. Each view picks its own grouping, sort field and columns, so a backlog, a bug queue and an everything list can sit side by side as tabs.

![A grouped table view](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Table_View.png)

### Editing a task

Title, status, priority, start and due dates, labels, parent task and description, plus whatever custom fields the project defines. Saving writes to the note's frontmatter and appends a Change Log entry. The button beside Save opens the underlying markdown note.

![The task editor](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Edit_Task_View.png)

### Statuses, as simple or as strict as you like

Each status has a name, a colour and a key, and dragging them sets the board's column order. Advanced mode adds the workflow: the next status in the flow, an auto-advance duration, and warnings for tasks whose start or due date has passed while they sit here. Renaming a status rewrites its key across every task and view filter that refers to it.

![Advanced status configuration](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Advanced_Status.png)

### Labels and custom fields

Labels are named and coloured, and a task can carry any number. Custom fields are stored in each task's frontmatter under the key you choose, in one of Obsidian's own property types — text, list, number, checkbox, date or datetime — with an optional default seeded into new tasks.

![Label and custom field configuration](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Custom_Fields.png)

### Start every project from your workflow

The status template in plugin settings is the JSON written into a new project's Status Config section. Set it once, and every project you create afterwards begins with your statuses, your colours and your transitions rather than the plugin's defaults.

![The status template in plugin settings](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Templateable_Design.png)

### Keep the work in view

Two docks, both pinnable anywhere Obsidian takes a leaf: the projects browser on the left, and a task column on the right showing a single status of a single project. Each column keeps its own project, status and card settings, so you can open as many as you need and keep an eye on them while you work in a normal note.

![Docked project list and task column](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Pinned_Docks.png)

### The project, as a note

The config note behind a project. Identity in frontmatter, and everything else under plain markdown headings. Every configuration screen in the plugin is a nicer way of editing this file, and you can always edit it directly instead.

![A project config note](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Markdown_File_Project.png)

### The task, as a note

Every field the plugin tracks is a real frontmatter property, custom fields included, so Obsidian's Properties panel, Bases, Dataview and plain search all see them. Description and Notes are ordinary markdown sections — write whatever else belongs in the task underneath.

![A task note](https://raw.githubusercontent.com/dev-cadet/obsidian-project-tracker/main/screenshots/Screenshot_Desktop_Markdown_File_Task.png)
