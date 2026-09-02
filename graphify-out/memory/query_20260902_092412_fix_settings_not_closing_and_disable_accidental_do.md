---
type: "query"
date: "2026-09-02T09:24:12.584485+00:00"
question: "Fix Settings not closing and disable accidental double-tap zoom."
contributor: "graphify"
outcome: "useful"
source_nodes: ["settingsPanel", "closeOverspend()", "syncViewport()"]
---

# Q: Fix Settings not closing and disable accidental double-tap zoom.

## Answer

Settings close now bypasses delayed closing animation, so Done, close icon, Escape and backdrop removal happen synchronously. Viewport caps zoom at 1 and disables user scaling with touch-action manipulation. The former accessibility test was intentionally updated for the explicit fixed-scale product choice. v1.33.0 and mmt-v60; full suite and checks passed.

## Outcome

- Signal: useful

## Source Nodes

- settingsPanel
- closeOverspend()
- syncViewport()