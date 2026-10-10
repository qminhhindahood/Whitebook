# Implementation Plan: Whitebook UI Improvement & Feature Expansion

## Executive Summary
This plan details the full implementation of the requested UI improvements and new features for Whitebook in `D:\Notion\Whitebook-project`:
1. **Dashboard Live Countdown Clock**: Remove the hero illustration in the Dashboard banner and replace it with a real-time countdown clock in `day:hour:minute:second` format (`DD : HH : MM : SS`) targeting **7:45 AM GMT+7** on the learner's set exam date.
2. **SAT Test Dates Catalog & Year Toggle**: Remove anticipated dates and update official confirmed administrations from College Board. Add a toggle list for **2026** and **2027**.
3. **Flashcards Deck Folders & 30-Word Sub-Sets**:
   - Rename Anki set to `"aanhlle's sat words"`.
   - Organize each starter deck as a **Folder** containing a collection of maximum **30-words** flashcard sub-sets (`aanhlle's set 1..28`, `B2-C1 set 1..34`, `C1-C2 set 1..17`).
   - Fix and publish the 500 C1-C2 words collection from `"D:\Notion\library\sat\SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf"`.
4. **Study Plan UI Redesign**: Organize all elements as shown in the provided suggestion:
   - Top row: 4 summary metric tiles (`Completed attempts`, `Missed questions`, `Due cards`, `Score goal`).
   - 2-Column layout:
     - Left column: `Schedule` (Exam date with change button, study day pills with rest day summary, daily study time input, score goal input, "Update plan with AI" button).
     - Right column: `This Week's Plan` (Weekly progress bar, day-by-day task list with status dots, badges, action buttons, and reschedule banner).
5. **Stats Page (Beaverplans-style in Whitebook Design Kit)**:
   - Dedicated stats page showing overall completion metrics:
     - 4 top summary cards: `AVG COMPLETION`, `BEST WEEK`, `WEEK STREAK`, `WEEKS TRACKED`.
     - `WEEK BY WEEK` workload bar chart (bar height = total workload, fill = completed).
     - `ACTIVITY` 52-week contribution heatmap grid with `LESS` to `MORE` matcha scale.
     - `FOLLOW-THROUGH` day-of-week bar chart (% completion by day of week).
     - `DISTRIBUTION` day-of-week bar chart (% of completed tasks by day of week).
     - **Strict Design Kit Rule**: Built with Whitebook's paper/cream/matcha/rose aesthetic (NOT dark beaverplans).
6. **Separate SAT Result Tab & Interactive Improvements**:
   - Separate SAT Results into its own dedicated first-class tab in workspace navigation (`Official SAT`).
   - Section scores (`Reading and Writing` and `Math`) auto-calculate and update the `Total` score instantly.
   - Replace standard radio buttons with an **interactive 7-segment performance bar** where the learner can click/choose the segment line (bands 1 to 7), with score range labels matching the official College Board score report.

---

## User Review Required

> [!IMPORTANT]
> **Strict Adherence to Whitebook Design Kit**:
> The user explicitly instructed: *"these improvements need to follow our design kit, the images are just the ideas"*.
> - The Beaverplans-inspired Stats page will use Whitebook's paper textures (`#faf9f5`, `#fffefa`), matcha green fills (`#4c6243`, `#9eb084`), soft rose accents (`#d69199`), and Merriweather/Lora typography, rather than beaverplans' dark gray/orange theme.
> - The SAT score report card will follow the College Board structural layout while matching Whitebook's elegant warm editorial look.

> [!NOTE]
> **Clock Timezone Reference**:
> The countdown target instant is strictly computed as `${examDate}T07:45:00+07:00` (which is `00:45:00 UTC` on test morning). The clock ticks live every 1 second in the browser.

---

## System Architecture & Interaction Flow

