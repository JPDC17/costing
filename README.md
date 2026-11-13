# Job Costing

A desktop app for costing construction jobs, built on the layout of the
**Basic Tracker** spreadsheet template (`templates/Basic_Tracker_Template.xlsx`).

## What it tracks

The app has one screen per sheet in the template, plus Progress Draws:

| Screen | Template sheet | Columns |
| --- | --- | --- |
| Quotes & Change Orders | Approved Quotes | Quote / change order, Total, Notes |
| Progress Draws | Progress Draws *(added by the app)* | Draw #, Date Submitted, Description, Amount, Paid, Notes |
| Profit Forecast | Total Breakdown *(forecast section)* | Days worked, days remaining, materials still to buy |
| Labour | Labour | Date(s), Description, Amount |
| Equipment | Equipment | Date(s), Description, Amount |
| Materials & Suppliers | Material and Supplier Invoices | Name, Invoice Number, Amount, Paid, Notes, plus totals per company |
| Summary | Total Breakdown | Live totals, overhead, contract value, contract profit, draws, profit to date and the forecast |

The Summary uses the same math as the template's **Total Breakdown** sheet:

```
Total             = Labour + Equipment + Material and Supplier
Overhead          = Total × overhead %        (12% by default, editable per job)
Total Costs       = Total + Overhead
Total Contract    = Approved Quotes
Contract Profit   = Total Contract − Total Costs (costs to date)
Contract Margin   = Contract Profit ÷ Total Contract
```

Progress draws show what you've actually billed so far:

```
Draws Submitted   = sum of every progress draw entered
Billed to Date    = Draws Submitted ÷ Total Contract
Remaining to Bill = Total Contract − Draws Submitted
Profit to Date    = Draws Submitted − Total Costs
Margin on Draws   = Profit to Date ÷ Draws Submitted
```

Profit to Date is the main profit figure on the Summary. Contract Profit is what the
job would make if the whole contract were billed and no more costs came in. Draw amounts are the gross amount
of each billing as submitted (before any holdback).

As in the template, change orders are tracked on their own and are **not** added
to the Total Contract Value. Their total is shown separately on the Summary.

### Paid tick boxes

Each progress draw has a **Paid** tick box for when the client has paid it, and each
supplier invoice has one for when you've paid it. The app totals them:

```
Paid by Client            = draws ticked Paid
Outstanding               = Draws Submitted − Paid by Client   (billed, not yet paid)
Unpaid Supplier Invoices  = supplier invoices not ticked Paid
```

These track cash only. Profit still counts every draw billed and every invoice received,
paid or not. In the Excel export the Paid column says **Yes**. To mark one paid in Excel,
type **Yes** (or Y, x or Paid, in any case) and the totals update; Import reads exactly
the same entries back, so Excel and the app always agree.

### Profit forecast

Enter the days worked so far and the days you expect are left (part days are fine).
The forecast carries labour and equipment forward at the same cost per day:

```
Labour per Day          = Labour to date ÷ Days Worked
Remaining Labour        = Labour to date × Days Remaining ÷ Days Worked   (rounded to the cent)
Remaining Equipment     = the same, for equipment
Forecast Total Costs    = (costs to date + remaining labour + remaining equipment
                           + materials still to buy) + overhead
Cost to Complete        = Forecast Total Costs − Total Costs to date
Forecast Profit         = Total Contract − Forecast Total Costs
Forecast Margin         = Forecast Profit ÷ Total Contract
```

Materials aren't spread over days, since deliveries are lumpy. Enter any you still expect
to buy in **Materials still to buy**. In the Excel export the three forecast inputs
are shaded cells: change them in Excel and the forecast recalculates.

## Features

- Spreadsheet-style entry: press **Enter** to move down or add a new row, use the
  arrow keys to move between rows, and **×** to delete a row (you can undo).
- Amounts that aren't a number are highlighted in red (they count as $0 until fixed),
  and saving or exporting reminds you about them.
- Each amount and the overhead are rounded to the cent the same way Excel's `ROUND`
  does, so the app and the exported spreadsheet always agree. (The original template
  keeps fractions of a cent in the overhead; the totals it displays are the same.)
- Saves each job as a `.jobcost` file (Ctrl+S, Save As Ctrl+Shift+S, Open Ctrl+O).
  Saving writes a temporary copy first, so a crash mid-save can't damage the file.
- **Export Excel** (Ctrl+E): writes a workbook in the template's layout with
  working formulas, so it still works as a tracker in Excel.
- **Import Excel** (Ctrl+I): loads a filled-in copy of the Basic Tracker
  template (or a workbook exported by this app). Other spreadsheets are refused
  rather than replacing your job with an empty one.
