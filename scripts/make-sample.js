// Builds the sample job in examples/: a made-up site works job that uses every part of
// the app, saved both as a Job Costing file and as the app's Excel export.
//
// usage: node scripts/make-sample.js   (the release workflow runs it, so the sample
// always matches the version it ships with)
const fs = require('fs');
const path = require('path');
const Calc = require('../src/calc');
const { exportWorkbook } = require('../src/excel');

const out = path.join(__dirname, '..', 'examples');
fs.mkdirSync(out, { recursive: true });

// Weekly figures that vary a little, without randomness (the file is the same every build).
const wobble = (base, i, spread) => Calc.round2(base + spread * Math.sin(i * 1.7) + (spread / 3) * Math.cos(i * 0.9));

const job = {
  ...Calc.newJob(),
  jobName: 'Sample – Westgate Commercial Lot Site Works',
  jobNumber: 'JC-SAMPLE-001',
  client: 'Sample Developments Ltd.',
  address: '100 Example Road',
  notes: 'Sample job for trying Job Costing. Every name and figure is made up.\nHoldback of 10% is released 60 days after substantial completion.',
  overheadPercent: 12,
  holdbackPercent: 10,
  holdbackReceived: '',
  holdbackDue: '60 days after substantial completion',
  daysWorked: 64,
  daysRemaining: 30,
  materialsRemaining: 28000,

  // Approved quotes, each with its estimate (the Estimate page).
  quotes: [
    { description: 'Q-2041 – Site prep & excavation', amount: 186400, notes: 'Signed by owner',
      estCrew: 48000, estMaterial: 6500, estSub: 0, estGrading: 22000, estStone: 38500, estTrucking: 17800, estOverhead: 16000 },
    { description: 'Q-2042 – Underground services', amount: 142750, notes: '',
      estCrew: 41000, estMaterial: 37200, estSub: 12500, estGrading: 4000, estStone: 9800, estTrucking: 6200, estOverhead: 12500 },
    { description: 'Q-2043 – Paving & curbs', amount: 218900, notes: 'Paving by subcontractor',
      estCrew: 36500, estMaterial: 21000, estSub: 74000, estGrading: 14500, estStone: 26000, estTrucking: 9000, estOverhead: 18500 },
    { description: 'Q-2044 – Landscaping & fencing', amount: 64300, notes: '',
      estCrew: 14000, estMaterial: 22000, estSub: 6000, estGrading: 3000, estStone: 4500, estTrucking: 2000, estOverhead: 5200 },
  ],
  changeOrders: [
    { description: 'CO-01 – Extra catch basin', amount: 8450, notes: 'Approved by email' },
    { description: 'CO-02 – Rock removal', amount: 12600, notes: 'Pending signature' },
  ],

  // Progress draws: the first three paid by the client.
  draws: [
    { drawNumber: '1', date: '2026-05-31', description: 'May progress – excavation', amount: 92400, paid: true, notes: 'Cheque 1182' },
    { drawNumber: '2', date: '2026-06-30', description: 'June progress – excavation & services', amount: 118650, paid: true, notes: 'EFT' },
    { drawNumber: '3', date: '2026-07-31', description: 'July progress – services', amount: 96300, paid: true, notes: 'EFT' },
    { drawNumber: '4', date: '2026-08-31', description: 'August progress – paving prep', amount: 74800, paid: false, notes: '' },
    { drawNumber: '5', date: '2026-09-30', description: 'September progress – base & curbs', amount: 61250, paid: false, notes: 'Submitted, awaiting approval' },
  ],

  // Weekly crew costs, linked to the estimate's Labour (Crew Cost + Grading Labour).
  labour: Array.from({ length: 13 }, (_, i) => ({
    date: `Week ${i + 1}`,
    description: ['Excavation crew', 'Pipe crew', 'Grading crew', 'Concrete & curb crew'][Math.min(3, Math.floor(i / 4))],
    amount: wobble(11600, i, 1400),
    estItem: 'labour',
  })).concat([{ date: 'Week 13', description: 'Site supervisor (not in estimate)', amount: 4200, estItem: '' }]),

  // Trucking is linked; machine rentals aren't an estimate line, so they show as not linked.
  equipment: [
    ...Array.from({ length: 6 }, (_, i) => ({ date: `Month ${Math.floor(i / 2) + 1}`, description: 'Tandem dump trucks', amount: wobble(6100, i, 700), estItem: 'estTrucking' })),
    { date: 'May', description: 'Excavator rental', amount: 9800, estItem: '' },
    { date: 'June', description: 'Excavator rental', amount: 9800, estItem: '' },
    { date: 'July', description: 'Plate compactor rental', amount: 1450, estItem: '' },
  ],

  // Supplier and subcontractor invoices, some paid, each linked to an estimate item.
  materials: [
    ...['A-1001', 'A-1002', 'A-1003', 'A-1004', 'A-1005', 'A-1006', 'A-1007', 'A-1008'].map((inv, i) => ({ supplier: 'Sample Aggregates', invoiceNumber: inv, amount: wobble(6900, i, 1100), notes: '', paid: i < 5, estItem: 'estStone' })),
    ...['P-310', 'P-311', 'P-312', 'P-313'].map((inv, i) => ({ supplier: 'Sample Pipe & Supply', invoiceNumber: inv, amount: wobble(8200, i, 900), notes: i === 0 ? 'Storm pipe' : '', paid: i < 3, estItem: 'estMaterial' })),
    ...['C-77', 'C-78', 'C-79'].map((inv, i) => ({ supplier: 'Sample Ready Mix', invoiceNumber: inv, amount: wobble(3900, i, 500), notes: 'Curb concrete', paid: i < 1, estItem: 'estMaterial' })),
    { supplier: 'Sample Paving Co.', invoiceNumber: 'SP-2026-14', amount: 38500, notes: 'Subcontract – progress 1', paid: true, estItem: 'estSub' },
    { supplier: 'Sample Paving Co.', invoiceNumber: 'SP-2026-19', amount: 21750, notes: 'Subcontract – progress 2', paid: false, estItem: 'estSub' },
    { supplier: 'Sample Survey Ltd.', invoiceNumber: '5521', amount: 3600, notes: 'Layout survey', paid: true, estItem: 'estSub' },
    { supplier: 'Sample Fence Supply', invoiceNumber: 'F-90', amount: 6150, notes: '', paid: false, estItem: 'estMaterial' },
    { supplier: 'City Permits Office', invoiceNumber: 'PRM-448', amount: 1850, notes: 'Road occupancy permit', paid: true, estItem: '' },
  ],
};

