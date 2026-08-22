---
tags:
  - ProjectConfig
  - ProjectConfigIgnore
project-id: my-new-project
---
# Project Title
New project

# Description
My lovely new project.

# Notes
Just some general notes

# Status Config
```
# This is where the JSON configuration would store information on the status type configuration
{
	"status-options": {
		"bakclog": {
			"name": "Backlog",
			"color": "#FFFF",
			"kanban-visible": false,
			"next-status": "upcoming",
			"auto-stauts-change": null
		},
		"upcoming": {
			"name": "Upcoming",
			"color": "#FFFF",
			"kanban-visible": true,
			"next-status": "in-progress",
			"auto-stauts-change": null
		},
		"in-progress": {
			"name": "In Progress",
			"color": "#2124D",
			"kanban-visible": true,
			"next-status": "in-progress",
			"auto-stauts-change": null	
		},
		"complete": {
			"name": "Completed",
			"color": "#2124D",
			"kanban-visible": true,
			"next-status": "archived",
			"auto-stauts-change": "30d"
		},
		"archived": {
			"name": "Archived",
			"color": "#2124D",
			"kanban-visible": false,
			"next-status": null,
			"auto-stauts-change": null
		}
	}
}
```

# Board Config
```
# This is where the JSON configuration would store information on the Board options
{
	"default-view": "kandban" #kanban, table,
	"open-tasks-in-board": true // When a new task is created by command, navigate tot eh project page
}
```