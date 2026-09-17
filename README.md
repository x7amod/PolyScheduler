# SCOptimizer Extension — Banner Schedule Optimizer

## Install
1. `chrome://extensions` → Developer mode ON
2. Load unpacked → select `extension/` folder
3. Pin SCOptimizer

## Workflow

### 1. Passive Capture
1. Login to `ban-reg.polytechnic.bh/StudentRegistrationSsb`
2. Search courses sequentially (e.g. IT7011, IT7013, IT7101). Each `GET /ssb/searchResults/searchResults` is intercepted by `src/content/interceptor-main.js` and merged dedup by CRN into `chrome.storage.local` (`src/storage/aggregate.js`)
3. Floating card bottom-right (`src/content/overlay.css`) shows `N sections • M courses • K kept`
   - Check courses to keep → **Keep Selected** (permanently removes unselected courses; persists until **Clear Data**)
   - `All` / `None` shortcuts
   - Tip is generic: `uncheck any courses you don't need`
   - Also available via popup `src/popup/popup.html` (Clear Data only — no export)

### 2. Optimize Wizard
Click **Optimize →** in the overlay (enabled after Keep Selected, or confirm to use all). Opens centered modal `src/content/optimizer-modal.js` + `optimizer-modal.css` — **consistent size** (`90vh` + `600px` min on desktop, responsive on mobile, backdrop) across all steps, with readable step navigation.

**Steps (with Back/Next navigation preserving state):**
- **1. Sections**: per-course section checkboxes (`Sec 1` not `001` — leading zeros removed, `fmtSec`), shows `Sec • CRN • tutor • 8:00 AM - 9:50 AM` (AM/PM everywhere). Default all kept; selection stored in `sectionKeepMap` per course
- **2. Time**: two inputs `Start hour` / `End hour` (e.g. `8` + `2` → `8:00 AM - 2:00 PM`). Blank = no filter. Default end `6:00 PM`
- **3. Ranking**: `Prefer fewer breaks` (default) vs `Prefer fewer days` (Breaks weighted `5×` / `50×` internally, no helper text shown)
- **4. Tutors**: per-course `Any tutor` / `Prefer` / `Must` rule with a tutor picker enabled for the last two — options reflect **trimmed** sections only (e.g. `Sara Almesaideen · sections 1, 3`). Must = hard filter, Prefer = `+10` bonus
- **Run Optimization**: incrementally searches combinations, filters time conflicts, scores, and shows the top 10 without materializing the full product. Very large searches are capped at 100,000 candidates to keep the browser responsive.

### 3. Results
- **Schedule header**: `Schedule # — Days: 4 — Breaks: 1:30 (duration)`
- **Grid**: `Time` (AM/PM) × `Sun-Thu` (`DAY_SHORT`). Each course is a **single merged cell** (`rowspan` by `ceil(duration/30)`) with its assigned palette color (10 light backgrounds `#DBEAFE` etc., dark text `#1f2328` for readability), `COURSE-1` (no leading zeros), tutor, room. Breaks longer than 10 minutes are shown as `—`; short breaks are visually compressed. Legend above grid maps course → color
- **Details**: each course on its **own line** (vertical stack), colored block with `COURSE-1 • tutor • CRN • Day 8:00 AM - 9:50 AM • Building Room`
- **Navigation**: `Back` works from Results → Tutors (and between all steps, preserving inputs), `Restart` returns to Sections. `save result as pdf` (on Results) opens a print-ready page → choose Save as PDF in browser print dialog. No JSON export buttons
- **Empty state**: `No valid schedules — try relaxing constraints/time.`

Engine: `src/content/optimizer-engine.js` (`window.SC_ENGINE`, `timeStr12` → `8:00 AM`, `formatDuration` for breaks, `DAYS_ORDER` Sun-Thu) and ES modules in `src/optimizer/` (shared logic)

## Persistence
`sc_aggregated` (`byCRN`, `coursesMeta`, `rawSearchCount`) + `sc_keptCourses` + `sc_excludedCourses` persist across restarts until **Clear Data** (overlay + popup) removes all keys. Courses removed with Keep Selected stay excluded from later captures, while newly searched courses can still be added.

## Verify
- Engine validated against `trimmed.json` (19 sections, 4 courses): `500` raw combos, `252` valid, top score `-40`
- Syntax checked (`vm.Script`), no export buttons, no leading zeros, AM/PM throughout
