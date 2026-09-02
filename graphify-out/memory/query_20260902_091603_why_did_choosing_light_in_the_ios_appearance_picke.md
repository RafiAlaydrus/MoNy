---
type: "query"
date: "2026-09-02T09:16:03.038343+00:00"
question: "Why did choosing Light in the iOS appearance picker not update the interface?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["settingsPanel", "SETTINGS", "theme_color"]
---

# Q: Why did choosing Light in the iOS appearance picker not update the interface?

## Answer

The iOS native select picker may defer change until it closes. Appearance now responds to input and change, so Light applies immediately while the selection sheet remains open. Release bumped to v1.30.0 and mmt-v57.

## Outcome

- Signal: useful

## Source Nodes

- settingsPanel
- SETTINGS
- theme_color