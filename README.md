# Job Costing

A desktop app for costing construction jobs, built on the layout of the
**Basic Tracker** spreadsheet template (`templates/Basic_Tracker_Template.xlsx`).

## What it tracks

The app has one screen per sheet in the template, plus Progress Draws:

| Screen | Template sheet | Columns |
| --- | --- | --- |
| Quotes & Change Orders | Approved Quotes | Quote / change order, Total, Notes |
| Progress Draws | Progress Draws *(added by the app)* | Draw #, Date Submitted, Description, Amount, Notes |
| Labour | Labour | Date(s), Description, Amount |
| Equipment | Equipment | Date(s), Description, Amount |
| Materials & Suppliers | Material and Supplier Invoices | Name, Invoice Number, Amount, Notes, plus totals per company |
| Summary | Total Breakdown | Live totals, overhead, contract value, projected profit, draws and profit to date |

The Summary uses the same math as the template's **Total Breakdown** sheet:

```
Total             = Labour + Equipment + Material and Supplier
Overhead          = Total × overhead %        (12% by default, editable per job)
Total Costs       = Total + Overhead
Total Contract    = Approved Quotes
Projected Profit  = Total Contract − Total Costs
Projected Margin  = Projected Profit ÷ Total Contract
```

Progress draws show what you've actually billed so far:

```
Draws Submitted   = sum of every progress draw entered
Billed to Date    = Draws Submitted ÷ Total Contract
Remaining to Bill = Total Contract − Draws Submitted
Profit to Date    = Draws Submitted − Total Costs
Margin on Draws   = Profit to Date ÷ Draws Submitted
```

Profit to Date is the main profit figure on the Summary. Projected Profit is what the
job makes once the whole contract has been billed. Draw amounts are the gross amount
of each billing as submitted (before any holdback).

As in the template, change orders are tracked on their own and are **not** added
to the Total Contract Value. Their total is shown separately on the Summary.

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

**Ready to run:** `dist/JobCosting-Portable.exe` is one **portable** file, so there's no
installer and nothing gets written to Program Files. Copy it anywhere and double-click it.

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

## Running from source

```bash
npm install
npm start
```

`npm run dist:mac` and `npm run dist:linux` build a macOS .dmg (run on a Mac) or a Linux AppImage.

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