```mermaid
graph TD
    subgraph Navigation & Workspace
        LeftRail[Left Sidebar Navigation] -->|Areas| DashboardArea[Dashboard Area]
        LeftRail -->|Areas| PlanArea[Study Plan Area]
        LeftRail -->|Areas| StatsArea[Stats Area (New)]
        LeftRail -->|Areas| ScoresArea[Official SAT Area (Separated)]
        LeftRail -->|Areas| CardsArea[Flashcards Area]
    end

    subgraph Dashboard
        DashboardArea -->|Replaces hero art| LiveClock[Live Countdown Clock (7:45 AM GMT+7)]
    end

    subgraph Study Plan & Stats
        PlanArea -->|Top Metric Tiles| SummaryTiles[4 Metric Cards: Completed, Missed, Due, Goal]
        PlanArea -->|Left Column| ScheduleConfig[Exam Date, Day Pills, Time, Score Goal]
        PlanArea -->|Right Column| WeekAgenda[This Week's Plan & Task Action List]
        StatsArea -->|Progress Analytics| WorkloadChart[Week-by-Week Workload Chart]
        StatsArea -->|Heatmap| ActivityGrid[52-Week Contribution Grid]
        StatsArea -->|Day Patterns| DayBars[Follow-Through & Distribution Bars]
    end

    subgraph Official SAT Results
        ScoresArea -->|Form Inputs| ScoreMath[RW & Math Inputs -> Auto Sum Total]
        ScoresArea -->|7-Segment Selector| InteractiveBars[Interactive 7-Block Domain Bars]
        ScoresArea -->|Score Card View| CollegeBoardCard[College Board Layout Card]
    end

    subgraph Flashcards & Vocabulary
        CardsArea -->|Folder View| DeckFolders[Starter Deck Folders]
        DeckFolders -->|Sub-Sets| Sets30[30-Word Sub-Sets: aanhlle, B2-C1, C1-C2]
    end
```

---

## Detailed Component Specifications

### 1. Dashboard Live Countdown Clock

