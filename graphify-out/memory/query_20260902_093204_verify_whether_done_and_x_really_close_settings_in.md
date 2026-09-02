---
type: "query"
date: "2026-09-02T09:32:04.994128+00:00"
question: "Verify whether Done and X really close Settings in the current build."
contributor: "graphify"
outcome: "useful"
source_nodes: ["settingsPanel", "settingsToggle", "Modal action system"]
---

# Q: Verify whether Done and X really close Settings in the current build.

## Answer

Browser-tested the current build on a fresh localhost origin at phone size: Settings dialog opened, Done closed it, then Settings reopened and the Close settings icon closed it. The failure was only on the stale v1.25.1 PWA shell served on the cached 127.0.0.1 origin.

## Outcome

- Signal: useful

## Source Nodes

- settingsPanel
- settingsToggle
- Modal action system