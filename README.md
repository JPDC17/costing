# Job Costing

A desktop app for costing construction jobs, built on the layout of the
**Basic Tracker** spreadsheet template (`templates/Basic_Tracker_Template.xlsx`).

## What it tracks

The app has one screen per sheet in the template:

| Screen | Template sheet | Columns |
| --- | --- | --- |
| Quotes & Change Orders | Approved Quotes | Quote / change order, Total, Notes |
| Labour | Labour | Date(s), Description, Amount |
| Equipment | Equipment | Date(s), Description, Amount |
| Materials & Suppliers | Material and Supplier Invoices | Name, Invoice Number, Amount, Notes, plus totals per company |
| Summary | Total Breakdown | Live totals, overhead, contract value, profit and margin |

The Summary uses the same math as the template's **Total Breakdown** sheet:

```
Total             = Labour + Equipment + Material and Supplier
Overhead          = Total × overhead %        (12% by default, editable per job)
Total Costs       = Total + Overhead
Total Contract    = Approved Quotes + Change Orders
Profit            = Total Contract − Total Costs
Margin            = Profit ÷ Total Contract
```

Note: the template has a Change Orders section but doesn't add it to the contract
value. The app **does** add approved change orders to the Total Contract Value.

## Features

- Spreadsheet-style entry: press **Enter** to move down or add a new row, use the
  arrow keys to move between rows, and **×** to delete a row (you can undo).
- Saves each job as a `.jobcost` file (Ctrl+S / Ctrl+O).
- **Export Excel** (Ctrl+E): writes a workbook in the template's layout with
  working formulas, so it still works as a tracker in Excel.
- **Import Excel** (Ctrl+I): loads a filled-in copy of the Basic Tracker
  template (or a workbook exported by this app).
- **Export PDF** (Ctrl+P): a printable cost report for the job.
- Asks before closing or opening another job if you have unsaved changes.

## Running it

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm start
```

## Building an installer

```bash
npm run dist:win     # Windows installer + portable .exe  (run on Windows)
npm run dist:mac     # macOS .dmg                          (run on a Mac)
npm run dist:linux   # Linux AppImage
```

Installers are written to `dist/`.

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
templates/           The original Basic Tracker template
test/                Unit tests
```
