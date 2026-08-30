---
type: "query"
date: "2026-08-30T20:49:38.596620+00:00"
question: "for the activity find, instead of a card, make it a magnify glasses in top, left of history"
contributor: "graphify"
outcome: "useful"
source_nodes: ["historyToggle", "Modal action system", "renderSecondChoice()", "appView"]
---

# Q: for the activity find, instead of a card, make it a magnify glasses in top, left of history

## Answer

Expanded from graph vocabulary: [history, toggle, modal, render, view, settings]. Reused the existing modal action system and renderActivityFinder path. Moved the activity controls out of the Spending panel into a global modal, added a magnifying-glass trigger immediately before History, focus restoration, Escape/backdrop closing, responsive header spacing, tests, and mobile browser verification.

## Outcome

- Signal: useful

## Source Nodes

- historyToggle
- Modal action system
- renderSecondChoice()
- appView