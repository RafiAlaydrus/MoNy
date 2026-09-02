---
type: "query"
date: "2026-09-02T09:23:40.420552+00:00"
question: "Fix Settings not closing and disable accidental double-tap zoom."
contributor: "graphify"
outcome: "useful"
source_nodes: ["settingsPanel", "closeOverspend()", "syncViewport()"]
---

# Q: Fix Settings not closing and disable accidental double-tap zoom.

## Answer

Settings close now bypasses the delayed closing animation, so Done, close icon, Escape and backdrop removal happen synchronously. Viewport now caps zoom at 1 and disables user scaling, with touch-action manipulation as an extra double-tap guard. Released v1.33.0 with mmt-v60; tests passed.

## Outcome

- Signal: useful

## Source Nodes

- settingsPanel
- closeOverspend()
- syncViewport()