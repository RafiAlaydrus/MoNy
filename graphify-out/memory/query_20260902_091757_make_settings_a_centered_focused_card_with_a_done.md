---
type: "query"
date: "2026-09-02T09:17:57.219704+00:00"
question: "Make settings a centered focused card with a Done close action."
contributor: "graphify"
outcome: "useful"
source_nodes: ["settingsToggle", "Modal action system", "settingsPanel"]
---

# Q: Make settings a centered focused card with a Done close action.

## Answer

Settings now uses the repository modal pattern: centered scrollable card, dimmed backdrop, initial focus, Done and close actions, backdrop click and Escape close. Updated release v1.31.0 with mmt-v58; regression suite and syntax checks passed.

## Outcome

- Signal: useful

## Source Nodes

- settingsToggle
- Modal action system
- settingsPanel