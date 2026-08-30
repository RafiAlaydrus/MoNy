# Graph Report - .  (2026-08-30)

## Corpus Check
- 24 files · ~113,552 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 373 nodes · 729 edges · 18 communities (14 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.81)
- Token cost: 14,700 input · 5,650 output

## Community Hubs (Navigation)
- App State and UI
- Shared Formatting Utilities
- Money Domain Logic
- Product Docs and Identity
- PWA Manifest Configuration
- Wallet Data and UI
- Charts and History
- App Integration Tests
- Categories and Undo
- Budget Cycle Lifecycle
- Import Validation
- Package Metadata
- Editing Workflows
- Money Unit Tests
- Offline Cache
- View and Tab Navigation
- Modals and Gesture Feedback
- Pull to Refresh

## God Nodes (most connected - your core abstractions)
1. `calculateRemaining()` - 19 edges
2. `cur()` - 17 edges
3. `esc()` - 16 edges
4. `checkCycleRollover()` - 16 edges
5. `fmt()` - 15 edges
6. `buildHistoryRow()` - 15 edges
7. `buildPriorityItem()` - 14 edges
8. `buildWalletSection()` - 14 edges
9. `Metallic finance growth app mark` - 14 edges
10. `deleteWalletItem()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Metallic finance growth app mark` --conceptually_related_to--> `MoNy Monthly Money Tracker`  [INFERRED]
  MoNy logo.png → README.md
- `iOS install and launch metadata` --references--> `MoNy 180-pixel app icon`  [EXTRACTED]
  index.html → icons/icon-180x180.png
- `iOS install and launch metadata` --references--> `MoNy 1125 by 2436 launch screen`  [EXTRACTED]
  index.html → icons/splash-1125x2436.png
- `iOS install and launch metadata` --references--> `MoNy 1170 by 2532 launch screen`  [EXTRACTED]
  index.html → icons/splash-1170x2532.png
- `iOS install and launch metadata` --references--> `MoNy 750 by 1334 launch screen`  [EXTRACTED]
  index.html → icons/splash-750x1334.png

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **MoNy four-tab application shell** — index_persistent_view_architecture, index_bottom_tab_navigation, readme_four_money_places [INFERRED 0.95]
- **MoNy responsive app icon family** — icons_icon_32x32_app_icon, icons_icon_72x72_app_icon, icons_icon_96x96_app_icon, icons_icon_128x128_app_icon, icons_icon_144x144_app_icon, icons_icon_152x152_app_icon, icons_icon_180x180_app_icon, icons_icon_192x192_app_icon, icons_icon_384x384_app_icon, icons_icon_512x512_app_icon [INFERRED 0.95]
- **MoNy iOS launch artwork family** — index_ios_install_metadata, icons_splash_750x1334_launch_screen, icons_splash_1125x2436_launch_screen, icons_splash_1170x2532_launch_screen [EXTRACTED 1.00]

## Communities (18 total, 4 thin omitted)

### Community 0 - "App State and UI"
Cohesion: 0.02
Nodes (116): addCategoryError, addCategoryModal, addCategoryNameInput, addCategoryTitle, addMoneyBtn, addPriorityBtn, addWalletBtn, addWalletError (+108 more)

### Community 1 - "Shared Formatting Utilities"
Cohesion: 0.13
Nodes (43): addSecondChoice(), allWallets(), animateMoneyTo(), askOverspend(), askWalletShortfall(), attachSwipeToDelete(), buildCarriedRow(), buildPriorityItem() (+35 more)

### Community 2 - "Money Domain Logic"
Cohesion: 0.14
Nodes (29): carryOverOf(), clampStartDay(), closingBalanceOf(), cycleEndOf(), cycleKeyOf(), cycleStartForDate(), cycleStartInMonth(), daysInMonth() (+21 more)

### Community 3 - "Product Docs and Identity"
Cohesion: 0.10
Nodes (23): MoNy 128-pixel app icon, MoNy 144-pixel app icon, MoNy 152-pixel app icon, MoNy 180-pixel app icon, MoNy 192-pixel app icon, MoNy 32-pixel app icon, MoNy 384-pixel app icon, MoNy 512-pixel app icon (+15 more)

### Community 4 - "PWA Manifest Configuration"
Cohesion: 0.10
Nodes (20): background_color, categories, description, dir, display, display_override, icons, id (+12 more)

### Community 5 - "Wallet Data and UI"
Cohesion: 0.16
Nodes (20): activeWallets(), buildTableToggle(), buildWalletSection(), confirmAddWallet(), ensureWalletData(), genWalletId(), getWalletAllocated(), getWalletBalance() (+12 more)

### Community 6 - "Charts and History"
Cohesion: 0.17
Nodes (18): buildHistoryRow(), bytesOfKey(), bytesOfString(), dayRangeLabel(), deleteArchivedMonth(), drawTrendChart(), fitCanvas(), fmtBytes() (+10 more)

### Community 7 - "App Integration Tests"
Cohesion: 0.15
Nodes (10): check(), month(), SETTINGS, APP_JS, bootApp(), HTML, KEYS, MONEY_JS (+2 more)

### Community 8 - "Categories and Undo"
Cohesion: 0.16
Nodes (15): allCategoryNames(), categoryNameConflict(), categoryUsageCount(), commitUndoEntry(), confirmAddCategory(), flushUndoStack(), renameCategory(), renderAllCategoryOptions() (+7 more)

### Community 9 - "Budget Cycle Lifecycle"
Cohesion: 0.15
Nodes (14): checkCycleRollover(), cycleLabel(), dismissOpenPrompts(), freshMonthData(), monthHasContent(), performRollover(), renderMonthLabel(), renderPriority() (+6 more)

### Community 10 - "Import Validation"
Cohesion: 0.42
Nodes (14): isFiniteAmount(), isNonEmptyString(), isRecord(), isValidStoredDate(), isValidYmd(), validateBillList(), validateCarryIn(), validateImport() (+6 more)

### Community 11 - "Package Metadata"
Cohesion: 0.20
Nodes (9): jsdom, description, devDependencies, jsdom, name, private, scripts, test (+1 more)

### Community 12 - "Editing Workflows"
Cohesion: 0.48
Nodes (7): cancelEdit(), dateInputValue(), editPriorityBill(), editSecondChoice(), isEditable(), renderCategoryOptions(), setFormEditing()

### Community 13 - "Money Unit Tests"
Cohesion: 0.50
Nodes (3): assertReconciles(), M, require

## Knowledge Gaps
- **163 isolated node(s):** `todayStr`, `corruptKeys`, `DEFAULT_CATEGORIES`, `data`, `monthText` (+158 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `todayStr`, `corruptKeys`, `DEFAULT_CATEGORIES` to the rest of the system?**
  _163 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App State and UI` be split into smaller, more focused modules?**
  _Cohesion score 0.015873015873015872 - nodes in this community are weakly interconnected._
- **Should `Shared Formatting Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.1273532668881506 - nodes in this community are weakly interconnected._
- **Should `Money Domain Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.14112903225806453 - nodes in this community are weakly interconnected._
- **Should `Product Docs and Identity` be split into smaller, more focused modules?**
  _Cohesion score 0.10276679841897234 - nodes in this community are weakly interconnected._
- **Should `PWA Manifest Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._