(async () => {
  const clean = Calc.normalizeJob(job);
  fs.writeFileSync(path.join(out, 'Sample-Job.jobcost'), JSON.stringify(clean, null, 2) + '\n');
  await exportWorkbook(clean, path.join(out, 'Sample-Job.xlsx'), { name: 'Sample Construction Ltd.' });
  const t = Calc.totals(clean), e = Calc.estimates(clean), h = Calc.health(clean), f = Calc.forecast(clean);
  console.log(`examples/Sample-Job.xlsx and .jobcost: ${h.title}`);
  console.log(`  contract ${Calc.formatMoney(t.totalContract)}, billed ${Calc.formatPercent(t.billedPercent)}, costs ${Calc.formatMoney(t.totalCosts)}, profit to date ${Calc.formatMoney(t.profitToDate)}`);
  console.log(`  estimate used ${Calc.formatPercent(e.usedPercent)}, estimated profit ${Calc.formatMoney(e.total.profit)}, forecast profit ${Calc.formatMoney(f.profit)}`);
  for (const l of Calc.estimateByItem(clean).lines) console.log(`  ${l.name.padEnd(10)} est ${Calc.formatMoney(l.estimated).padStart(12)} actual ${Calc.formatMoney(l.actual).padStart(12)} ${Calc.formatPercent(l.usedPercent)}`);
  console.log(`  holdback held ${Calc.formatMoney(t.drawsHoldback)}, paid ${Calc.formatMoney(t.drawsPaid)}, outstanding ${Calc.formatMoney(t.drawsOutstanding)}`);
})();