- **Export PDF** (Ctrl+P): a printable cost report for the job (summary, every line item
  including progress draws, company totals, page numbers).
- Asks before closing or opening another job if you have unsaved changes.

## Windows app (.exe)

**Download:** https://github.com/JPDC17/costing/releases/latest/download/JobCosting-Portable.exe

It's one **portable** file, so there's no installer and nothing gets written to Program Files.
Copy it anywhere and double-click it. Later versions install from inside the app (see Updates).

- It isn't signed (no paid code-signing certificate), so Windows SmartScreen will probably
  show an "unknown publisher" warning the first time. Click **More info → Run anyway**.
- It's about 90 MB because Electron includes its own copy of Chromium and Node.js, so it
  doesn't need a browser or anything else installed.

**Rebuild it after making changes** (needs [Node.js](https://nodejs.org) installed):

```bash
npm install
npm run dist:win
```

The new exe goes to `dist/JobCosting-Portable.exe`. The icon is `build/icon.ico`.

## Updates

From version 1.1.0 the app can update itself:

- A few seconds after it starts, the app quietly checks for a newer version. If there is
  one, an **Update to x.y.z** button appears in the top bar.
- You can also click **Version … · Check for updates** at the bottom of the sidebar, or
  **Help → Check for Updates…**.
- Updating offers to save your job, downloads the new exe, checks its size and SHA-256
  checksum, then closes the app. A small PowerShell script swaps the new exe in place of
  the old one and opens it again. If the swap can't be done (for example, the exe is in a
  read-only folder), the new version is opened from where it was downloaded instead.

**Publishing an update** (GitHub builds and publishes it for you):

1. Raise `"version"` in `package.json` (e.g. 1.2.0 → 1.3.0), commit and push.
2. Tag that commit with the same version and a short note of what changed, then push the tag:

   ```bash
   git tag -a v1.3.0 -m "What changed in this version"
   git push origin v1.3.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`) runs on a Windows machine:
   it runs the tests, tests the update swap in real Windows PowerShell, builds the exe and
   publishes a GitHub Release containing `JobCosting-Portable.exe` and `latest.json`. The
   tag's note is shown in the app's update prompt. Everyone's app then offers the update.

The app checks `https://github.com/JPDC17/costing/releases/latest/download/latest.json`
(set under `"updates"` in `package.json`). Exes are no longer committed to the repository,
so it doesn't grow with each version. Every push also runs the tests on Windows.

To build an exe locally without publishing anything: `npm run release` (writes `dist/` and
`latest.json`, which are not committed).

## Running from source

```bash
npm install
npm start
```

`npm run dist:mac` and `npm run dist:linux` build a macOS .dmg (run on a Mac) or a Linux AppImage.

## Your company name and logo

Open **Company & Logo** (bottom of the sidebar) to enter your company name, address,
phone, email and website, and upload a logo (PNG, JPG, SVG, GIF, WebP or BMP).
Empty margins around the logo are trimmed and large images are resized automatically.
These are saved on this computer for every job (in the app's settings folder) and
appear:

- in the top bar of the app;
- in the letterhead and footer of every **PDF report**;
- in the **Excel export**: company name and logo at the top of Total Breakdown, and
  in the printed page header of every sheet.

## The PDF report

A plain, traditional cost report: a letterhead (logo, company details, report date),
the job details, a summary statement of costs and of contract and billing, the profit
forecast, then every line item in ruled tables. Totals have a rule above and a double
rule below, as in accounts. No boxes or shading; black and grey on white. Column
headings repeat on each page, and the footer shows the company, job and page number.

## Look and feel

- Colours: charcoal #17191D, construction orange #FF9900, safety yellow #FFC928,
  white and steel grey #85898F (set once at the top of `src/renderer/styles.css`).
  Losses are shown in red.
- Font: Roboto Condensed, bundled in `src/renderer/fonts/` (Apache License 2.0), so
  the app and its PDF reports look the same on every computer.
- Icon: `build/icon.ico` (the exe) and `src/renderer/logo.png` (top bar and window).

## Tests

```bash
npm test
```

## Project layout

```
src/main.js          Electron main process: window, menus, file dialogs
src/preload.js       Safe bridge between the window and the main process
src/calc.js          Costing math (shared by the UI, the Excel export and the tests)
src/excel.js         Excel export/import in the template layout
src/renderer/        The user interface (HTML/CSS/JS)
build/               App icon used for the exe
dist/                Built Windows exe
templates/           The original Basic Tracker template
test/                Unit tests
```