#### Files:
- [satCountdown.ts](file:///D:/Notion/Whitebook-project/web/src/account/satCountdown.ts)
- [StudyWorkspace.tsx](file:///D:/Notion/Whitebook-project/web/src/account/StudyWorkspace.tsx)
- [workspace.css](file:///D:/Notion/Whitebook-project/web/src/account/workspace.css)

#### Implementation:
1. In `satCountdown.ts`, implement `satTimeRemaining(targetYmd, now = new Date())`:
   - Calculates milliseconds remaining until `${targetYmd}T07:45:00+07:00`.
   - Returns `{ days, hours, minutes, seconds, isPassed, isSet, targetInstant }`.
2. In `StudyWorkspace.tsx` (`StudyDashboard`):
   - Remove `<img className="hero-art" src={studyArt} ... />` and `<span className="hero-caption">...</span>`.
   - Create `<DashboardClock target={data.dates?.selection.primary} onDates={onDates} />`.
   - Ticks on a 1-second interval (`useEffect` with `setInterval`).
   - Renders 4 zero-padded tabular units (`DD`, `HH`, `MM`, `SS`) separated by `:` dividers with labels `DAYS`, `HOURS`, `MINS`, `SECS`.
   - Displays sub-badge: `Target: 7:45 AM GMT+7 on test day`.
3. Style in `workspace.css` with warm parchment background, crisp borders, and Lora serif typography.

---

### 2. Official SAT Test Dates Catalog & Year Toggle

#### Files:
- [satDates.ts](file:///D:/Notion/Whitebook-project/hosted/src/satDates.ts)
- [SatWeekend.tsx](file:///D:/Notion/Whitebook-project/web/src/account/SatWeekend.tsx)
- [SatWeekend.test.tsx](file:///D:/Notion/Whitebook-project/web/src/account/SatWeekend.test.tsx)
- [satDates.test.ts](file:///D:/Notion/Whitebook-project/hosted/test/satDates.test.ts)

#### Implementation:
1. In `hosted/src/satDates.ts`:
   - Remove the 8 anticipated dates.
   - Maintain the 8 confirmed administrations from College Board:
     - 2026: Aug 22, Sep 12, Oct 3, Nov 7, Dec 5
     - 2027: Mar 6, May 1, Jun 5
2. In `web/src/account/SatWeekend.tsx`:
   - Add state: `yearFilter: "all" | "2026" | "2027"`.
   - Render accessible filter pills at the top of the date list:
     - `All (8)`, `2026 (5)`, `2027 (3)`.
   - Filtering only controls the displayed rows; learner selections and primary target stay completely intact.
3. Update tests to verify toggle behavior and date count.

---

### 3. Flashcards Starter Deck Folders & 30-Word Sub-Sets

#### Files:
- [vocab/manifests/c1c2_wic500-manifest.json](file:///D:/Notion/Whitebook-project/vocab/manifests/c1c2_wic500-manifest.json)
- [vocab/manifests/c1c2_wic500-v1-cards.json](file:///D:/Notion/Whitebook-project/vocab/manifests/c1c2_wic500-v1-cards.json)
- [vocab/staging/c1c2_wic500.jsonl](file:///D:/Notion/Whitebook-project/vocab/staging/c1c2_wic500.jsonl)
- [build-deck-import.mjs](file:///D:/Notion/Whitebook-project/hosted/scripts/build-deck-import.mjs)
- [study.ts](file:///D:/Notion/Whitebook-project/hosted/src/study.ts)
- [FlashcardStudy.tsx](file:///D:/Notion/Whitebook-project/web/src/account/FlashcardStudy.tsx)

#### Implementation:
1. **Fix and Publish 500 C1-C2 Words**:
   - Update cards in `vocab/staging/c1c2_wic500.jsonl` and `vocab/manifests/c1c2_wic500-v1-cards.json` to `"review_status": "approved"`.
   - Update `c1c2_wic500-manifest.json` status to `"published"` with `approved_count: 500`.
   - Recalculate checksums and run `build-deck-import.mjs`.
2. **Rename Starter Deck**:
   - Rename `anki_starter` display title to `"aanhlle's sat words"`.
3. **Partition Decks into 30-Word Sets**:
   - In `hosted/src/study.ts`:
     - Allow `/api/cards/study/cards?deck=starter:anki_starter&set=1` (offset: `(set - 1) * 30`, limit: `30`).
     - In `/api/cards/study`, return sub-set arrays for each starter deck:
       - `anki_starter`: `aanhlle's set 1..28` (839 cards)
       - `b2c1_1000`: `B2-C1 set 1..34` (1,000 cards)
       - `c1c2_wic500`: `C1-C2 set 1..17` (500 cards)
4. **Folder UI in `FlashcardStudy.tsx`**:
   - Render starter decks as expandable/collapsible **Folders**.
   - Inside an expanded folder, display a grid of 30-word set cards with badge, due count, and `"Study set ↗"` button.

---

### 4. Study Plan UI Redesign (Matching Suggestion `media_1`)

#### Files:
- [PlanArea.tsx](file:///D:/Notion/Whitebook-project/web/src/account/PlanArea.tsx)
- [plan.css](file:///D:/Notion/Whitebook-project/web/src/account/plan.css)
- [PlanArea.test.tsx](file:///D:/Notion/Whitebook-project/web/src/account/PlanArea.test.tsx)

#### Layout & Visual Organization:
1. **Header Section**:
   - Title: `Study Plan`
   - Subtitle: `Weekly schedule · Exam on [Exam Date] · [Daily Minutes] min per day`
   - Top-right action buttons:
     - `Suggest` (outline button with sparkle icon, opens AI suggestions / assistant)
     - `+ Rebuild Plan` (solid matcha button, triggers rebuild)
2. **Top Metrics Row (4 Cards in a Row)**:
   - **Card 1 (Completed)**: Green circle check icon, `Completed`, big text: `[N] attempt(s)` (or completed tasks), subtext: `last on [Date]`.
   - **Card 2 (Missed)**: Warm amber alert icon, `Missed`, big text: `[N] questions`, subtext: `ready for review · Review →` (navigates to History).
   - **Card 3 (Due Cards)**: Blue cards icon, `Due Cards`, big text: `[N]`, subtext: `due now · Open` (navigates to Flashcards).
   - **Card 4 (Score Goal)**: Purple bullseye target icon, `Goal`, big text: `[N] SAT`, subtext: `target score`.
3. **2-Column Body Layout**:
   - **Left Column: Schedule**:
     - Card container with title `Schedule`.
     - Exam date row: `Exam date` | `[YYYY-MM-DD]` | `Change` button (invokes SAT Dates modal).
     - Study days selector:
       - Day pills: `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`.
       - Selected days: Solid matcha green pill.
       - Unselected days: Light border pill.
       - Subtext: `X days selected · rest on [Rest Days list]`.
     - Daily study time:
       - Input with clock icon prefix: `30 min` (or number input).
     - Score goal:
       - Number input: `1500`.
     - Action button:
       - Full-width solid green button: `Update plan with AI` (or Save & Rebuild).
       - Caption: `Plan is optimized using your recent practice and missed questions`.
   - **Right Column: This Week's Plan**:
     - Card container with title `This Week's Plan`.
     - Header row: `[Week Range] · [Done]/[Total] done`, right: `[Percent]% complete`.
     - Progress bar: Smooth rounded progress bar showing weekly completion.
     - Task List:
       - Daily task cards:
         - Status dot (green if done/today, gray if upcoming, amber if past due).
         - Header: `Today · [Date] · [Minutes] min` / `Tomorrow · [Date] · [Minutes] min`.
         - Badge on right: `Past due` (warm amber), `Upcoming` (light blue), `Done` (green).
         - Task title: e.g. `Review 20 due cards`, `Practice Math — August Math`.
         - Description: e.g. `1839 cards due — focus on missed questions`, `Baseline practice — no evidence yet`.
         - Action buttons:
           - Primary: `Open Flashcards` / `Open Practice` (solid matcha button).
           - Secondary: `Mark done` / `Skip` / `Move to next day` (outline buttons).
     - Reschedule notice banner:
       - At bottom of the list when `overdueCount > 0`:
       - Sparkle icon, `X past tasks can be rescheduled` -> `Review & reschedule →` button.

---

### 5. Stats Page (Beaverplans-Inspired in Whitebook Design Kit)

#### Files:
- [StatsArea.tsx](file:///D:/Notion/Whitebook-project/web/src/account/StatsArea.tsx) (NEW)
- [stats.css](file:///D:/Notion/Whitebook-project/web/src/account/stats.css) (NEW)
- [StudyWorkspace.tsx](file:///D:/Notion/Whitebook-project/web/src/account/StudyWorkspace.tsx)
- [AccountApp.tsx](file:///D:/Notion/Whitebook-project/web/src/account/AccountApp.tsx)

#### Aesthetics:
- Strictly conforms to Whitebook design kit:
  - Background: `--paper` (`#faf9f5`)
  - Cards: `--cream` / pure white (`#fffefa` / `#ffffff`), border: `1px solid #dce4ef` / `#c4cbb8`, radius: `16px`
  - Fills and active bars: Matcha green (`#4c6243`, `#9eb084`, `#88a86f`)
  - Accents: Rose / coral (`#d69199`) for busiest day or highlight streaks
  - Font: Lora serif for titles, Merriweather for body and labels

#### Analytics & Sections:
1. **Top Metrics Row (4 Cards)**:
   - `AVG COMPLETION`: Overall percentage (e.g. `12%`), caption: `X of Y task units`.
   - `BEST WEEK`: Best percentage achieved in a single week (e.g. `36%`), caption: `[Start Date] – [End Date]`.
   - `WEEK STREAK`: Number of consecutive weeks with at least 1 completed task (e.g. `2`), caption: `weeks streak` (or `no streak yet`).
   - `WEEKS TRACKED`: Total distinct weeks with planned/completed tasks, caption: `all-time`.
2. **Section 1: Week by Week Workload Chart**:
   - Header: `WEEK BY WEEK`
   - Subtitle: `Bar height is the week’s workload; the fill is what you completed`
   - Bar chart:
     - One bar per tracked week (up to last 12 weeks).
     - Outer container height represents relative workload (planned tasks).
     - Inner fill represents completed tasks in matcha green.
     - Percentage label and week date label beneath each column.
3. **Section 2: 52-Week Activity Heatmap Grid**:
   - Header: `ACTIVITY`
   - Subtitle: `X tasks completed in the last year`
   - Right-aligned legend: `LESS` [ ][ ][ ][ ] `MORE` using matcha color scale (`#f3f0e6`, `#d8e2cb`, `#b3caa0`, `#88a86f`, `#4c6243`).
   - GitHub/Beaverplans style contribution grid:
     - 52 columns of weeks.
     - 7 rows of days (M, T, W, T, F, S, S, with labels M, W, F, S).
     - Cell color shaded by count of completed tasks/attempts on that date.
     - Accessible tooltip on hover: `[N] tasks completed on [Date]`.
4. **Section 3: Follow-Through Day-of-Week Chart**:
   - Header: `FOLLOW-THROUGH`
   - Subtitle: `[Day] is your strongest day — [X]% of what you plan there gets done`
   - 7 vertical bars (Mon, Tue, Wed, Thu, Fri, Sat, Sun) showing the completion percentage of tasks scheduled on that day.
5. **Section 4: Distribution Day-of-Week Chart**:
   - Header: `DISTRIBUTION`
   - Subtitle: `[Day] is your busiest day — [X]% of everything you complete lands there`
   - 7 vertical bars (Mon, Tue, Wed, Thu, Fri, Sat, Sun) showing the proportion of all completed tasks that took place on each weekday. Highlights the busiest day in rose/coral (`#d69199`).

#### Navigation Integration:
- In `StudyWorkspace.tsx`:
  - Add `stats` to `Area`:
    ```typescript
    export type Area = "dashboard" | "library" | "practice" | "cards" | "history" | "progress" | "stats" | "plan" | "scores" | "tutor" | "settings";
    ```
  - Add `{ id: "stats", label: "Stats", icon: "chart" }` to `areas`.
  - In `PlanArea.tsx`, provide a quick top tab switcher between `Plan` and `Stats`.

---

### 6. Separate SAT Result Tab & Interactive Improvements

#### Files:
- [ScoresSection.tsx](file:///D:/Notion/Whitebook-project/web/src/account/ScoresSection.tsx)
- [ProgressArea.tsx](file:///D:/Notion/Whitebook-project/web/src/account/ProgressArea.tsx)
- [StudyWorkspace.tsx](file:///D:/Notion/Whitebook-project/web/src/account/StudyWorkspace.tsx)
- [AccountApp.tsx](file:///D:/Notion/Whitebook-project/web/src/account/AccountApp.tsx)
- [account.css](file:///D:/Notion/Whitebook-project/web/src/account/account.css)
- [ScoresSection.test.tsx](file:///D:/Notion/Whitebook-project/web/src/account/ScoresSection.test.tsx)

#### Improvements:
1. **Separate Workspace Tab**:
   - Remove `<ScoresSection />` from the bottom of `ProgressArea.tsx`.
   - Add `{ id: "scores", label: "Official SAT", icon: "award" }` to `areas` in `StudyWorkspace.tsx`.
   - In `AccountApp.tsx`, route `view === "scores"` directly to `<ScoresSection />`.
2. **Auto-Summing Section Scores into Total**:
   - In `ScoresSection.tsx`, update the form state handlers for Reading & Writing and Math:
     ```typescript
     function handleRwChange(rwVal: string) {
       const mathVal = form.math;
       const rwNum = Number(rwVal);
       const mathNum = Number(mathVal);
       const total = (!isNaN(rwNum) && !isNaN(mathNum) && rwVal && mathVal)
         ? String(rwNum + mathNum)
         : form.total;
       setForm({ ...form, readingWriting: rwVal, total });
     }

     function handleMathChange(mathVal: string) {
       const rwVal = form.readingWriting;
       const rwNum = Number(rwVal);
       const mathNum = Number(mathVal);
       const total = (!isNaN(rwNum) && !isNaN(mathNum) && rwVal && mathVal)
         ? String(rwNum + mathNum)
         : form.total;
       setForm({ ...form, math: mathVal, total });
     }
     ```
   - Total automatically updates as the learner types, while keeping the Total input editable if the user wants to adjust it manually.
3. **Interactive 7-Segment Performance Bar ("choose the line of it")**:
   - Replace the radio buttons `[-] [1]..[7]` with an interactive 7-segment bar matching College Board's official score report (`media_5`):
     - Each domain has a horizontal bar composed of 7 equal segmented blocks separated by clean vertical lines.
     - Hovering over a segment or dividing line previews the fill from 1 up to that segment.
     - Clicking segment $N$ sets the score band to $N$ and fills segments 1 through $N$ with matcha green (`#4c6243` / `#9eb084`).
     - Clicking the active segment again (or a clear button `—`) resets to `Not provided` (`null`).
     - Displays the authentic College Board performance range text:
       - Band 1: `200–370`
       - Band 2: `380–410`
       - Band 3: `420–480`
       - Band 4: `490–540`
       - Band 5: `550–600`
       - Band 6: `610–670`
       - Band 7: `680–800`
     - Accessible with keyboard navigation (arrow keys or clicking number indicators).
4. **Authentic College Board Score Card View**:
   - When displaying saved official SAT results, render an authentic College Board style card:
     - Left column: Large Total score (`1300`), score range, section scores (`Reading and Writing 620`, `Math 680`).
     - Right column: "Knowledge and Skills" 8-domain grid, with the 7-segment horizontal performance bars rendered visually.

---

## Verification Plan

### Automated Test Suites
1. **Hosted Vitest Tests**:
   ```powershell
   npx vitest run test/study.test.ts test/satDates.test.ts test/starterDeckImport.test.ts
   ```
   - Verify starter deck import includes all 3 decks (`anki_starter`, `b2c1_1000`, `c1c2_wic500`).
   - Verify `c1c2_wic500` is approved and published.
   - Verify `anki_starter` has title `"aanhlle's sat words"`.
   - Verify 30-word set filtering in `/api/cards/study/cards`.
2. **Web Vitest Tests**:
   ```powershell
   npx vitest run src/account/SatWeekend.test.tsx src/account/FlashcardStudy.test.tsx src/account/satCountdown.test.ts src/account/PlanArea.test.tsx src/account/ScoresSection.test.tsx
   ```
   - Verify `SatWeekend` year toggle (2026/2027) and confirmed dates.
   - Verify `FlashcardStudy` folder view and 30-word sub-set rendering.
   - Verify `satTimeRemaining` countdown logic.
   - Verify `PlanArea` renders top metrics, schedule config, and weekly task list.
   - Verify `ScoresSection` auto-calculates total from RW and Math, and interactive band selection.
3. **Build & Typecheck**:
   ```powershell
   npm run build:staging -w web
   npx wrangler deploy --dry-run
   ```

### Manual Visual Verification
1. **Dashboard**:
   - Verify hero illustration is replaced with live countdown clock.
   - Verify clock displays `DD : HH : MM : SS` ticking down to 7:45 AM GMT+7.
2. **SAT Dates**:
   - Verify toggle pills for `All`, `2026`, `2027` filter rows cleanly without losing selection.
3. **Flashcards**:
   - Inspect folders: `aanhlle's sat words` (28 sets), `B2-C1` (34 sets), `500 C1-C2 words` (17 sets).
   - Test expanding a folder and clicking `Study set ↗` for a 30-card batch.
4. **Study Plan**:
   - Verify 4 top metric cards: Completed attempts, Missed questions, Due cards, Goal.
   - Verify 2-column layout: Schedule on left (day pills, study time, score goal) and This Week's Plan on right (progress bar, tasks with badges, reschedule banner).
5. **Stats Page**:
   - Open `Stats` from left navigation.
   - Verify 4 summary cards: Avg completion, Best week, Streak, Weeks tracked.
   - Verify week-by-week workload bar chart, 52-week activity heatmap, follow-through bars, and distribution bars styled in Whitebook paper/matcha palette.
6. **Official SAT Results**:
   - Open `Official SAT` from left navigation.
   - Click "Add a result".
   - Type `620` in Reading & Writing and `680` in Math -> verify Total automatically shows `1300`.
   - Click segments on the 7-segment domain bars -> verify segments fill in matcha green and performance ranges display.
   - Save and verify the result renders with the College Board card presentation.
