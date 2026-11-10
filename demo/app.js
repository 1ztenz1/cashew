/* CashewIQ — front-end prototype. All state is in-memory sample data. */
const M = MASTER;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LB = 0.45359237;
const r3 = n => Math.round(n * 1000) / 1000;
const kg = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-GB', {minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 3)}) + ' kg';
const pct = n => (n == null || !isFinite(n)) ? '—' : n.toFixed(1) + '%';
const gName = id => (M.grades.find(g => g.id === id) || {}).name || id;
const fName = id => (M.factories.find(f => f.id === id) || {}).name || id;
const cName = id => (M.customers.find(c => c.id === id) || {}).name || id;
const pkName = id => (M.packaging.find(p => p.id === id) || {}).name || id;
const packKg = id => { const p = M.packaging.find(x => x.id === id); return p.kg || p.lb * LB; };
const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'});
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ============================ ENGINE ============================ */
let S;
class BizError extends Error {}
const fail = m => { throw new BizError(m); };
let clock = '2026-11-09';
function newState() {
  return {shipments: [], receipts: [], batches: [], batchMoves: [], allocations: [], runs: [], lots: [], inspections: [],
    ledger: [], orders: [], reservations: [], packings: [], dispatches: [], audit: [], seq: {}};
}
const nextId = (p, w = 3) => { S.seq[p] = (S.seq[p] || 0) + 1; return p + String(S.seq[p]).padStart(w, '0'); };
function audit(action, entity, detail, actor) { S.audit.unshift({ts: clock, actor: actor || App.user(), action, entity, detail}); }
function led(lot, type, qty, ref) { S.ledger.push({id: S.ledger.length + 1, ts: clock, lot, type, qty: r3(qty), ref}); }

const E = {
  createShipment({ref, supplier, arrival, po, notes, expected}) {
    if (S.shipments.some(s => s.ref === ref)) fail('Shipment reference already exists');
    const sup = M.suppliers.find(s => s.id === supplier);
    const s = {ref, supplier, origin: sup.country, arrival, po, notes, expected, docs: ['Bill of lading', 'Phytosanitary cert.', 'Commercial invoice'], status: 'Arrived'};
    S.shipments.push(s); audit('Shipment created', ref, `${sup.name}, ${sup.country}`); return s;
  },
  postReceipt(shipRef, qty, loc, batchCode) {
    const sh = S.shipments.find(s => s.ref === shipRef);
    qty = +qty; if (!(qty > 0)) fail('Received quantity must be greater than zero');
    const grId = nextId('GR-DEMO-');
    const id = batchCode || nextId('RCN-DEMO-');
    if (S.batches.some(b => b.id === id)) fail('Duplicate posting blocked: batch ' + id + ' already exists');
    S.receipts.push({id: grId, ship: shipRef, qty, date: clock, loc});
    const b = {id, ship: shipRef, gr: grId, supplier: sh.supplier, origin: sh.origin, date: clock, original: qty, loc, qstatus: 'Accepted', price: (M.costing && M.costing.rcn[sh.origin]) || 1.45};
    S.batches.push(b);
    S.batchMoves.push({batch: id, type: 'RECEIPT', qty, ref: grId, ts: clock});
    sh.status = 'Received';
    audit('Goods receipt posted', grId, `${kg(qty)} → batch ${id}`); return b;
  },
  batchBal(id) {
    const mv = S.batchMoves.filter(m => m.batch === id);
    const rec = mv.filter(m => m.type === 'RECEIPT').reduce((a, m) => a + m.qty, 0);
    const alloc = mv.filter(m => m.type === 'ALLOCATE').reduce((a, m) => a + m.qty, 0);
    const cons = S.allocations.filter(a => a.batch === id).reduce((a, x) => a + x.consumed, 0);
    return {received: rec, allocated: alloc, unallocated: r3(rec - alloc), consumed: cons};
  },
  allocate(batchId, fac, qty) {
    qty = +qty; if (!(qty > 0)) fail('Allocation quantity must be greater than zero');
    const bal = E.batchBal(batchId);
    if (qty > bal.unallocated) fail(`Over-allocation blocked: only ${kg(bal.unallocated)} unallocated on ${batchId}`);
    const a = {id: nextId('ALC-'), batch: batchId, fac, qty, consumed: 0, date: clock, status: 'Open'};
    S.allocations.push(a); S.batchMoves.push({batch: batchId, type: 'ALLOCATE', qty, ref: a.id, ts: clock, fac});
    audit('Factory allocation', a.id, `${kg(qty)} of ${batchId} → ${fName(fac)}`); return a;
  },
  allocAvail(fac, batch) { return S.allocations.filter(a => a.fac === fac && a.batch === batch).reduce((s, a) => s + a.qty - a.consumed, 0); },
  calc(run) {
    const input = run.cons.reduce((a, c) => a + (+c.qty || 0), 0);
    const kernel = run.outputs.reduce((a, o) => a + (+o.qty || 0), 0);
    const other = run.other.reduce((a, o) => a + (+o.qty || 0), 0);
    const recovery = input > 0 ? kernel / input * 100 : null;
    const variance = input - kernel - other;
    const missing = M.outputTypes.filter(t => t.required && !run.other.some(o => o.type === t.id && +o.qty > 0)).map(t => t.name);
    return {input, kernel, other, recovery, variance, missing, complete: missing.length === 0};
  },
  saveRun(run) {
    if (!run.id) { run.id = run.code || nextId('PROD-DEMO-'); run.status = 'Draft'; S.runs.push(run); audit('Production run drafted', run.id, fName(run.fac)); }
    return run;
  },
  postRun(id) {
    const run = S.runs.find(r => r.id === id);
    if (run.status === 'Posted') fail('Run already posted (idempotent posting)');
    const c = E.calc(run);
    if (!(c.input > 0)) fail('Cannot post: raw input is zero');
    if (!c.kernel) fail('Cannot post: no grade outputs recorded');
    run.cons.forEach(x => { if (+x.qty > E.allocAvail(run.fac, x.batch) + 1e-6) fail(`Consumption of ${x.batch} exceeds ${fName(run.fac)} allocation`); });
    run.cons.forEach(x => { let left = +x.qty; S.allocations.filter(a => a.fac === run.fac && a.batch === x.batch).forEach(a => { const t = Math.min(left, a.qty - a.consumed); a.consumed += t; left -= t; if (a.consumed >= a.qty) a.status = 'Consumed'; }); });
    run.status = 'Posted'; run.postedAt = clock; run.lots = [];
    run.outputs.filter(o => +o.qty > 0).forEach(o => {
      const lot = {id: 'FG-' + run.id.replace('PROD-', '') + '-' + o.grade.replace('-', ''), run: run.id, grade: o.grade, fac: run.fac, qty: +o.qty, loc: 'WH-FG-1', date: clock, qc: 'Pending', batches: run.cons.map(c => c.batch)};
      S.lots.push(lot); run.lots.push(lot.id); led(lot.id, 'PRODUCE', lot.qty, run.id);
    });
    audit('Production posted', run.id, `${run.lots.length} finished lots created; recovery ${pct(c.recovery)}${c.complete ? '' : '; mass balance INCOMPLETE'} (A03–A06)`);
    return run;
  },
  bal(lotId) {
    const b = {produced: 0, released: 0, reserved: 0, packed: 0, dispatched: 0};
    S.ledger.filter(l => l.lot === lotId).forEach(l => {
      if (l.type === 'PRODUCE') b.produced += l.qty;
      if (l.type === 'RELEASE') b.released += l.qty;
      if (l.type === 'BLOCK') b.released -= l.qty;
      if (l.type === 'RESERVE') b.reserved += l.qty;
      if (l.type === 'UNRESERVE') b.reserved -= l.qty;
      if (l.type === 'PACK') { b.reserved -= l.qty; b.packed += l.qty; }
      if (l.type === 'DISPATCH') { b.packed -= l.qty; b.dispatched += l.qty; }
    });
    for (const k in b) b[k] = r3(b[k]);
    b.onhand = r3(b.produced - b.dispatched);
    b.available = r3(b.released - b.reserved - b.packed - b.dispatched);
    return b;
  },
  inspect(lotId, decision, results, comment, qty) {
    const lot = S.lots.find(l => l.id === lotId); const b = E.bal(lotId);
    const insp = {id: nextId('QC-DEMO-'), lot: lotId, decision, results, comment, inspector: App.user(), date: clock, qty: +qty || lot.qty};
    S.inspections.push(insp);
    if (decision === 'PASS') { const add = insp.qty - b.released; if (add > 0) led(lotId, 'RELEASE', add, insp.id); }
    else if (b.released - b.reserved - b.packed > 0) { if (b.reserved > 0) fail('Lot has active reservations — release them first'); led(lotId, 'BLOCK', b.released, insp.id); }
    lot.qc = decision;
    audit('Quality ' + decision, insp.id, `${lotId} (${gName(lot.grade)})`); return insp;
  },
  createOrder({cust, dest, ship, curr, lines, notes, code}) {
    if (!lines.length) fail('Add at least one order line');
    lines.forEach(l => { if (!(+l.qty > 0)) fail('Order line quantity must be > 0'); });
    const id = code || nextId('ORD-DEMO-');
    const o = {id, cust, dest, ship, curr, notes, date: clock, status: 'Draft', lines: lines.map((l, i) => ({id: id + '-L' + (i + 1), grade: l.grade, qty: +l.qty, pack: l.pack}))};
    S.orders.push(o); audit('Order created', id, `${cName(cust)} → ${dest}`); return o;
  },
  confirm(id) { const o = S.orders.find(x => x.id === id); o.status = 'Confirmed'; audit('Order confirmed', id, ''); },
  lineReserved(lineId) { return S.reservations.filter(r => r.line === lineId && r.status !== 'Released').reduce((a, r) => a + r.qty, 0); },
  suggest(line) {
    let need = line.qty - E.lineReserved(line.id);
    return S.lots.filter(l => l.grade === line.grade).map(l => ({lot: l, b: E.bal(l.id)}))
      .filter(x => x.lot.qc === 'PASS' && x.b.available > 0).sort((a, b) => a.lot.date.localeCompare(b.lot.date))
      .map(x => { const take = Math.max(0, Math.min(need, x.b.available)); need -= take; return {...x, take: r3(take)}; });
  },
  reserve(orderId, lineId, lotId, qty) {
    const o = S.orders.find(x => x.id === orderId); const line = o.lines.find(l => l.id === lineId); const lot = S.lots.find(l => l.id === lotId);
    qty = r3(+qty); if (!(qty > 0)) fail('Reservation quantity must be > 0');
    if (lot.qc !== 'PASS') fail(`Blocked: lot ${lotId} is ${lot.qc} — only quality-released stock can be reserved`);
    if (lot.grade !== line.grade) fail('Grade mismatch between lot and order line');
    const b = E.bal(lotId); // recheck inside "transaction"
    if (qty > b.available + 1e-6) fail(`Over-reservation blocked: only ${kg(b.available)} available on ${lotId}`);
    if (E.lineReserved(lineId) + qty > line.qty + 1e-6) fail('Reservation would exceed order line quantity');
    const r = {id: nextId('RSV-'), order: orderId, line: lineId, lot: lotId, qty, status: 'Active', date: clock};
    S.reservations.push(r); led(lotId, 'RESERVE', qty, r.id);
    if (o.lines.every(l => E.lineReserved(l.id) >= l.qty - 1e-6)) o.status = 'Reserved'; else o.status = 'Partly reserved';
    audit('Stock reserved', r.id, `${kg(qty)} of ${lotId} → ${orderId}`); return r;
  },
  unreserve(rid) {
    const r = S.reservations.find(x => x.id === rid); if (r.status !== 'Active') fail('Reservation not active');
    r.status = 'Released'; led(r.lot, 'UNRESERVE', r.qty, r.id);
    const o = S.orders.find(x => x.id === r.order); o.status = 'Confirmed'; audit('Reservation released', rid, '');
  },
  pack(orderId, centre, operator) {
    const o = S.orders.find(x => x.id === orderId);
    if (S.packings.some(p => p.order === orderId)) fail('Order already packed');
    if (o.status !== 'Reserved') fail('Order must be fully reserved before packing');
    const p = {id: nextId('PCK-DEMO-'), order: orderId, centre, operator: operator || App.user(), date: clock, lines: [], status: 'Packed'};
    o.lines.forEach(l => {
      const pk = packKg(l.pack); const full = Math.floor(l.qty / pk + 1e-9); const rem = r3(l.qty - full * pk);
      S.reservations.filter(r => r.line === l.id && r.status === 'Active').forEach(r => { r.status = 'Packed'; led(r.lot, 'PACK', r.qty, p.id); });
      p.lines.push({line: l.id, grade: l.grade, pack: l.pack, planned: l.qty, packs: full, remainder: rem, actual: r3(full * pk + rem), label: 'LBL-' + p.id.slice(-3) + '-' + l.grade.replace('-', ''), lots: S.reservations.filter(r => r.line === l.id && r.status === 'Packed').map(r => r.lot)});
    });
    S.packings.push(p); o.status = 'Packed';
    audit('Packing recorded', p.id, `${orderId} at ${centre}`); return p;
  },
  dispatch(orderId, info) {
    const o = S.orders.find(x => x.id === orderId);
    if (S.dispatches.some(d => d.order === orderId)) fail('Duplicate dispatch blocked — stock is deducted once only');
    const p = S.packings.find(x => x.order === orderId); if (!p) fail('No packing record for this order');
    const d = {id: nextId('DSP-DEMO-'), order: orderId, date: clock, ...info, qty: p.lines.reduce((a, l) => a + l.actual, 0), status: 'Dispatched'};
    S.reservations.filter(r => r.order === orderId && r.status === 'Packed').forEach(r => { r.status = 'Dispatched'; led(r.lot, 'DISPATCH', r.qty, d.id); });
    S.dispatches.push(d); o.status = 'Dispatched'; p.status = 'Dispatched';
    audit('Dispatch posted', d.id, `${orderId}, container ${info.container}`); return d;
  }
};

/* ============================ SEED ============================ */
function seed() {
  S = newState(); const R = rng(42);
  const actor = 'System seed';
  const hist = [
    {ref: 'SHP-DEMO-010', sup: 'SUP-A', d: '2026-09-22', qty: 30000}, {ref: 'SHP-DEMO-011', sup: 'SUP-B', d: '2026-09-29', qty: 22000},
    {ref: 'SHP-DEMO-012', sup: 'SUP-C', d: '2026-10-08', qty: 28000}, {ref: 'SHP-DEMO-013', sup: 'SUP-D', d: '2026-10-17', qty: 18000}, {ref: 'SHP-DEMO-014', sup: 'SUP-E', d: '2026-10-26', qty: 20000}, {ref: 'SHP-DEMO-015', sup: 'SUP-F', d: '2026-11-02', qty: 15000}];
  const prevUser = App.user; App.user = () => actor;
  S.seq['RCN-DEMO-'] = 9; S.seq['GR-DEMO-'] = 9;
  hist.forEach((h, i) => {
    clock = h.d; E.createShipment({ref: h.ref, supplier: h.sup, arrival: h.d, po: 'PO-DEMO-' + (410 + i), expected: h.qty});
    clock = addDays(h.d, 1); E.postReceipt(h.ref, h.qty, i % 2 ? 'WH-RAW-2' : 'WH-RAW-1');
  });
  // allocations
  const allocPlan = [['RCN-DEMO-010', 'F01', 9000], ['RCN-DEMO-010', 'F02', 7000], ['RCN-DEMO-010', 'F03', 8000], ['RCN-DEMO-011', 'F04', 6000], ['RCN-DEMO-011', 'F05', 9000],
    ['RCN-DEMO-011', 'F06', 5000], ['RCN-DEMO-012', 'F01', 6000], ['RCN-DEMO-012', 'F02', 6000], ['RCN-DEMO-012', 'F03', 5000], ['RCN-DEMO-012', 'F05', 6000], ['RCN-DEMO-013', 'F04', 5000], ['RCN-DEMO-013', 'F06', 4000], ['RCN-DEMO-014', 'F03', 6000], ['RCN-DEMO-014', 'F02', 4000]];
  allocPlan.forEach(([b, f, q], i) => { clock = addDays('2026-10-01', i); E.allocate(b, f, q); });
  // production runs
  const share = M.sampleOutput; const tot = 1330;
  const gradeSets = [['W-180', 'W-210', 'W-240', 'W-320', 'W-450', 'SW-320', 'S', 'B', 'LWP', 'SWP', 'BB'], ['W-240', 'W-320', 'W-450', 'SW-240', 'S', 'LWP', 'SWP', 'BB'], ['W-210', 'W-320', 'SW-210', 'SW-320', 'SB', 'B', 'SS']];
  S.seq['PROD-DEMO-'] = 100; let k = 0;
  S.allocations.slice().forEach(a => {
    const runs = 2;
    for (let j = 0; j < runs; j++) {
      const input = Math.round((a.qty / runs) * (0.85 + R() * 0.1) / 10) * 10;
      const rec = 0.245 + R() * 0.045 - (a.fac === 'F06' ? 0.02 : 0);
      const kernel = input * rec; const set = gradeSets[k % 3];
      const weights = set.map(g => (share[g] || 40) * (0.7 + R() * 0.6)); const ws = weights.reduce((x, y) => x + y, 0);
      const outputs = set.map((g, i) => ({grade: g, qty: Math.round(kernel * weights[i] / ws)}));
      const shell = Math.round(input * (0.66 + R() * 0.03)), testa = Math.round(input * 0.024), rej = Math.round(input * 0.008);
      const other = k === 9 ? [{type: 'TESTA', qty: testa}] : [{type: 'SHELL', qty: shell}, {type: 'TESTA', qty: testa}, {type: 'REJ', qty: rej}];
      clock = addDays('2026-10-06', k * 2 > 30 ? 30 : Math.floor(k * 1.3));
      const run = E.saveRun({fac: a.fac, date: clock, shift: ['Morning', 'Evening'][k % 2], supervisor: 'S. Pillai', line: 'Line ' + (1 + k % 3), cons: [{batch: a.batch, qty: input}], outputs, other});
      if (k < 22) E.postRun(run.id); k++;
    }
  });
  // quality on historical lots
  App.user = () => 'M. Thomas';
  S.lots.forEach((l, i) => {
    if (l.date >= '2026-11-04' && l.grade.match(/W-2|W-3|S$|LWP|SWP/)) return; // recent lots remain pending inspection
    clock = addDays(l.date, 1);
    const dec = (i % 29 === 7) ? 'HOLD' : (i % 53 === 11) ? 'REJECT' : 'PASS';
    E.inspect(l.id, dec, {moist: (dec === 'HOLD' ? 5.3 + R() * .5 : 3.9 + R()).toFixed(1), broken: (2 + R() * 2.8).toFixed(1), nlg: (1.5 + R() * 3).toFixed(1), colour: dec === 'PASS' ? 'Conforms' : 'Off-colour', infest: dec === 'REJECT' ? 'Extraneous matter found' : 'None found'}, dec === 'HOLD' ? 'Re-test moisture after 48 h' : dec === 'REJECT' ? 'Objectionable extraneous matter found' : '', l.qty);
  });
  App.user = () => 'J. Varghese';
  S.seq['ORD-DEMO-'] = 9;
  const orders = [
    {cust: 'CUS-02', dest: 'United States', ship: '2026-10-28', curr: 'USD', lines: [{grade: 'W-240', qty: 900, pack: 'PK-50F'}, {grade: 'W-320', qty: 700, pack: 'PK-50F'}], go: 'dispatch', d: '2026-10-20'},
    {cust: 'CUS-03', dest: 'Germany', ship: '2026-11-03', curr: 'EUR', lines: [{grade: 'W-320', qty: 600, pack: 'PK-10T'}, {grade: 'W-450', qty: 300, pack: 'PK-10T'}], go: 'dispatch', d: '2026-10-24'},
    {cust: 'CUS-04', dest: 'United Arab Emirates', ship: '2026-11-14', curr: 'USD', lines: [{grade: 'LWP', qty: 250, pack: 'PK-25T'}, {grade: 'W-210', qty: 200, pack: 'PK-25T'}], go: 'pack', d: '2026-11-01'},
    {cust: 'CUS-02', dest: 'United States', ship: '2026-11-20', curr: 'USD', lines: [{grade: 'W-240', qty: 500, pack: 'PK-25F'}], go: 'reserve', d: '2026-11-04'},
    {cust: 'CUS-03', dest: 'Germany', ship: '2026-11-28', curr: 'EUR', lines: [{grade: 'W-180', qty: 400, pack: 'PK-10T'}, {grade: 'SW-320', qty: 150, pack: 'PK-10T'}], go: 'confirm', d: '2026-11-06'},
    {cust: 'CUS-05', dest: 'Japan', ship: '2026-11-25', curr: 'USD', lines: [{grade: 'W-450', qty: 350, pack: 'PK-25T'}, {grade: 'SWP', qty: 120, pack: 'PK-25T'}], go: 'reserve', d: '2026-11-07'},
  ];
  orders.forEach(od => {
    clock = od.d; const o = E.createOrder(od); E.confirm(o.id);
    if (od.go === 'confirm') return;
    o.lines.forEach(l => E.suggest(l).filter(s => s.take > 0).forEach(s => E.reserve(o.id, l.id, s.lot.id, s.take)));
    if (od.go === 'reserve' || o.status !== 'Reserved') return;
    clock = addDays(od.d, 2); E.pack(o.id, 'PC0' + (1 + S.packings.length % 2), 'Packing crew B');
    if (od.go === 'dispatch') { clock = addDays(od.d, 4); E.dispatch(o.id, {container: 'DEMO-CONT-' + (7700 + S.dispatches.length), forwarder: 'Demo Freight Ltd', vessel: 'MV Demo Star', checklist: {inv: true, pl: true, coo: true, phyto: true, bl: true}}); }
  });
  // live journey starting point: shipment SHP-DEMO-001 arrived, not yet received
  App.user = () => actor; clock = M.today;
  E.createShipment({ref: 'SHP-DEMO-001', supplier: 'SUP-A', arrival: M.today, po: 'PO-DEMO-501', expected: 25000, notes: 'Raw cashew nuts, in-shell, 50 kg jute bags'});
  App.user = prevUser; clock = M.today;
  S.audit.forEach(a => { if (a.actor === 'System seed') a.actor = 'Seed'; });
}

/* ============================ UI ============================ */
const IC = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  factories: '<path d="M2 20h20M4 20V9l5 3V9l5 3V5h6v15"/><path d="M8 16h1M13 16h1M17 16h1"/>',
  shipments: '<path d="M2 17h20l-2 4H4z"/><path d="M5 17V9h14v8M9 9V5h6v4"/>',
  batches: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  production: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  grades: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M12 21 9 9l3-6 3 6z"/>',
  quality: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  inventory: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  orders: '<path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
  packing: '<path d="m7.5 4.3 9 5.1M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  dispatch: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  trace: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h6M18 15V9"/><circle cx="18" cy="6" r="3"/>',
  reports: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>'
};
const svg = k => `<svg viewBox="0 0 24 24">${IC[k] || ''}</svg>`;
const NAV = [
  ['Overview', [['dashboard', 'Dashboard'], ['factories', 'Factories']]],
  ['Raw material', [['shipments', 'Suppliers & shipments'], ['batches', 'Raw batches']]],
  ['Processing', [['production', 'Production'], ['grades', 'Grade master'], ['quality', 'Quality control']]],
  ['Stock & sales', [['inventory', 'Inventory'], ['orders', 'Orders'], ['packing', 'Packing'], ['dispatch', 'Dispatch']]],
  ['Intelligence', [['trace', 'Traceability'], ['costing', 'Costing & margin'], ['reports', 'Reports'], ['settings', 'Company & settings']]]
];
const Theme = {
  cur() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; },
  toggle() { const n = Theme.cur() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('ciq-theme', n); } catch (e) {} }
};
const JOURNEY = [['Shipment', 'shipments'], ['Goods receipt', 'shipments'], ['Raw batch', 'batches'], ['Allocation', 'batches'], ['Production', 'production'], ['Grade outputs', 'production'], ['Quality', 'quality'], ['Inventory', 'inventory'], ['Order', 'orders'], ['Reservation', 'orders'], ['Packing', 'packing'], ['Dispatch', 'dispatch'], ['Reporting', 'reports']];

const App = {
  route: 'dashboard', role: null, sub: {},
  user() { return M.people[App.role] || 'User'; },
  ro() { return App.role === 'Auditor'; },
  confirmLogout() {
    const u = App.user(), ini = u.split(' ').slice(0, 2).map(x => x[0]).join('');
    modal(`<div class="signout"><div class="so-ic"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></div>
    <h2>Sign out of CashewIQ?</h2><p class="muted">You'll return to the sign-in screen. Data you entered in this session stays until you reset it or close the tab.</p>
    <div class="so-user"><span class="av">${esc(ini)}</span><div><b>${esc(u)}</b><span>${esc(App.role)}</span></div></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Stay signed in</button><button class="btn bad" onclick="App.logout()">Sign out</button></div></div>`);
  },
  logout() {
    closeModal(); Tour.end(); document.body.classList.remove('nav-open');
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); window.scrollTo(0, 0);
    toast('Signed out successfully', 'ok');
  },
  login() { App.role = $('#roleSel').value; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); App.go('dashboard'); },
  reset() { if (confirm('Reset all data to the starting point?')) { seed(); App.sub = {}; App.go('dashboard'); toast('Data reset to starting point', 'ok'); } },
  go(r, sub) { App.route = r; if (sub) App.sub[r] = sub; document.body.classList.remove('nav-open'); App.render(); window.scrollTo(0, 0); },
  fac() { return App.role === 'Factory Manager' ? 'F01' : ($('#facFilter').value || ''); },
  render() {
    $('#nav').innerHTML = NAV.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([id, t]) => `<a href="#" class="${App.route === id ? 'on' : ''}" onclick="App.go('${id}');return false">${svg(id)}${t}${badge(id)}</a>`).join('')).join('');
    $('#whoami').innerHTML = `<span class="av">${esc(App.user().split(' ').slice(0, 2).map(x => x[0]).join(''))}</span><div><b>${esc(App.user().replace('', ''))}</b><span>${esc(App.role)}${App.ro() ? ' · read-only' : ''}</span></div>`;
    const ff = $('#facFilter'); const cur = ff.value;
    ff.innerHTML = (App.role === 'Factory Manager' ? '' : '<option value="">All factories</option>') + M.factories.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    ff.value = App.role === 'Factory Manager' ? 'F01' : cur; ff.disabled = App.role === 'Factory Manager';
    const grp = NAV.find(x => x[1].some(y => y[0] === App.route)); const item = grp && grp[1].find(x => x[0] === App.route); $('#title').textContent = item ? item[1] : ''; $('#crumb').textContent = grp ? grp[0] : '';
    renderJourney();
    $('#view').innerHTML = V[App.route]();
    labelTables($('#view')); renderTabbar();
    const jc = document.querySelector('#journey .st.cur'); if (jc && window.innerWidth < 820) jc.scrollIntoView({block: 'nearest', inline: 'center'});
    if (V[App.route + '_after']) V[App.route + '_after']();
  }
};
function badge(id) {
  const n = {quality: S.lots.filter(l => l.qc === 'Pending').length, orders: S.orders.filter(o => ['Draft', 'Confirmed', 'Partly reserved'].includes(o.status)).length, packing: S.orders.filter(o => o.status === 'Reserved').length, dispatch: S.orders.filter(o => o.status === 'Packed').length, shipments: S.shipments.filter(s => s.status === 'Arrived').length}[id];
  return n ? `<span class="n">${n}</span>` : '';
}
function journeyIdx() {
  const has = x => !!x; const o = S.orders.find(x => x.id === 'ORD-DEMO-001'); const run = S.runs.find(r => r.id === 'PROD-DEMO-001');
  const steps = [true, has(S.batches.find(b => b.id === 'RCN-DEMO-001')), has(S.batches.find(b => b.id === 'RCN-DEMO-001')), has(S.allocations.find(a => a.batch === 'RCN-DEMO-001')),
    has(run), run && run.status === 'Posted', has(S.lots.find(l => l.run === 'PROD-DEMO-001' && l.qc !== 'Pending')), has(S.lots.find(l => l.run === 'PROD-DEMO-001' && l.qc === 'PASS')),
    has(o), o && ['Reserved', 'Packed', 'Dispatched'].includes(o.status), o && ['Packed', 'Dispatched'].includes(o.status), o && o.status === 'Dispatched', o && o.status === 'Dispatched' && App.sub.reportsSeen];
  let i = steps.findIndex(s => !s); return i < 0 ? steps.length : i;
}
function renderJourney() {
  const i = journeyIdx();
  $('#journey').innerHTML = '<span class="lbl">Workflow</span>' + JOURNEY.map(([t, r], k) => `<span class="st ${k < i ? 'done' : k === i ? 'cur' : ''}" onclick="App.go('${r}')"><i>${k < i ? '✓' : k + 1}</i>${t}</span>`).join('<span class="arr"></span>');
}
function toast(m, t = '') { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = m; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 4200); }
function act(fn) {
  if (App.ro()) { toast('Auditor role is read-only — no create/update/delete permissions', 'warn'); return; }
  try { const r = fn(); App.render(); return r; } catch (e) { if (e instanceof BizError) { toast('⛔ ' + e.message, 'bad'); } else { console.error(e); toast('Error: ' + e.message, 'bad'); } }
}
function modal(html) { $('#modalBody').innerHTML = html; labelTables($('#modalBody')); $('#modal').classList.remove('hidden'); document.body.classList.add('modal-open'); }
/* mobile: give every cell its column name so tables can reflow into cards */
function labelTables(el) {
  el.querySelectorAll('table').forEach(t => {
    const hs = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (hs[i]) td.dataset.label = hs[i]; else td.classList.add('nolabel'); if (!td.textContent.trim() && !td.querySelector('button,input,select')) td.classList.add('blank'); }));
  });
}
const TABS = [['dashboard', 'Home'], ['production', 'Production'], ['quality', 'Quality'], ['orders', 'Orders']];
function renderTabbar() {
  const inTabs = TABS.some(t => t[0] === App.route);
  $('#tabbar').innerHTML = TABS.map(([id, t]) => `<a href="#" class="${App.route === id ? 'on' : ''}" onclick="App.go('${id}');return false">${svg(id)}<span>${t}</span>${badge(id)}</a>`).join('') +
    `<a href="#" class="${inTabs ? '' : 'on'}" onclick="document.body.classList.toggle('nav-open');return false"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span>More</span></a>`;
}
function closeModal() { $('#modal').classList.add('hidden'); document.body.classList.remove('modal-open'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
const pill = s => { const c = {PASS: 'ok', Released: 'ok', Posted: 'ok', Dispatched: 'ok', Received: 'ok', Active: 'ok', Accepted: 'ok', HOLD: 'warn', Pending: 'info', Draft: 'info', Confirmed: 'brand', 'Partly reserved': 'warn', Reserved: 'brand', Packed: 'brand', REJECT: 'bad', Arrived: 'warn', Maintenance: 'warn', Open: 'info', Consumed: '', Incomplete: 'warn', Complete: 'ok', flag: 'warn', ok: 'ok'}[s] ?? ''; return `<span class="pill ${c}">${esc(s === 'flag' ? 'Needs validation' : s === 'ok' ? 'Validated' : s)}</span>`; };
const table = (heads, rows, empty = 'No records') => `<div class="tbl-wrap"><table><thead><tr>${heads.map(h => `<th class="${h.endsWith('#') ? 'num' : ''}">${h.replace(/#$/, '')}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${heads.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
const kpi = (l, v, s = '', cls = '', ic = '') => `<div class="card kpi ${cls}">${ic ? `<span class="ic">${svg(ic)}</span>` : ''}<div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
const bars = (items, fmt = kg, cls = '') => { const mx = Math.max(1, ...items.map(i => i[1])); return `<div class="bars">${items.map(([l, v, t]) => `<div class="bar"><span title="${esc(t || l)}">${esc(l)}</span><div class="t"><i class="${cls}" style="width:${v / mx * 100}%"></i></div><b>${fmt(v)}</b></div>`).join('')}</div>`; };
const facOk = f => !App.fac() || f === App.fac();
const B = (label, onclick, cls = '') => `<button class="btn ${cls}" ${App.ro() ? 'disabled title="Read-only role"' : ''} onclick="${onclick}">${label}</button>`;

/* --------- aggregated metrics --------- */
function metrics() {
  const runs = S.runs.filter(r => r.status === 'Posted' && facOk(r.fac));
  const lots = S.lots.filter(l => facOk(l.fac)).map(l => ({...l, b: E.bal(l.id)}));
  const raw = S.batches.reduce((a, b) => a + b.original, 0);
  const cons = runs.reduce((a, r) => a + E.calc(r).input, 0); const kern = runs.reduce((a, r) => a + E.calc(r).kernel, 0);
  return {runs, lots, raw, cons, kern, rec: cons ? kern / cons * 100 : null,
    stock: lots.reduce((a, l) => a + l.b.onhand, 0), avail: lots.reduce((a, l) => a + l.b.available, 0),
    hold: lots.filter(l => l.qc === 'HOLD').reduce((a, l) => a + l.b.onhand, 0), pending: lots.filter(l => l.qc === 'Pending').reduce((a, l) => a + l.b.onhand, 0),
    openOrders: S.orders.filter(o => o.status !== 'Dispatched').length, pendDisp: S.orders.filter(o => ['Packed', 'Reserved'].includes(o.status)).length};
}
function alerts() {
  const out = []; const m = metrics();
  const holds = m.lots.filter(l => l.qc === 'HOLD'); if (holds.length) out.push(['warn', `${holds.length} finished lot(s) on quality HOLD — ${kg(m.hold)} unavailable for sale`, 'quality']);
  const pend = m.lots.filter(l => l.qc === 'Pending'); if (pend.length) out.push(['info', `${pend.length} finished lot(s) awaiting quality inspection`, 'quality']);
  const inc = m.runs.filter(r => !E.calc(r).complete); if (inc.length) out.push(['warn', `Mass balance incomplete on ${inc.map(r => r.id).join(', ')} — shell output not recorded`, 'production']);
  const sh = S.shipments.filter(s => s.status === 'Arrived'); if (sh.length) out.push(['info', `Shipment ${sh.map(s => s.ref).join(', ')} arrived — goods receipt not yet posted`, 'shipments']);
  S.orders.filter(o => o.status === 'Confirmed' || o.status === 'Partly reserved').forEach(o => { const short = o.lines.filter(l => E.suggest(l).reduce((a, s) => a + s.take, 0) + E.lineReserved(l.id) < l.qty - 1e-6); if (short.length) out.push(['bad', `${o.id}: insufficient released stock for ${short.map(l => l.grade).join(', ')}`, 'orders']); });
  S.orders.filter(o => o.status === 'Packed').forEach(o => out.push(['info', `${o.id} packed — pending dispatch`, 'dispatch']));
  S.orders.filter(o => o.status !== 'Dispatched' && o.ship && o.ship < M.today).forEach(o => out.push(['bad', `${o.id} overdue — requested ship date ${fmtDate(o.ship)}`, 'orders']));
  return out;
}

/* ============================ VIEWS ============================ */
const V = {};
V.dashboard = () => {
  const m = metrics(); const al = alerts();
  const byFac = M.factories.filter(f => facOk(f.id)).map(f => { const rs = m.runs.filter(r => r.fac === f.id); const i = rs.reduce((a, r) => a + E.calc(r).input, 0), k = rs.reduce((a, r) => a + E.calc(r).kernel, 0); return {f, i, k, rec: i ? k / i * 100 : 0}; });
  const byGrade = {}; m.runs.forEach(r => r.outputs.forEach(o => byGrade[o.grade] = (byGrade[o.grade] || 0) + (+o.qty)));
  const gs = Object.entries(byGrade).sort((a, b) => b[1] - a[1]);
  const st = {}; S.orders.forEach(o => st[o.status] = (st[o.status] || 0) + 1);
  const qc = {PASS: 0, HOLD: 0, REJECT: 0, Pending: 0}; m.lots.forEach(l => qc[l.qc] += l.b.onhand);
  const mx = Math.max(1, ...byFac.map(x => x.k));
  const cols = ['var(--ok)', 'var(--warn)', 'var(--bad)', 'var(--info)']; const qt = Object.values(qc).reduce((a, b) => a + b, 0) || 1; let acc = 0;
  const donut = Object.entries(qc).map(([k, v], i) => { const s = acc / qt * 100; acc += v; return `${cols[i]} ${s}% ${acc / qt * 100}%`; }).join(',');
  return `
  <div class="grid g4">
    ${kpi('Raw received', kg(m.raw), S.batches.length + ' raw batches', 'accent', 'batches')}
    ${kpi('Raw consumed', kg(m.cons), m.runs.length + ' posted runs', 'accent', 'production')}
    ${kpi('Kernel output', kg(m.kern), 'all grades', 'accent', 'scale')}
    ${kpi('Kernel recovery', pct(m.rec), m.cons ? 'KOR ' + (m.kern * 2.20462 / (m.cons / 80)).toFixed(1) + ' lbs / 80 kg bag' : '—', 'accent', 'percent')}
    ${kpi('Finished stock', kg(m.stock), kg(m.avail) + ' available to promise', '', 'inventory')}
    ${kpi('Quality hold', kg(m.hold), kg(m.pending) + ' pending inspection', '', 'quality')}
    ${kpi('Open orders', m.openOrders, S.orders.length + ' orders total', '', 'orders')}
    ${kpi('Pending dispatch', m.pendDisp, 'reserved or packed', '', 'dispatch')}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Kernel output by factory</h3>
      <div class="vbars-wrap"><div class="vbars">${byFac.map(x => `<div class="c"><em>${(x.k / 1000).toFixed(1)}t</em><i style="height:${x.k / mx * 120}px"></i><span>${x.f.id}</span></div>`).join('')}</div></div></div>
    <div class="card"><h3>Kernel recovery by factory <span class="r muted small">no benchmark applied</span></h3>${bars(byFac.map(x => [x.f.name, x.rec]), pct, 'b2')}</div>
  </div>
  <div class="grid g3">
    <div class="card"><h3>Grade-wise output</h3>${bars(gs.slice(0, 10).map(([g, v]) => [g, v, gName(g)]))}</div>
    <div class="card"><h3>Stock by quality status</h3><div class="donut"><div class="ring"><div style="background:conic-gradient(${donut})"></div><b>${(qt / 1000).toFixed(1)}t<small>on hand</small></b></div>
      <div class="legend">${Object.entries(qc).map(([k, v], i) => `<div><span style="background:${cols[i]}"></span>${k}: <b>${kg(Math.round(v))}</b></div>`).join('')}</div></div>
      <div class="sec">Orders by status</div><div class="statusrow">${Object.entries(st).map(([k, v]) => `<div>${pill(k)}<b>${v}</b></div>`).join('')}</div></div>
    <div class="card"><h3>Alerts & exceptions</h3><div class="alerts">${al.map(([t, m, r]) => `<div class="alert ${t}" style="cursor:pointer" onclick="App.go('${r}')">${t === 'bad' ? '⛔' : t === 'warn' ? '⚠' : 'ℹ'} ${esc(m)}</div>`).join('') || '<div class="alert ok">No exceptions</div>'}</div></div>
  </div>
  <div class="card"><h3>Recent activity <span class="r"><button class="btn sm ghost" onclick="App.go('settings')">Full audit log</button></span></h3>
    <div class="timeline">${S.audit.slice(0, 8).map(a => `<div class="ev"><span class="dot"></span><span class="t">${fmtDate(a.ts)}</span><span><b>${esc(a.action)}</b> · <span class="mono">${esc(a.entity)}</span> · ${esc(a.detail)} <span class="muted">— ${esc(a.actor)}</span></span></div>`).join('')}</div></div>`;
};

V.factories = () => {
  const sel = App.sub.factories;
  if (sel) {
    const f = M.factories.find(x => x.id === sel); const tab = App.sub.facTab || 'overview';
    const runs = S.runs.filter(r => r.fac === sel); const lots = S.lots.filter(l => l.fac === sel); const allocs = S.allocations.filter(a => a.fac === sel);
    const posted = runs.filter(r => r.status === 'Posted'); const i = posted.reduce((a, r) => a + E.calc(r).input, 0), k = posted.reduce((a, r) => a + E.calc(r).kernel, 0);
    const tabs = ['overview', 'raw allocations', 'production runs', 'quality', 'inventory'];
    const body = {
      'overview': `<div class="grid g4">${kpi('Allocated raw', kg(allocs.reduce((a, x) => a + x.qty, 0)))}${kpi('Raw consumed', kg(i))}${kpi('Kernel output', kg(k))}${kpi('Recovery', pct(i ? k / i * 100 : null))}</div>`,
      'raw allocations': table(['Allocation', 'Batch', 'Date', 'Allocated#', 'Consumed#', 'Remaining#', 'Status'], allocs.map(a => `<tr><td class="mono">${a.id}</td><td class="mono">${a.batch}</td><td>${fmtDate(a.date)}</td><td class="num">${kg(a.qty)}</td><td class="num">${kg(a.consumed)}</td><td class="num">${kg(a.qty - a.consumed)}</td><td>${pill(a.status)}</td></tr>`)),
      'production runs': runTable(runs),
      'quality': table(['Lot', 'Grade', 'Qty#', 'Decision'], lots.map(l => `<tr><td class="mono">${l.id}</td><td>${l.grade}</td><td class="num">${kg(l.qty)}</td><td>${pill(l.qc)}</td></tr>`)),
      'inventory': lotTable(lots)
    }[tab];
    return `<div class="row"><button class="btn sm ghost" onclick="App.sub.factories=null;App.render()">← All factories</button><h2 class="h2">${f.name}</h2><span class="muted">${f.location}</span>${pill(f.status)}</div>
    <div class="card"><div class="tabs">${tabs.map(t => `<button class="${t === tab ? 'on' : ''}" onclick="App.sub.facTab='${t}';App.render()">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>${body}</div>`;
  }
  return `<div class="alert info">ℹ Seven fictional factories. Real Bismi factory names and locations are intentionally not used. Factory Manager role sees only its assigned factory.</div>
  <div class="card">${table(['Code', 'Factory', 'Location', 'Status', 'Allocated raw#', 'Consumed#', 'Kernel output#', 'Recovery#', 'Runs#', 'Lots on hold#'], M.factories.filter(f => facOk(f.id)).map(f => {
    const rs = S.runs.filter(r => r.fac === f.id && r.status === 'Posted'); const i = rs.reduce((a, r) => a + E.calc(r).input, 0), k = rs.reduce((a, r) => a + E.calc(r).kernel, 0);
    return `<tr class="click" onclick="App.sub.facTab='overview';App.go('factories','${f.id}')"><td class="mono">${f.id}</td><td><b>${f.name}</b></td><td>${f.location}</td><td>${pill(f.status)}</td><td class="num">${kg(S.allocations.filter(a => a.fac === f.id).reduce((a, x) => a + x.qty, 0))}</td><td class="num">${kg(i)}</td><td class="num">${kg(k)}</td><td class="num">${pct(i ? k / i * 100 : null)}</td><td class="num">${S.runs.filter(r => r.fac === f.id).length}</td><td class="num">${S.lots.filter(l => l.fac === f.id && l.qc === 'HOLD').length}</td></tr>`;
  }))}</div>`;
};

V.shipments = () => `
  <div class="grid g2"><div class="card"><h3>Raw nut received by origin</h3>${bars(M.suppliers.map(s => [s.country, S.shipments.filter(x => x.supplier === s.id).reduce((a, x) => a + S.receipts.filter(r => r.ship === x.ref).reduce((b, r) => b + r.qty, 0), 0), s.name]).sort((x, y) => y[1] - x[1]))}</div>
  <div class="card"><h3>Suppliers</h3>${table(['Code', 'Supplier', 'Origin', 'Shipments#', 'Received#'], M.suppliers.map(s => `<tr><td class="mono">${s.id}</td><td><b>${s.name}</b></td><td>${s.country}</td><td class="num">${S.shipments.filter(x => x.supplier === s.id).length}</td><td class="num">${kg(S.shipments.filter(x => x.supplier === s.id).reduce((a, x) => a + S.receipts.filter(r => r.ship === x.ref).reduce((b, r) => b + r.qty, 0), 0))}</td></tr>`))}</div></div>
  <div class="card"><h3>Incoming shipments <span class="r">${B('+ New shipment', 'newShipment()', 'sm')}</span></h3>
  ${table(['Reference', 'Supplier', 'Origin', 'Arrival', 'Purchase ref', 'Expected#', 'Received#', 'Documents', 'Status', ''], S.shipments.slice().reverse().map(s => {
    const rec = S.receipts.filter(r => r.ship === s.ref).reduce((a, r) => a + r.qty, 0);
    return `<tr id="sh-${s.ref}"><td class="mono"><b>${s.ref}</b></td><td>${M.suppliers.find(x => x.id === s.supplier).name}</td><td>${s.origin}</td><td>${fmtDate(s.arrival)}</td><td class="mono">${s.po || ''}</td><td class="num">${kg(s.expected)}</td><td class="num">${kg(rec)}</td><td class="small">${s.docs.length} attached</td><td>${pill(s.status)}</td><td>${s.status === 'Arrived' ? B('Post goods receipt', `receiptModal('${s.ref}')`, 'sm primary') : ''}</td></tr>`;
  }))}</div>
  <div class="card"><h3>Goods receipts</h3>${table(['Receipt', 'Shipment', 'Date', 'Location', 'Quantity#', 'Batch created'], S.receipts.slice().reverse().map(r => `<tr><td class="mono">${r.id}</td><td class="mono">${r.ship}</td><td>${fmtDate(r.date)}</td><td>${r.loc}</td><td class="num">${kg(r.qty)}</td><td class="mono">${S.batches.find(b => b.gr === r.id).id}</td></tr>`))}</div>`;
function newShipment() {
  modal(`<h2>New supplier shipment</h2><div class="form">
  <label>Reference<input id="nsRef" value="SHP-DEMO-0${20 + S.shipments.length}"></label>
  <label>Supplier<select id="nsSup">${M.suppliers.map(s => `<option value="${s.id}">${s.name} — ${s.country}</option>`)}</select></label>
  <label>Arrival date<input id="nsDate" type="date" value="${M.today}"></label><label>Purchase ref<input id="nsPo" value="PO-DEMO-6${S.shipments.length}"></label>
  <label>Expected kg<input id="nsQty" type="number" value="20000"></label></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="act(()=>{E.createShipment({ref:nsRef.value,supplier:nsSup.value,arrival:nsDate.value,po:nsPo.value,expected:+nsQty.value});closeModal();toast('Shipment created','ok')})">Create shipment</button></div>`);
}
function receiptModal(ref) {
  const s = S.shipments.find(x => x.ref === ref);
  modal(`<h2>Post goods receipt — ${ref}</h2><p class="muted">Posting creates a unique raw-material batch linked to the shipment and supplier. Duplicate posting is blocked.</p>
  <div class="form"><label>Received quantity (kg)<input id="grQty" type="number" value="${s.expected}"></label>
  <label>Storage location<select id="grLoc">${M.warehouses.filter(w => w.id.includes('RAW')).map(w => `<option value="${w.id}">${w.name}</option>`)}</select></label>
  <label>Receipt date<input type="date" value="${M.today}" disabled></label></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="doReceipt('${ref}')">Post receipt & create batch</button></div>`);
}
function doReceipt(ref) { act(() => { const b = E.postReceipt(ref, $('#grQty').value, $('#grLoc').value, ref === 'SHP-DEMO-001' ? 'RCN-DEMO-001' : null); closeModal(); toast(`✓ Receipt posted — batch ${b.id} created`, 'ok'); }); }

V.batches = () => `
  <div class="card"><h3>Raw-material batches</h3>
  ${table(['Batch', 'Shipment', 'Supplier', 'Origin', 'Receipt', 'Location', 'Original#', 'Allocated#', 'Unallocated#', 'Consumed#', 'Quality', ''], S.batches.slice().reverse().map(b => {
    const x = E.batchBal(b.id);
    return `<tr><td class="mono"><b>${b.id}</b></td><td class="mono">${b.ship}</td><td>${M.suppliers.find(s => s.id === b.supplier).name}</td><td>${b.origin}</td><td>${fmtDate(b.date)}</td><td>${b.loc}</td><td class="num">${kg(b.original)}</td><td class="num">${kg(x.allocated)}</td><td class="num"><b>${kg(x.unallocated)}</b></td><td class="num">${kg(x.consumed)}</td><td>${pill(b.qstatus)}</td><td class="row">${B('Allocate', `allocModal('${b.id}')`, 'sm primary')}<button class="btn sm" onclick="batchLedger('${b.id}')">Ledger</button><button class="btn sm" onclick="App.go('trace','batch:${b.id}')">Trace</button></td></tr>`;
  }))}</div>
  <div class="card"><h3>Factory allocations & movement history</h3>
  ${table(['Allocation', 'Date', 'Batch', 'Factory', 'Allocated#', 'Consumed#', 'Remaining#', 'Status'], S.allocations.filter(a => facOk(a.fac)).slice().reverse().map(a => `<tr><td class="mono">${a.id}</td><td>${fmtDate(a.date)}</td><td class="mono">${a.batch}</td><td>${fName(a.fac)}</td><td class="num">${kg(a.qty)}</td><td class="num">${kg(a.consumed)}</td><td class="num">${kg(a.qty - a.consumed)}</td><td>${pill(a.status)}</td></tr>`))}</div>`;
function allocModal(id, preset) {
  const x = E.batchBal(id);
  modal(`<h2>Allocate ${id} to factory</h2><p class="muted">A batch may be split across several factories. Allocation beyond the unallocated quantity is blocked.</p>
  <div class="grid g3">${kpi('Received', kg(x.received))}${kpi('Already allocated', kg(x.allocated))}${kpi('Unallocated', kg(x.unallocated))}</div><br>
  <div class="form"><label>Factory<select id="alFac">${M.factories.filter(f => f.status === 'Active').map(f => `<option value="${f.id}">${f.name}</option>`)}</select></label>
  <label>Quantity (kg)<input id="alQty" type="number" value="${preset || 5000}" oninput="alChk(${x.unallocated})"></label></div>
  <div id="alMsg" style="margin-top:10px"></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="act(()=>{const a=E.allocate('${id}',alFac.value,alQty.value);closeModal();toast('✓ '+a.id+': allocated to '+fName(a.fac),'ok')})">Allocate</button></div>`);
  alChk(x.unallocated);
}
function alChk(u) { const q = +$('#alQty').value; $('#alMsg').innerHTML = q > u ? `<div class="alert bad">⛔ ${kg(q)} exceeds unallocated ${kg(u)} — the system will block this allocation.</div>` : `<div class="alert ok">Remaining after allocation: <b>${kg(u - q)}</b></div>`; }

function runTable(runs) {
  return table(['Run', 'Date', 'Factory', 'Shift', 'Raw input#', 'Kernel#', 'Recovery#', 'Mass balance', 'Status', ''], runs.slice().reverse().map(r => { const c = E.calc(r); return `<tr class="click" onclick="runDetail('${r.id}')"><td class="mono"><b>${r.id}</b></td><td>${fmtDate(r.date)}</td><td>${fName(r.fac)}</td><td>${r.shift}</td><td class="num">${kg(c.input)}</td><td class="num">${kg(c.kernel)}</td><td class="num"><b>${pct(c.recovery)}</b></td><td>${pill(c.complete ? 'Complete' : 'Incomplete')}</td><td>${pill(r.status)} ${r.status === 'Draft' ? checkPill(r) : ''}</td><td>${r.status === 'Draft' ? B('Post', `event.stopPropagation();postRunUI('${r.id}')`, 'sm primary') : ''}</td></tr>`; }));
}
V.production = () => {
  const runs = S.runs.filter(r => facOk(r.fac));
  return `<div class="row"><div class="formula">Kernel recovery % = Σ kernel output kg ÷ Σ raw input kg × 100 &nbsp;·&nbsp; Mass-balance variance = raw input − all recorded outputs</div><span class="spacer"></span><button class="btn" onclick="rulesModal()">ⓘ Rules</button>${B('+ New production run', 'runForm()', 'primary')}</div>
  <div class="card"><h3>Production runs</h3>${runTable(runs)}</div>`;
};
let draft;
function runForm(prefill) {
  const fac = App.fac() || 'F01';
  draft = prefill || {fac, date: M.today, shift: 'Morning', supervisor: App.user(), line: 'Line 1', cons: [{batch: (S.allocations.find(a => a.fac === fac && a.qty > a.consumed) || {}).batch || '', qty: 0}], outputs: [{grade: 'W-320', qty: 0}], other: [{type: 'SHELL', qty: 0}, {type: 'TESTA', qty: 0}]};
  drawRunForm();
}
function drawRunForm() {
  const d = draft; const facs = M.factories.filter(f => f.status === 'Active');
  const bOpts = [...new Set(S.allocations.filter(a => a.fac === d.fac && a.qty > a.consumed).map(a => a.batch))];
  const c = E.calc(d);
  modal(`<h2>${d.code || 'New production run'}</h2>
  <div class="form"><label>Factory<select onchange="draft.fac=this.value;draft.cons=[{batch:'',qty:0}];drawRunForm()">${facs.map(f => `<option value="${f.id}" ${f.id === d.fac ? 'selected' : ''}>${f.name}</option>`)}</select></label>
  <label>Date<input type="date" value="${d.date}" onchange="draft.date=this.value"></label>
  <label>Shift<select onchange="draft.shift=this.value">${['Morning', 'Evening', 'Night'].map(s => `<option ${s === d.shift ? 'selected' : ''}>${s}</option>`)}</select></label>
  <label>Line / section<input value="${esc(d.line)}" onchange="draft.line=this.value"></label></div>
  <h3 style="margin:16px 0 6px">Raw batch consumption</h3>
  ${d.cons.map((x, i) => `<div class="row" style="margin-bottom:6px"><select onchange="draft.cons[${i}].batch=this.value;drawRunForm()"><option value="">— batch —</option>${bOpts.map(b => `<option ${b === x.batch ? 'selected' : ''}>${b}</option>`)}</select><input type="number" style="width:120px" value="${x.qty || ''}" placeholder="kg" oninput="draft.cons[${i}].qty=+this.value;runLive()"><span class="muted small">allocated avail: ${x.batch ? kg(E.allocAvail(d.fac, x.batch)) : '—'}</span></div>`).join('')}
  <button class="btn sm ghost" onclick="draft.cons.push({batch:'',qty:0});drawRunForm()">+ Add batch</button>
  <div class="grid g2" style="margin-top:14px"><div><h3 style="margin:0 0 6px">Grade-wise kernel output</h3>
  ${d.outputs.map((o, i) => `<div class="row" style="margin-bottom:5px"><select onchange="draft.outputs[${i}].grade=this.value">${M.grades.map(g => `<option value="${g.id}" ${g.id === o.grade ? 'selected' : ''}>${g.id} — ${g.name}</option>`)}</select><input type="number" style="width:90px" value="${o.qty || ''}" placeholder="kg" oninput="draft.outputs[${i}].qty=+this.value;runLive()"></div>`).join('')}
  <div class="row"><button class="btn sm ghost" onclick="draft.outputs.push({grade:'W-240',qty:0});drawRunForm()">+ Add grade</button><button class="btn sm ghost" onclick="$('#csvIn').click()">⇪ Import CSV</button><button class="btn sm ghost" onclick="csvTemplate()">⇩ Template</button><input type="file" id="csvIn" accept=".csv,.txt" hidden onchange="csvImport(this)"></div></div>
  <div><h3 style="margin:0 0 6px">Other output streams</h3>
  ${d.other.map((o, i) => `<div class="row" style="margin-bottom:5px"><select onchange="draft.other[${i}].type=this.value;runLive()">${M.outputTypes.map(t => `<option value="${t.id}" ${t.id === o.type ? 'selected' : ''}>${t.name}${t.required ? ' *' : ''}</option>`)}</select><input type="number" style="width:90px" value="${o.qty || ''}" placeholder="kg" oninput="draft.other[${i}].qty=+this.value;runLive()"></div>`).join('')}
  <button class="btn sm ghost" onclick="draft.other.push({type:'REJ',qty:0});drawRunForm()">+ Add stream</button></div></div>
  <div id="runLive" style="margin-top:14px"></div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveRunUI(false)">Save draft</button><button class="btn primary" onclick="saveRunUI(true)">Save & post</button></div>`);
  runLive();
}
function runLive() {
  const c = E.calc(draft);
  $('#runLive').innerHTML = `<div class="grid g4">${kpi('Raw input', kg(c.input))}${kpi('Kernel output', kg(c.kernel))}${kpi('Kernel recovery', pct(c.recovery), c.input ? `KOR ${(c.kernel * 2.20462 / (c.input / 80)).toFixed(1)} lbs / 80 kg bag` : 'zero input — not calculated')}${kpi('Mass-balance variance', kg(c.variance), c.input ? (c.variance / c.input * 100).toFixed(2) + '% of input unaccounted' : '')}</div>
  ${c.complete ? '<div class="alert ok" style="margin-top:8px">✓ Required output streams recorded — mass balance complete</div>' : `<div class="alert warn" style="margin-top:8px">⚠ Mass balance INCOMPLETE — not recorded: ${c.missing.join(', ')}. Variance is not treated as wastage.</div>`}
  ${checksHtml(draft)}`;
}
function saveRunUI(post) {
  act(() => {
    draft.cons = draft.cons.filter(c => c.batch && c.qty > 0); draft.outputs = draft.outputs.filter(o => o.qty > 0); draft.other = draft.other.filter(o => o.qty > 0);
    if (!draft.cons.length) fail('Add at least one raw batch consumption');
    const r = E.saveRun(draft); closeModal();
    if (post) { E.postRun(r.id); toast(`✓ ${r.id} posted — ${r.lots.length} finished lots created, pending QC`, 'ok'); } else toast(r.id + ' saved as draft', 'ok');
  });
}
function postRunUI(id) { act(() => { const r = E.postRun(id); toast(`✓ ${id} posted — ${r.lots.length} lots created`, 'ok'); }); }
function runDetail(id) {
  const r = S.runs.find(x => x.id === id); const c = E.calc(r);
  modal(`<h2>${r.id} ${pill(r.status)}</h2><p class="muted">${fName(r.fac)} · ${fmtDate(r.date)} · ${r.shift} shift · ${esc(r.line)} · Supervisor ${esc(r.supervisor)}</p>
  <div class="grid g4">${kpi('Raw input', kg(c.input))}${kpi('Kernel', kg(c.kernel))}${kpi('Recovery', pct(c.recovery))}${kpi('Variance', kg(c.variance), c.complete ? 'complete' : 'INCOMPLETE')}</div>
  <div class="formula" style="margin:10px 0">Recovery ${c.kernel.toLocaleString()} kg ÷ ${c.input.toLocaleString()} kg × 100 = ${pct(c.recovery)} · KOR ${(c.kernel * 2.20462 / (c.input / 80)).toFixed(1)} lbs per 80 kg bag</div>${r.status === 'Draft' ? checksHtml(r) : ''}
  <div class="grid g2"><div><h3>Grade outputs</h3>${bars(r.outputs.map(o => [o.grade, +o.qty, gName(o.grade)]))}</div>
  <div><h3>Consumption & other outputs</h3>${table(['Item', 'kg#'], [...r.cons.map(x => `<tr><td>Raw: <span class="mono">${x.batch}</span></td><td class="num">${kg(x.qty)}</td></tr>`), ...r.other.map(o => `<tr><td>${M.outputTypes.find(t => t.id === o.type).name}</td><td class="num">${kg(o.qty)}</td></tr>`)])}</div></div>
  ${r.lots ? `<h3>Finished lots</h3><div class="row">${r.lots.map(l => `<span class="pill brand mono" style="cursor:pointer" onclick="closeModal();App.go('trace','${l}')">${l}</span>`).join(' ')}</div>` : ''}
  <div class="modal-foot">${r.status === 'Posted' ? `<button class="btn" onclick="closeModal();App.go('costing','${r.id}')">$ View costing</button>` : ''}${r.status === 'Draft' ? B('Post run', `closeModal();postRunUI('${r.id}')`, 'primary') : ''}<button class="btn" onclick="closeModal()">Close</button></div>`);
}

V.grades = () => {
  const flagged = M.grades.filter(g => g.v === 'flag').length; const cat = App.sub.gradeCat || '';
  const list = M.grades.filter(g => !cat || g.cat === cat);
  return `<div class="alert info">ℹ 19 catalogue entries from the public website, enriched with the published kernel specification (count per 454 g, max moisture, max broken, NLSG/NLG tolerance, sieve size). ${flagged} code still needs validation. Limits are shown as reference values and are not enforced until approved.</div>
  <div class="chipset"><span class="chip ${!cat ? 'on' : ''}" style="cursor:pointer" onclick="App.sub.gradeCat='';App.render()">All · ${M.grades.length}</span>${Object.entries(M.categories).map(([k, n]) => `<span class="chip ${cat === k ? 'on' : ''}" style="cursor:pointer" onclick="App.sub.gradeCat='${k}';App.render()">${n} · ${M.grades.filter(g => g.cat === k).length}</span>`).join('')}</div>
  <div class="card">${table(['Code', 'Name', 'Form', 'Colour / characteristics', 'Count / 454 g', 'Sieve', 'Max moist. %#', 'Max broken %#', 'NLSG / NLG max %', 'Produced#', 'Validation', 'Note'], list.map(g => {
    const q = S.runs.filter(r => r.status === 'Posted').reduce((a, r) => a + r.outputs.filter(o => o.grade === g.id).reduce((b, o) => b + +o.qty, 0), 0);
    return `<tr><td class="mono"><b>${g.id}</b></td><td style="white-space:nowrap"><b>${g.name}</b><div class="spec">${M.categories[g.cat]}</div></td><td>${g.form}</td><td class="small">${g.colour}</td><td>${g.count}</td><td class="small">${g.sieve || '—'}</td><td class="num">${g.moist}</td><td class="num">${g.broken ?? 'Nil'}</td><td class="small">${g.nlg}</td><td class="num">${kg(q)}</td><td>${pill(g.v)}</td><td class="small muted">${g.note || ''}</td></tr>`;
  }))}</div>
  <div class="card"><h3>In the published specification but not in the web catalogue <span class="r">${pill('flag')}</span></h3>
  <p class="muted small" style="margin-top:-6px">Kept as inactive candidates — confirm with the client whether these are traded.</p>
  ${table(['Code', 'Name', 'Count / 454 g', 'Status'], M.specOnlyGrades.map(g => `<tr><td class="mono"><b>${g.id}</b></td><td>${g.name}</td><td>${g.count}</td><td><span class="pill">Inactive</span></td></tr>`))}</div>`;
};

V.quality = () => {
  const pend = S.lots.filter(l => l.qc === 'Pending' && facOk(l.fac)); const held = S.lots.filter(l => l.qc === 'HOLD' && facOk(l.fac));
  return `<div class="alert info">ℹ Each test shows the reference value from the published kernel specification as a guide — the inspector decides. PASS releases stock; HOLD and REJECT keep it unavailable.</div>
  <div class="card"><h3>Inspection queue <span class="pill info">${pend.length}</span></h3>${table(['Lot', 'Grade', 'Factory', 'Run', 'Produced', 'Qty#', ''], pend.map(l => `<tr><td class="mono"><b>${l.id}</b></td><td>${l.grade}</td><td>${fName(l.fac)}</td><td class="mono">${l.run}</td><td>${fmtDate(l.date)}</td><td class="num">${kg(l.qty)}</td><td>${B('Inspect', `qcModal('${l.id}')`, 'sm primary')}</td></tr>`), 'Queue is empty')}</div>
  <div class="card"><h3>On hold — reinspection required</h3>${table(['Lot', 'Grade', 'Qty#', 'Last comment', ''], held.map(l => { const i = S.inspections.filter(x => x.lot === l.id).pop(); return `<tr><td class="mono">${l.id}</td><td>${l.grade}</td><td class="num">${kg(l.qty)}</td><td>${esc(i.comment)}</td><td>${B('Re-inspect', `qcModal('${l.id}')`, 'sm')}</td></tr>`; }), 'No lots on hold')}</div>
  <div class="card"><h3>Inspection history</h3>${table(['Inspection', 'Date', 'Lot', 'Inspector', 'Moisture', 'Broken', 'Decision'], S.inspections.slice(-25).reverse().map(i => `<tr><td class="mono">${i.id}</td><td>${fmtDate(i.date)}</td><td class="mono">${i.lot}</td><td>${esc(i.inspector)}</td><td>${i.results.moist || ''}%</td><td>${i.results.broken || ''}%</td><td>${pill(i.decision)}</td></tr>`))}</div>`;
};
function qcModal(id) {
  const l = S.lots.find(x => x.id === id); const g = M.grades.find(x => x.id === l.grade) || {}; const hist = S.inspections.filter(i => i.lot === id);
  const ref = {moist: g.moist != null ? '≤ ' + g.moist + '%' : '—', broken: g.broken != null ? '≤ ' + g.broken + '%' : 'Nil', nlg: g.nlg ? '≤ ' + g.nlg : '—', count: g.count && g.count !== '—' ? g.count : 'N.A', colour: g.colour || '—', infest: 'Completely free'};
  const def = {moist: '4.6', broken: '3.2', nlg: '2.8', count: (g.count || '').includes('–') ? String(+g.count.split('–')[1] - 6) : '', colour: 'Conforms', infest: 'None found'};
  modal(`<h2>Inspect ${id}</h2><p class="muted">${gName(l.grade)} · ${kg(l.qty)} · ${fName(l.fac)} · from ${l.run}</p>
  ${table(['Test', 'Result', 'Reference (published spec)', ''], M.qualityTests.map(t => `<tr><td><b>${t.name}</b> <span class="muted small">${t.unit}</span></td><td><input id="qt-${t.id}" style="width:130px" value="${def[t.id]}" oninput="qcRef()"></td><td class="small">${esc(ref[t.id])}</td><td id="qr-${t.id}" class="small" style="white-space:nowrap"></td></tr>`))}
  <p class="spec" style="margin:8px 0 0">Reference values from the client's ${M.profile.specSource}. They are indicators only — the inspector decides until limits are formally approved.</p>
  <label style="margin-top:12px">Comments<textarea id="qcCom" rows="2">Visual and lab checks completed.</textarea></label>
  ${hist.length ? `<p class="small muted">Previous: ${hist.map(h => h.decision + ' on ' + fmtDate(h.date)).join(', ')}</p>` : ''}
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn bad" onclick="doQC('${id}','REJECT')">Reject</button><button class="btn warn" onclick="doQC('${id}','HOLD')">Hold</button><button class="btn ok" onclick="doQC('${id}','PASS')">Pass & release</button></div>`);
  window._qcG = g; qcRef();
}
function qcRef() {
  const g = window._qcG; const chk = (id, lim) => { const v = parseFloat($('#qt-' + id).value); const el = $('#qr-' + id); if (lim == null || isNaN(v)) { el.innerHTML = ''; return; } el.innerHTML = v <= lim ? '<span class="ref-ok">✓ within ref.</span>' : '<span class="ref-bad">▲ above ref.</span>'; };
  chk('moist', g.moist); chk('broken', g.broken); chk('nlg', g.nlg ? parseFloat(g.nlg) : null);
}
function doQC(id, d) { act(() => { const res = {}; M.qualityTests.forEach(t => res[t.id] = $('#qt-' + t.id).value); E.inspect(id, d, res, $('#qcCom').value); closeModal(); toast(`${id}: ${d}${d === 'PASS' ? ' — stock released' : ' — stock blocked'}`, d === 'PASS' ? 'ok' : 'warn'); }); }

function lotTable(lots) {
  return table(['Lot', 'Grade', 'Factory', 'Location', 'QC', 'Produced#', 'Released#', 'Reserved#', 'Packed#', 'Dispatched#', 'Available#', ''], lots.map(l => { const b = E.bal(l.id); return `<tr><td class="mono">${l.id}</td><td><b>${l.grade}</b></td><td>${l.fac}</td><td>${l.loc}</td><td>${pill(l.qc)}</td><td class="num">${kg(b.produced)}</td><td class="num">${kg(b.released)}</td><td class="num">${kg(b.reserved)}</td><td class="num">${kg(b.packed)}</td><td class="num">${kg(b.dispatched)}</td><td class="num"><b>${kg(b.available)}</b></td><td><button class="btn sm" onclick="App.go('trace','${l.id}')">Trace</button></td></tr>`; }));
}
V.inventory = () => {
  const tab = App.sub.invTab || 'grade'; const g = App.sub.invGrade || ''; const q = App.sub.invQc || '';
  const lots = S.lots.filter(l => facOk(l.fac) && (!g || l.grade === g) && (!q || l.qc === q));
  const byG = {}; S.lots.filter(l => facOk(l.fac)).forEach(l => { const b = E.bal(l.id); const x = byG[l.grade] = byG[l.grade] || {on: 0, av: 0, hold: 0, res: 0, pend: 0}; x.on += b.onhand; x.av += b.available; x.res += b.reserved + b.packed; if (l.qc === 'HOLD' || l.qc === 'REJECT') x.hold += b.onhand; if (l.qc === 'Pending') x.pend += b.onhand; });
  return `<div class="formula">Available kg = quality-released stock − active reservations − packed − dispatched &nbsp;·&nbsp; every balance below is derived from the append-only inventory ledger</div>
  <div class="card"><div class="tabs">${[['grade', 'By grade'], ['lots', 'By lot'], ['ledger', 'Transaction ledger']].map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" onclick="App.sub.invTab='${k}';App.render()">${t}</button>`).join('')}</div>
  ${tab === 'grade' ? table(['Grade', 'Name', 'On hand#', 'Pending QC#', 'Hold / reject#', 'Reserved / packed#', 'Available to promise#'], Object.entries(byG).sort().map(([k, x]) => `<tr class="click" onclick="App.sub.invTab='lots';App.sub.invGrade='${k}';App.render()"><td class="mono"><b>${k}</b></td><td>${gName(k)}</td><td class="num">${kg(x.on)}</td><td class="num">${kg(x.pend)}</td><td class="num">${kg(x.hold)}</td><td class="num">${kg(x.res)}</td><td class="num"><b>${kg(x.av)}</b></td></tr>`)) : ''}
  ${tab === 'lots' ? `<div class="row" style="margin-bottom:10px"><select onchange="App.sub.invGrade=this.value;App.render()"><option value="">All grades</option>${M.grades.map(x => `<option ${x.id === g ? 'selected' : ''}>${x.id}</option>`)}</select><select onchange="App.sub.invQc=this.value;App.render()"><option value="">All QC status</option>${['PASS', 'Pending', 'HOLD', 'REJECT'].map(x => `<option ${x === q ? 'selected' : ''}>${x}</option>`)}</select><span class="muted small">${lots.length} lots</span></div>${lotTable(lots)}` : ''}
  ${tab === 'ledger' ? table(['#', 'Date', 'Lot', 'Movement', 'Qty#', 'Reference'], S.ledger.slice(-60).reverse().map(l => `<tr><td class="mono">${l.id}</td><td>${fmtDate(l.ts)}</td><td class="mono">${l.lot}</td><td>${pill(l.type)}</td><td class="num">${kg(l.qty)}</td><td class="mono">${l.ref}</td></tr>`)) + '<p class="muted small">Showing latest 60 of ' + S.ledger.length + ' ledger transactions.</p>' : ''}</div>`;
};

V.orders = () => {
  const sel = App.sub.orders;
  if (sel) return orderDetail(sel);
  return `<div class="row"><span class="muted">Bulk B2B export orders — not a public storefront.</span><span class="spacer"></span>${B('+ New customer order', 'orderForm()', 'primary')}</div>
  <div class="card">${table(['Order', 'Date', 'Customer', 'Destination', 'Lines', 'Ordered#', 'Reserved#', 'Ship by', 'Status'], S.orders.slice().reverse().map(o => { const q = o.lines.reduce((a, l) => a + l.qty, 0), r = o.lines.reduce((a, l) => a + E.lineReserved(l.id), 0) + S.reservations.filter(x => x.order === o.id && x.status !== 'Active' && x.status !== 'Released').reduce((a, x) => a + 0, 0); return `<tr class="click" onclick="App.go('orders','${o.id}')"><td class="mono"><b>${o.id}</b></td><td>${fmtDate(o.date)}</td><td>${cName(o.cust)}</td><td>${o.dest}</td><td>${o.lines.map(l => l.grade).join(', ')}</td><td class="num">${kg(q)}</td><td class="num">${kg(S.reservations.filter(x => x.order === o.id && x.status !== 'Released').reduce((a, x) => a + x.qty, 0))}</td><td>${o.ship ? fmtDate(o.ship) : ''}</td><td>${pill(o.status)}</td></tr>`; }))}</div>`;
};
let odraft;
function orderForm() {
  odraft = {cust: 'CUS-01', dest: 'United Kingdom', ship: addDays(M.today, 14), curr: 'GBP', lines: [{grade: 'W-320', qty: 300, pack: 'PK-25F'}], code: S.orders.some(o => o.id === 'ORD-DEMO-001') ? null : 'ORD-DEMO-001'};
  drawOrder();
}
function drawOrder() {
  const d = odraft;
  modal(`<h2>New customer order${d.code ? ' — ' + d.code : ''}</h2><div class="form">
  <label>Customer<select onchange="odraft.cust=this.value;const c=M.customers.find(x=>x.id===this.value);odraft.dest=c.country;odraft.curr=c.currency;drawOrder()">${M.customers.map(c => `<option value="${c.id}" ${c.id === d.cust ? 'selected' : ''}>${c.name}</option>`)}</select></label>
  <label>Destination<input value="${d.dest}" onchange="odraft.dest=this.value"></label><label>Requested ship date<input type="date" value="${d.ship}" onchange="odraft.ship=this.value"></label><label>Currency<input value="${d.curr}" disabled></label></div>
  <h3 style="margin:14px 0 6px">Order lines</h3>
  ${d.lines.map((l, i) => { const pk = packKg(l.pack), full = Math.floor(l.qty / pk + 1e-9), rem = l.qty - full * pk; const atp = S.lots.filter(x => x.grade === l.grade && x.qc === 'PASS').reduce((a, x) => a + E.bal(x.id).available, 0);
    return `<div class="card" style="padding:10px;margin-bottom:8px"><div class="row"><select onchange="odraft.lines[${i}].grade=this.value;drawOrder()">${M.grades.map(g => `<option value="${g.id}" ${g.id === l.grade ? 'selected' : ''}>${g.id}</option>`)}</select>
    <input type="number" style="width:110px" value="${l.qty}" onchange="odraft.lines[${i}].qty=+this.value;drawOrder()"> kg
    <select onchange="odraft.lines[${i}].pack=this.value;drawOrder()">${M.packaging.map(p => `<option value="${p.id}" ${p.id === l.pack ? 'selected' : ''}>${p.name}</option>`)}</select></div>
    <div class="small" style="margin-top:6px">📦 ${pkName(l.pack)} = ${pk.toFixed(8).replace(/0+$/, '')} kg → <b>${full} full packs</b> + <b>${rem.toFixed(3)} kg remainder</b> &nbsp;·&nbsp; Available to promise: <b style="color:${atp < l.qty ? 'var(--bad)' : 'var(--ok)'}">${kg(atp)}</b></div>${l.qty < M.profile.moq ? `<div class="spec" style="margin-top:4px">ℹ Below the published MOQ of ${kg(M.profile.moq)} per grade — allowed, flagged for sales approval</div>` : ''}</div>`; }).join('')}
  <button class="btn sm ghost" onclick="odraft.lines.push({grade:'W-240',qty:500,pack:'PK-50F'});drawOrder()">+ Add line</button>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="act(()=>{const o=E.createOrder(odraft);E.confirm(o.id);closeModal();App.go('orders',o.id);toast('✓ '+o.id+' created & confirmed','ok')})">Create & confirm order</button></div>`);
}
function orderDetail(id) {
  const o = S.orders.find(x => x.id === id); const c = M.customers.find(x => x.id === o.cust);
  const p = S.packings.find(x => x.order === id), d = S.dispatches.find(x => x.order === id);
  return `<div class="row"><button class="btn sm ghost" onclick="App.sub.orders=null;App.render()">← All orders</button><h2 class="h2">${o.id}</h2>${pill(o.status)}<span class="spacer"></span>
  ${o.status === 'Reserved' ? B('Go to packing →', "App.go('packing')", 'primary') : ''}${o.status === 'Packed' ? B('Go to dispatch →', "App.go('dispatch')", 'primary') : ''}</div>
  <div class="grid g4">${kpi('Customer', c.name, c.country)}${kpi('Destination', o.dest, 'Currency ' + o.curr)}${kpi('Requested ship', o.ship ? fmtDate(o.ship) : '—')}${kpi('Fulfilment', pct(o.lines.reduce((a, l) => a + S.reservations.filter(r => r.line === l.id && r.status === 'Dispatched').reduce((b, r) => b + r.qty, 0), 0) / o.lines.reduce((a, l) => a + l.qty, 0) * 100), 'dispatched ÷ ordered')}</div>
  ${o.lines.map(l => { const res = E.lineReserved(l.id); const sug = E.suggest(l); const short = l.qty - res - sug.reduce((a, s) => a + s.take, 0); const pk = packKg(l.pack), full = Math.floor(l.qty / pk + 1e-9);
    const blocked = S.lots.filter(x => x.grade === l.grade && x.qc !== 'PASS');
    return `<div class="card" id="line-${l.id}"><h3><span class="mono">${l.id}</span> · ${l.grade} — ${gName(l.grade)} <span class="r">${pill(res >= l.qty - 1e-6 ? 'Reserved' : res > 0 ? 'Partly reserved' : 'Open')}</span></h3>
    <div class="row small muted" style="margin-bottom:10px">Ordered <b>&nbsp;${kg(l.qty)}&nbsp;</b> · ${pkName(l.pack)} → ${full} full packs + ${(l.qty - full * pk).toFixed(3)} kg remainder · Reserved <b>&nbsp;${kg(res)}</b>${lineMargin(l)}</div>
    ${res < l.qty - 1e-6 && !['Packed', 'Dispatched'].includes(o.status) ? `<div class="sec">Suggested released lots — oldest first, user confirms</div>
    ${table(['Lot', 'Factory', 'Produced', 'QC', 'Available#', 'Suggest#', ''], sug.map(s => `<tr><td class="mono">${s.lot.id}</td><td>${s.lot.fac}</td><td>${fmtDate(s.lot.date)}</td><td>${pill('PASS')}</td><td class="num">${kg(s.b.available)}</td><td class="num"><b>${kg(s.take)}</b></td><td>${s.take > 0 ? B('Reserve', `act(()=>{E.reserve('${o.id}','${l.id}','${s.lot.id}',${s.take});toast('✓ Reserved ${kg(s.take)} from ${s.lot.id}','ok')})`, 'sm primary') : ''}</td></tr>`), 'No released stock for this grade')}
    ${short > 1e-6 ? `<div class="alert bad" style="margin-top:8px">⛔ Shortage of ${kg(short)} — insufficient quality-released stock</div>` : ''}
    ${blocked.length ? `<div class="row small" style="margin-top:8px"><span class="muted">Not eligible (HOLD/REJECT/Pending):</span>${blocked.slice(0, 4).map(b => `<span class="pill ${b.qc === 'Pending' ? 'info' : 'warn'} mono" style="cursor:pointer" title="Try to reserve" onclick="act(()=>E.reserve('${o.id}','${l.id}','${b.id}',${Math.min(l.qty, b.qty)}))">${b.id} · ${b.qc}</span>`).join('')}<span class="muted">(click to try)</span></div>` : ''}` : ''}
    <div class="sec">Reservations</div>
    ${table(['Reservation', 'Lot', 'Qty#', 'Status', ''], S.reservations.filter(r => r.line === l.id).map(r => `<tr><td class="mono">${r.id}</td><td class="mono">${r.lot}</td><td class="num">${kg(r.qty)}</td><td>${pill(r.status)}</td><td>${r.status === 'Active' ? B('Release', `act(()=>{E.unreserve('${r.id}');toast('Reservation released','ok')})`, 'sm') : ''}</td></tr>`), 'None yet')}</div>`; }).join('')}
  ${p ? `<div class="card"><h3>Packing ${p.id}</h3><p class="small">${p.centre} · ${fmtDate(p.date)} · ${esc(p.operator)}</p></div>` : ''}
  ${d ? `<div class="card"><h3>Dispatch ${d.id}</h3><p class="small">Container ${d.container} · ${d.forwarder} · ${fmtDate(d.date)}</p></div>` : ''}`;
}

V.packing = () => {
  const ready = S.orders.filter(o => o.status === 'Reserved');
  return `<div class="grid g2"><div class="card"><h3>Ready to pack</h3>${table(['Order', 'Customer', 'Lines', 'Qty#', ''], ready.map(o => `<tr><td class="mono"><b>${o.id}</b></td><td>${cName(o.cust)}</td><td>${o.lines.map(l => l.grade + ' · ' + pkName(l.pack)).join('<br>')}</td><td class="num">${kg(o.lines.reduce((a, l) => a + l.qty, 0))}</td><td>${B('Record packing', `packModal('${o.id}')`, 'sm primary')}</td></tr>`), 'No fully reserved orders awaiting packing')}</div>
  <div class="card"><h3>Packaging calculator</h3><div class="form"><label>Quantity kg<input id="pcQ" type="number" value="300" oninput="pcCalc()"></label><label>Packaging<select id="pcP" onchange="pcCalc()">${M.packaging.map(p => `<option value="${p.id}" ${p.id === 'PK-25F' ? 'selected' : ''}>${p.name}</option>`)}</select></label></div><div id="pcOut" style="margin-top:10px"></div>
  <p class="small muted">Seeded with the four packaging options published on the client website. Actual pack weights are recorded separately.</p></div></div>
  <div class="card"><h3>Packing records</h3>${table(['Packing', 'Date', 'Order', 'Centre', 'Grade', 'Packaging', 'Full packs#', 'Remainder#', 'Actual net#', 'Label', 'Status'], S.packings.slice().reverse().flatMap(p => p.lines.map(l => `<tr><td class="mono">${p.id}</td><td>${fmtDate(p.date)}</td><td class="mono">${p.order}</td><td>${p.centre}</td><td>${l.grade}</td><td>${pkName(l.pack)}</td><td class="num">${l.packs}</td><td class="num">${kg(l.remainder)}</td><td class="num">${kg(l.actual)}</td><td class="mono small">${l.label}</td><td>${pill(p.status)}</td></tr>`)))}</div>`;
};
V.packing_after = () => pcCalc();
function pcCalc() { const q = +$('#pcQ').value, id = $('#pcP').value, pk = packKg(id), f = Math.floor(q / pk + 1e-9), r = q - f * pk; const p = M.packaging.find(x => x.id === id);
  $('#pcOut').innerHTML = `<div class="formula">${p.lb ? `${p.lb} lb × 0.45359237 = ${pk.toFixed(8)} kg` : `${pk} kg`}<br>floor(${q} ÷ ${pk.toFixed(4)}) = <b>${f} full packs</b><br>remainder = ${q} − ${f} × ${pk.toFixed(4)} = <b>${r.toFixed(3)} kg</b></div>${r > 0.0005 ? `<div class="alert info" style="margin-top:8px">ℹ Not silently rounded to ${f + 1} packs — remainder shown explicitly.</div>` : ''}`; }
function packModal(id) {
  const o = S.orders.find(x => x.id === id);
  modal(`<h2>Packing — ${id}</h2><div class="form"><label>Packing centre<select id="pkC">${M.packingCentres.map(c => `<option value="${c.id}">${c.name}</option>`)}</select></label><label>Operator<input id="pkO" value="Packing crew A"></label><label>Date<input type="date" value="${M.today}" disabled></label></div>
  ${table(['Line', 'Grade', 'Packaging', 'Planned#', 'Full packs#', 'Remainder#', 'Lots'], o.lines.map(l => { const pk = packKg(l.pack), f = Math.floor(l.qty / pk + 1e-9); return `<tr><td class="mono">${l.id}</td><td>${l.grade}</td><td>${pkName(l.pack)}</td><td class="num">${kg(l.qty)}</td><td class="num"><b>${f}</b></td><td class="num">${kg(l.qty - f * pk, 3)}</td><td class="mono small">${S.reservations.filter(r => r.line === l.id && r.status === 'Active').map(r => r.lot).join(', ')}</td></tr>`; }))}
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="act(()=>{const p=E.pack('${id}',pkC.value,pkO.value);closeModal();toast('✓ '+p.id+' recorded','ok')})">Confirm packing</button></div>`);
}

V.dispatch = () => {
  const ready = S.orders.filter(o => o.status === 'Packed');
  return `<div class="card"><h3>Ready for dispatch</h3>${table(['Order', 'Customer', 'Destination', 'Packing', 'Net qty#', ''], ready.map(o => { const p = S.packings.find(x => x.order === o.id); return `<tr><td class="mono"><b>${o.id}</b></td><td>${cName(o.cust)}</td><td>${o.dest}</td><td class="mono">${p.id}</td><td class="num">${kg(p.lines.reduce((a, l) => a + l.actual, 0))}</td><td>${B('Dispatch', `dispModal('${o.id}')`, 'sm primary')}</td></tr>`; }), 'Nothing packed awaiting dispatch')}</div>
  <div class="card"><h3>Dispatches</h3>${table(['Dispatch', 'Date', 'Order', 'Customer', 'Destination', 'Container', 'Forwarder', 'Qty#', 'Docs', 'Status', ''], S.dispatches.slice().reverse().map(d => { const o = S.orders.find(x => x.id === d.order); const ck = Object.values(d.checklist || {}); return `<tr><td class="mono"><b>${d.id}</b></td><td>${fmtDate(d.date)}</td><td class="mono">${d.order}</td><td>${cName(o.cust)}</td><td>${o.dest}</td><td class="mono">${d.container}</td><td>${d.forwarder}</td><td class="num">${kg(d.qty)}</td><td>${ck.filter(Boolean).length}/${ck.length}</td><td>${pill(d.status)}</td><td>${B('Post again', `act(()=>E.dispatch('${d.order}',{}))`, 'sm ghost')}</td></tr>`; }))}
  <p class="small muted">"Post again" demonstrates idempotency: stock is deducted exactly once.</p></div>`;
};
const DOCS = [['inv', 'Commercial invoice'], ['pl', 'Packing list'], ['coo', 'Certificate of origin'], ['phyto', 'Phytosanitary certificate'], ['bl', 'Bill of lading'], ['qc', 'Quality certificate']];
function dispModal(id) {
  const o = S.orders.find(x => x.id === id);
  modal(`<h2>Dispatch — ${id}</h2><p class="muted">${cName(o.cust)} → ${o.dest}</p><div class="form">
  <label>Container / shipment ref<input id="dsC" value="DEMO-CONT-${7800 + S.dispatches.length}"></label><label>Forwarder<input id="dsF" value="Demo Freight Ltd"></label><label>Vessel<input id="dsV" value="MV Demo Horizon"></label><label>Dispatch date<input type="date" value="${M.today}" disabled></label></div>
  <h3 style="margin:14px 0 6px">Export document checklist</h3><div class="grid g2">${DOCS.map(([k, t]) => `<label class="chk"><input type="checkbox" id="dc-${k}" checked> ${t}</label>`).join('')}</div>
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="act(()=>{const ck={};DOCS.forEach(([k])=>ck[k]=$('#dc-'+k).checked);const d=E.dispatch('${id}',{container:dsC.value,forwarder:dsF.value,vessel:dsV.value,checklist:ck});closeModal();toast('✓ '+d.id+' posted — stock deducted, order dispatched','ok')})">Confirm dispatch</button></div>`);
}

V.trace = () => {
  let sel = App.sub.trace;
  if (!sel || (!sel.startsWith('batch:') && !S.lots.find(l => l.id === sel))) sel = (S.lots.find(l => l.run === 'PROD-DEMO-001' && l.grade === 'W-320') || S.lots[0]).id;
  const opts = `<select onchange="App.go('trace',this.value)"><optgroup label="Finished lots (forward → back)">${S.lots.map(l => `<option ${l.id === sel ? 'selected' : ''}>${l.id}</option>`).join('')}</optgroup><optgroup label="Raw batches (reverse trace)">${S.batches.map(b => `<option value="batch:${b.id}" ${'batch:' + b.id === sel ? 'selected' : ''}>${b.id}</option>`).join('')}</optgroup></select>`;
  if (sel.startsWith('batch:')) {
    const b = S.batches.find(x => x.id === sel.slice(6)); const runs = S.runs.filter(r => r.cons.some(c => c.batch === b.id)); const lots = S.lots.filter(l => l.batches.includes(b.id));
    return `<div class="row"><b>Trace:</b>${opts}</div><div class="card"><h3>Reverse trace — raw batch to output lots</h3>
    <div class="trace"><div class="node"><small>Shipment</small><b>${b.ship}</b>${M.suppliers.find(s => s.id === b.supplier).name} · ${b.origin}</div><span class="ar">→</span><div class="node"><small>Raw batch</small><b>${b.id}</b>${kg(b.original)}</div><span class="ar">→</span>
    <div class="node"><small>Allocations</small>${S.allocations.filter(a => a.batch === b.id).map(a => `<div>${a.fac}: ${kg(a.qty)}</div>`).join('')}</div><span class="ar">→</span>
    <div class="node"><small>Production runs</small>${runs.map(r => `<div class="mono">${r.id}</div>`).join('') || '—'}</div></div><br>
    ${table(['Output lot', 'Grade', 'Factory', 'QC', 'Dispatched#'], lots.map(l => `<tr class="click" onclick="App.go('trace','${l.id}')"><td class="mono">${l.id}</td><td>${l.grade}</td><td>${l.fac}</td><td>${pill(l.qc)}</td><td class="num">${kg(E.bal(l.id).dispatched)}</td></tr>`), 'No output lots yet')}</div>`;
  }
  const l = S.lots.find(x => x.id === sel); const run = S.runs.find(r => r.id === l.run); const bs = l.batches.map(id => S.batches.find(b => b.id === id));
  const res = S.reservations.filter(r => r.lot === l.id && r.status !== 'Released'); const ords = [...new Set(res.map(r => r.order))];
  const insp = S.inspections.filter(i => i.lot === l.id);
  const n = (t, b, s) => `<div class="node"><small>${t}</small><b>${b}</b>${s}</div>`;
  return `<div class="row"><b>Trace:</b>${opts}</div>
  <div class="card"><h3>Genealogy chain — ${l.id}</h3><div class="trace">
  ${bs.map(b => n('Supplier shipment', b.ship, M.suppliers.find(s => s.id === b.supplier).name + ' · ' + b.origin)).join('')}<span class="ar">→</span>
  ${bs.map(b => n('Raw batch', `<a href="#" onclick="App.go('trace','batch:${b.id}');return false">${b.id}</a>`, 'received ' + fmtDate(b.date))).join('')}<span class="ar">→</span>
  ${n('Production run', run.id, fName(run.fac) + ' · ' + pct(E.calc(run).recovery) + ' recovery')}<span class="ar">→</span>
  ${n('Finished lot', l.id, gName(l.grade) + ' · ' + kg(l.qty))}<span class="ar">→</span>
  ${n('Quality', insp.length ? insp[insp.length - 1].decision : 'Pending', insp.length ? insp[insp.length - 1].id : 'awaiting inspection')}<span class="ar">→</span>
  ${ords.length ? ords.map(o => { const ord = S.orders.find(x => x.id === o); const d = S.dispatches.find(x => x.order === o); return n('Customer order', `<a href="#" onclick="App.go('orders','${o}');return false">${o}</a>`, cName(ord.cust) + ' · ' + ord.status + (d ? ' · ' + d.container : '')); }).join('') : n('Customer order', '—', 'not yet reserved')}
  </div></div>
  <div class="card"><h3>Ledger movements for this lot</h3>${table(['Date', 'Movement', 'Qty#', 'Reference'], S.ledger.filter(x => x.lot === l.id).map(x => `<tr><td>${fmtDate(x.ts)}</td><td>${pill(x.type)}</td><td class="num">${kg(x.qty)}</td><td class="mono">${x.ref}</td></tr>`))}</div>`;
};

const REPORTS = {
  'Factory production': () => [['Factory', 'Runs', 'Raw input kg', 'Kernel kg', 'Recovery %', 'Recorded other kg', 'Variance kg'], ...M.factories.filter(f => facOk(f.id)).map(f => { const rs = S.runs.filter(r => r.fac === f.id && r.status === 'Posted').map(E.calc); const s = k => rs.reduce((a, c) => a + c[k], 0); return [f.name, rs.length, s('input'), s('kernel'), s('input') ? (s('kernel') / s('input') * 100).toFixed(1) : '', s('other'), s('variance')]; })],
  'Grade output': () => { const g = {}; S.runs.filter(r => r.status === 'Posted' && facOk(r.fac)).forEach(r => r.outputs.forEach(o => g[o.grade] = (g[o.grade] || 0) + +o.qty)); const t = Object.values(g).reduce((a, b) => a + b, 0); return [['Grade', 'Name', 'Output kg', 'Share %'], ...Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, gName(k), v, (v / t * 100).toFixed(1)])]; },
  'Mass balance': () => [['Run', 'Factory', 'Input kg', 'Kernel kg', 'Other kg', 'Variance kg', 'Status'], ...S.runs.filter(r => r.status === 'Posted' && facOk(r.fac)).map(r => { const c = E.calc(r); return [r.id, r.fac, c.input, c.kernel, c.other, c.variance, c.complete ? 'Complete' : 'Incomplete: ' + c.missing.join(', ')]; })],
  'Quality': () => [['Inspection', 'Date', 'Lot', 'Grade', 'Decision', 'Inspector', 'Comment'], ...S.inspections.map(i => { const l = S.lots.find(x => x.id === i.lot); return [i.id, i.date, i.lot, l.grade, i.decision, i.inspector, i.comment]; })],
  'Stock': () => [['Lot', 'Grade', 'Factory', 'QC', 'On hand kg', 'Reserved kg', 'Available kg'], ...S.lots.filter(l => facOk(l.fac)).map(l => { const b = E.bal(l.id); return [l.id, l.grade, l.fac, l.qc, b.onhand, b.reserved + b.packed, b.available]; }).filter(r => r[4] > 0)],
  'Order fulfilment': () => [['Order', 'Customer', 'Destination', 'Ordered kg', 'Dispatched kg', 'Fulfilment %', 'Status'], ...S.orders.map(o => { const q = o.lines.reduce((a, l) => a + l.qty, 0), d = S.reservations.filter(r => r.order === o.id && r.status === 'Dispatched').reduce((a, r) => a + r.qty, 0); return [o.id, cName(o.cust), o.dest, q, d, (d / q * 100).toFixed(1), o.status]; })],
  'Packaging': () => [['Packing', 'Order', 'Grade', 'Packaging', 'Full packs', 'Remainder kg', 'Actual kg'], ...S.packings.flatMap(p => p.lines.map(l => [p.id, p.order, l.grade, pkName(l.pack), l.packs, l.remainder, l.actual]))],
  'Batch movement': () => [['Batch', 'Supplier', 'Origin', 'Received kg', 'Allocated kg', 'Unallocated kg', 'Consumed kg'], ...S.batches.map(b => { const x = E.batchBal(b.id); return [b.id, M.suppliers.find(s => s.id === b.supplier).name, b.origin, x.received, x.allocated, x.unallocated, x.consumed]; })]
};
V.reports = () => {
  App.sub.reportsSeen = S.orders.some(o => o.id === 'ORD-DEMO-001' && o.status === 'Dispatched');
  const k = App.sub.rep || 'Factory production'; const rows = REPORTS[k](); const isNum = v => typeof v === 'number';
  const m = metrics(); const ledgerProduced = S.ledger.filter(l => l.type === 'PRODUCE' && facOk(S.lots.find(x => x.id === l.lot).fac)).reduce((a, l) => a + l.qty, 0);
  const ledgerDisp = S.ledger.filter(l => l.type === 'DISPATCH').reduce((a, l) => a + l.qty, 0);
  return `<div class="grid g3"><div class="card"><h3>Reconciliation check</h3>
  <table><tr><td>Kernel output (production records)</td><td class="num">${kg(m.kern)}</td></tr><tr><td>PRODUCE movements (inventory ledger)</td><td class="num">${kg(ledgerProduced)}</td></tr>
  <tr><td colspan="2">${Math.abs(m.kern - ledgerProduced) < 0.01 ? pill('PASS') + ' Totals reconcile' : pill('HOLD') + ' Mismatch'}</td></tr>
  <tr><td>Dispatched (ledger)</td><td class="num">${kg(ledgerDisp)}</td></tr><tr><td>Dispatched (dispatch records)</td><td class="num">${kg(S.dispatches.reduce((a, d) => a + d.qty, 0))}</td></tr></table></div>
  <div class="card" style="grid-column:span 2"><h3>Future automations (not built — require client approval)</h3><div class="grid g2 small">
  <div class="alert info">A16 Smart factory allocation suggestions</div><div class="alert info">A17 Explainable anomaly detection on recovery</div><div class="alert info">A18 Scheduled daily / weekly summaries</div><div class="alert info">A19 Document extraction with human review · A20 NL reporting assistant</div></div></div></div>
  <div class="card"><div class="tabs">${Object.keys(REPORTS).map(r => `<button class="${r === k ? 'on' : ''}" onclick="App.sub.rep='${r}';App.render()">${r}</button>`).join('')}</div>
  <div class="row" style="margin-bottom:10px"><span class="muted small">${rows.length - 1} rows · filter: ${App.fac() ? fName(App.fac()) : 'all factories'}</span><span class="spacer"></span><button class="btn sm" onclick="csv('${k}')">⬇ Export CSV</button></div>
  ${table(rows[0].map((h, i) => isNum(rows[1]?.[i]) ? h + '#' : h), rows.slice(1).map(r => `<tr>${r.map(v => `<td class="${isNum(v) ? 'num' : ''}">${isNum(v) ? v.toLocaleString('en-GB', {maximumFractionDigits: 3}) : esc(v)}</td>`).join('')}</tr>`))}</div>`;
};
function csv(k) { const rows = REPORTS[k](); const t = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], {type: 'text/csv'})); a.download = k.toLowerCase().replace(/ /g, '-') + '-demo.csv'; a.click(); toast('CSV exported', 'ok'); }

V.settings = () => {
  const tab = App.sub.setTab || 'profile'; const P = M.profile;
  const T = {
    rules: rulesHtml(),
    appearance: appearanceHtml(),
    profile: `<div class="grid g2"><div><h3>Company profile <span class="r muted small">from public website</span></h3><dl class="facts"><dt>Established</dt><dd>${P.established}</dd><dt>Headquarters</dt><dd>${P.hq}</dd><dt>Operations</dt><dd>${P.operations}</dd><dt>Minimum order</dt><dd>${kg(P.moq)} per grade</dd><dt>Packaging</dt><dd>Flexi-pouch (CO₂ + N₂, partial vacuum) and vacuum-sealed tins</dd><dt>Quality spec</dt><dd>${P.specSource}</dd></dl>
      <h3 style="margin-top:18px">Capabilities</h3><div class="chipset">${P.capabilities.map(x => `<span class="chip">${x}</span>`).join('')}</div></div>
      <div><h3>Certifications</h3><div class="chipset">${P.certifications.map(x => `<span class="chip on">✓ ${x}</span>`).join('')}</div><p class="spec" style="margin-top:6px">Certificate numbers and expiry dates are not public — tracked here once provided.</p>
      <h3 style="margin-top:18px">Export markets</h3><div class="chipset">${P.markets.map(x => `<span class="chip">${x}</span>`).join('')}</div>
      <h3 style="margin-top:18px">Raw nut sourcing origins</h3><div class="chipset">${P.origins.map(x => `<span class="chip">${x}</span>`).join('')}</div>
      <h3 style="margin-top:18px">Related group entities</h3>${table(['Type', 'Location'], P.related.map(([t, l]) => `<tr><td>${t}</td><td>${l}</td></tr>`))}<p class="spec" style="margin-top:6px">Candidates for inter-company transfers and consolidated reporting.</p></div></div>`,
    audit: table(['Date', 'Actor', 'Action', 'Entity', 'Detail'], S.audit.slice(0, 80).map(a => `<tr><td>${fmtDate(a.ts)}</td><td>${esc(a.actor)}</td><td><b>${esc(a.action)}</b></td><td class="mono">${esc(a.entity)}</td><td class="small">${esc(a.detail)}</td></tr>`)),
    roles: table(['Role', 'User', 'Scope'], M.roles.map(r => `<tr><td><b>${r}</b></td><td>${M.people[r]}</td><td class="small">${{'Managing Director': 'All factories, dashboards, reports, settings', 'Factory Manager': 'Assigned factory only (e.g. Factory 01)', 'Production Supervisor': 'Production drafts, consumption, outputs', 'Quality Inspector': 'Inspections and PASS/HOLD/REJECT', 'Inventory Manager': 'Stock, transfers, reservations', 'Sales / Export Manager': 'Customers, orders, packing, dispatch', 'Auditor': 'Read-only — no create/update/delete'}[r]}</td></tr>`)),
    masters: `<div class="grid g2"><div><h3>Packing centres</h3>${table(['Code', 'Name', 'Location'], M.packingCentres.map(p => `<tr><td>${p.id}</td><td>${p.name}</td><td>${p.location}</td></tr>`))}</div><div><h3>Warehouses</h3>${table(['Code', 'Name'], M.warehouses.map(w => `<tr><td>${w.id}</td><td>${w.name}</td></tr>`))}</div>
    <div><h3>Suppliers</h3>${table(['Code', 'Name', 'Country'], M.suppliers.map(s => `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.country}</td></tr>`))}</div><div><h3>Customers</h3>${table(['Code', 'Name', 'Country'], M.customers.map(s => `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.country}</td></tr>`))}</div>
    <div><h3>Packaging</h3>${table(['Code', 'Name', 'Method'], M.packaging.map(p => `<tr><td>${p.id}</td><td>${p.name}</td><td class="small">${p.method}</td></tr>`))}</div><div><h3>Output categories</h3>${table(['Code', 'Name', 'Required for mass balance'], M.outputTypes.map(p => `<tr><td>${p.id}</td><td>${p.name}</td><td>${p.required ? 'Yes' : 'No'}</td></tr>`))}</div></div>`,
  };
  return `<div class="card"><div class="tabs">${[['profile', 'Company profile'], ['rules', 'Business rules'], ['appearance', 'Appearance'], ['audit', 'Audit log'], ['roles', 'Roles & permissions'], ['masters', 'Master data']].map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" onclick="App.sub.setTab='${k}';App.render()">${t}</button>`).join('')}</div>${T[tab]}</div>`;
};


/* ============================ COSTING, RULES, LEDGER, IMPORT, APPEARANCE ============================ */
IC.costing = '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
const usd = n => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const kor = (kernel, input) => input > 0 ? kernel * 2.20462 / (input / 80) : null;
const rule = id => M.rules.find(r => r.id === id);
const batchPrice = id => { const b = S.batches.find(x => x.id === id); return b ? (b.price || M.costing.rcn[b.origin] || 1.45) : 0; };

/* Joint-cost split: one raw-nut pool → graded outputs, each taking its share of cost (last line takes rounding) */
E.cost = (run, meth = 'rsv', target = 15) => {
  const input = run.cons.reduce((s, c) => s + (+c.qty || 0), 0);
  const raw = run.cons.reduce((s, c) => s + (+c.qty || 0) * batchPrice(c.batch), 0);
  const proc = input * (M.costing.labour + M.costing.overhead);
  const shell = run.other.filter(o => o.type === 'SHELL').reduce((s, o) => s + (+o.qty || 0), 0);
  const credit = shell * M.costing.shellCredit; const joint = raw + proc - credit;
  const lines = run.outputs.filter(o => +o.qty > 0).map(o => ({grade: o.grade, qty: +o.qty, price: M.prices[o.grade] || 0})).map(l => ({...l, value: l.qty * l.price}));
  const tv = lines.reduce((s, l) => s + l.value, 0), tq = lines.reduce((s, l) => s + l.qty, 0);
  let acc = 0; const R6 = rule('R06');
  lines.forEach((l, i) => {
    l.share = meth === 'weight' ? l.qty / tq : (tv ? l.value / tv : 0);
    l.cost = i === lines.length - 1 ? Math.round((joint - acc) * 100) / 100 : Math.round(joint * l.share * 100) / 100; acc += l.cost;
    l.costKg = l.cost / l.qty; l.pl = l.value ? (l.value - l.cost) * 100 / l.value : null;
    l.target = l.costKg * (100 + target) / 100; l.flag = l.pl != null && (l.pl < R6.lo || l.pl > R6.hi);
  });
  return {input, raw, proc, shell, credit, joint, lines, tv, tq, margin: tv ? (tv - joint) * 100 / tv : null, costKg: tq ? joint / tq : null, kor: kor(tq, input), allocated: acc};
};
const lotCostKg = lotId => { const l = S.lots.find(x => x.id === lotId); const r = l && S.runs.find(x => x.id === l.run); if (!r) return null; const ln = E.cost(r).lines.find(x => x.grade === l.grade); return ln ? ln.costKg : null; };
function lineMargin(l) {
  const price = M.prices[l.grade]; if (!price) return '';
  const rs = S.reservations.filter(r => r.line === l.id && r.status !== 'Released');
  let ck; if (rs.length) { const q = rs.reduce((s, r) => s + r.qty, 0); ck = rs.reduce((s, r) => s + r.qty * (lotCostKg(r.lot) || 0), 0) / q; }
  else { const lots = S.lots.filter(x => x.grade === l.grade && x.qc === 'PASS').slice(-5); ck = lots.length ? lots.reduce((s, x) => s + (lotCostKg(x.id) || 0), 0) / lots.length : null; }
  if (!ck) return '';
  const m = (price - ck) * 100 / price;
  return ` · Est. margin <b style="color:${m < 0 ? 'var(--bad-ink)' : 'var(--ok-ink)'}">&nbsp;${m.toFixed(1)}%</b> <span class="muted">(${usd(price)}/kg vs cost ${usd(ck)}/kg)</span>`;
}

/* Rule checks for draft runs (information only — same rules as the Rules panel) */
E.checkRun = run => {
  const out = []; const c = E.calc(run);
  if (!(c.input > 0)) out.push('No raw input recorded');
  const per = {}; run.cons.forEach(x => { if (x.batch) per[x.batch] = (per[x.batch] || 0) + (+x.qty || 0); });
  if (run.status !== 'Posted') Object.entries(per).forEach(([b, q]) => { const av = E.allocAvail(run.fac, b); if (q > av + 1e-6) out.push(`${b}: ${kg(q)} exceeds ${fName(run.fac)} allocation of ${kg(av)} (R02)`); });
  if (!c.kernel) out.push('No grade outputs recorded');
  if (c.missing.length) out.push(`Missing output streams: ${c.missing.join(', ')} (R03)`);
  if (c.input > 0 && c.complete && Math.abs(c.variance) / c.input * 100 > rule('R04').val) out.push(`Mass-balance variance ${(c.variance / c.input * 100).toFixed(2)}% is outside ± ${rule('R04').val}% (R04)`);
  const hist = S.runs.filter(r => r.status === 'Posted' && r.fac === run.fac && r.id !== run.id).map(E.calc);
  if (c.recovery != null && hist.length) { const i = hist.reduce((s, h) => s + h.input, 0), k = hist.reduce((s, h) => s + h.kernel, 0); const avg = k / i * 100; const dev = (c.recovery - avg) / avg * 100; if (Math.abs(dev) > rule('R05').val) out.push(`Recovery ${pct(c.recovery)} is ${dev > 0 ? '+' : ''}${dev.toFixed(0)}% vs ${fName(run.fac)} average ${pct(avg)} (R05)`); }
  return out;
};
const checkPill = r => { const x = E.checkRun(r); return x.length ? `<span class="pill warn" title="${esc(x.join('\n'))}">⚠ Check</span>` : '<span class="pill ok">✓ Ready</span>'; };
function checksHtml(run) {
  const x = E.checkRun(run);
  return x.length ? `<div class="alert warn" style="margin-top:8px"><span><b>⚠ ${x.length} rule check${x.length > 1 ? 's' : ''} to review</b><br>${x.map(esc).join('<br>')}</span></div>` : '<div class="alert ok" style="margin-top:8px"><span>✓ All rule checks pass — ready to post</span></div>';
}
function rulesHtml() {
  return `<p class="muted small" style="margin-top:0">Business rules are configurable per company and read-only here. The same rules are checked on entry, on the lists and again before posting.</p>
  ${table(['Rule', 'Description', 'Default', 'Checked in'], M.rules.map(r => `<tr><td class="mono"><b>${r.id}</b></td><td>${r.name}</td><td><span class="pill brand">${r.def}</span></td><td class="small">${r.where}</td></tr>`))}`;
}
function rulesModal() { modal(`<h2>ⓘ Business rules</h2>${rulesHtml()}<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`); }

/* Raw batch running ledger: IN − OUT = balance on every date (never negative) */
function batchLedger(id) {
  const b = S.batches.find(x => x.id === id); const pr = batchPrice(id);
  const mv = S.batchMoves.filter(m => m.batch === id).map(m => ({...m})).sort((x, y) => x.ts.localeCompare(y.ts));
  let bal = 0, neg = false;
  const rows = mv.map(m => { const inn = m.type === 'RECEIPT' ? m.qty : 0, out = m.type === 'ALLOCATE' ? m.qty : 0; bal += inn - out; if (bal < -1e-6) neg = true;
    return `<tr><td>${fmtDate(m.ts)}</td><td>${m.type === 'RECEIPT' ? 'Goods receipt' : 'Transfer → ' + fName(m.fac)}</td><td class="mono">${m.ref}</td><td class="num">${inn ? kg(inn) : ''}</td><td class="num">${out ? kg(out) : ''}</td><td class="num"><b>${kg(bal)}</b></td><td class="num">${usd(bal * pr)}</td></tr>`; });
  const cons = S.allocations.filter(a => a.batch === id);
  modal(`<h2>Batch ledger — ${id}</h2><p class="muted">${M.suppliers.find(s => s.id === b.supplier).name} · ${b.origin} · ${usd(pr)} / kg landed</p>
  <div class="grid g4">${kpi('Received', kg(b.original), usd(b.original * pr))}${kpi('Transferred', kg(E.batchBal(id).allocated))}${kpi('In store', kg(E.batchBal(id).unallocated), usd(E.batchBal(id).unallocated * pr))}${kpi('Consumed in runs', kg(E.batchBal(id).consumed))}</div>
  <div class="sec">Store ledger · IN − OUT = balance</div>
  ${table(['Date', 'Movement', 'Reference', 'In#', 'Out#', 'Balance#', 'Value#'], rows)}
  <div class="alert ${neg ? 'bad' : 'ok'}" style="margin-top:8px"><span>${neg ? '⛔ Balance went negative on a date' : '✓ Balance never negative on any date — nothing transferred that the batch did not hold'}</span></div>
  <div class="sec">Factory stock from this batch</div>
  ${table(['Factory', 'Transferred#', 'Consumed#', 'Remaining#'], cons.map(a => `<tr><td>${fName(a.fac)}</td><td class="num">${kg(a.qty)}</td><td class="num">${kg(a.consumed)}</td><td class="num">${kg(a.qty - a.consumed)}</td></tr>`), 'Not transferred yet')}
  <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
}

/* CSV import of grade outputs (nothing posts until the user saves) */
function csvTemplate() { const t = 'grade,kg\nW-180,80\nW-210,120\nW-240,250\nW-320,450\nW-450,150\nSW-320,80\nS,70\nB,40\nLWP,50\nSWP,30\nBB,10\nSHELL,3480\nTESTA,115\nREJ,45\n'; const x = document.createElement('a'); x.href = URL.createObjectURL(new Blob([t], {type: 'text/csv'})); x.download = 'grade-output-template.csv'; x.click(); }
function csvImport(inp) {
  const f = inp.files[0]; if (!f) return; const rd = new FileReader();
  rd.onload = () => {
    const outs = [], oth = [], bad = [];
    rd.result.split(/\r?\n/).forEach(line => { const [code, q] = line.split(/[,;\t]/).map(s => (s || '').trim()); if (!code || isNaN(parseFloat(q))) return;
      const g = M.grades.find(x => x.id.toUpperCase() === code.toUpperCase() || x.id.replace('-', '') === code.toUpperCase().replace('-', ''));
      const t = M.outputTypes.find(x => x.id === code.toUpperCase() || x.name.toUpperCase().startsWith(code.toUpperCase()));
      if (g) outs.push({grade: g.id, qty: +q}); else if (t) oth.push({type: t.id, qty: +q}); else bad.push(code); });
    if (outs.length) draft.outputs = outs; if (oth.length) draft.other = oth;
    drawRunForm(); toast(`Imported ${outs.length} grade lines, ${oth.length} other streams${bad.length ? ' — unknown codes skipped: ' + bad.join(', ') : ''}`, bad.length ? 'warn' : 'ok');
  };
  rd.readAsText(f);
}

/* Appearance: accent colour themes */
const ACCENTS = [['amber', '#d97706'], ['teal', '#0d9488'], ['indigo', '#4f46e5'], ['ocean', '#0284c7'], ['emerald', '#059669'], ['rose', '#e11d48'], ['slate', '#475569']];
const Accent = { cur() { return document.documentElement.dataset.accent || 'teal'; }, set(a) { document.documentElement.dataset.accent = a; try { localStorage.setItem('ciq-accent', a); } catch (e) {} App.render(); } };
function appearanceHtml() {
  return `<div class="grid g2"><div><h3>Mode</h3><div class="chipset"><span class="chip ${Theme.cur() === 'light' ? 'on' : ''}" style="cursor:pointer" onclick="if(Theme.cur()!=='light')Theme.toggle();App.render()">☀ Light</span><span class="chip ${Theme.cur() === 'dark' ? 'on' : ''}" style="cursor:pointer" onclick="if(Theme.cur()!=='dark')Theme.toggle();App.render()">☾ Dark</span></div></div>
  <div><h3>Accent colour</h3><div class="swatches">${ACCENTS.map(([k, c]) => `<button class="swatch ${Accent.cur() === k ? 'on' : ''}" style="--sw:${c}" onclick="Accent.set('${k}')"><i></i>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div><p class="spec">Every colour in the app follows the selected accent, in light and dark mode.</p></div></div>`;
}

/* Costing & margin screen */
V.costing = () => {
  const posted = S.runs.filter(r => r.status === 'Posted' && facOk(r.fac));
  if (!posted.length) return '<div class="card empty">No posted production runs yet</div>';
  let sel = App.sub.costing; if (!posted.some(r => r.id === sel)) sel = (posted.find(r => r.id === 'PROD-DEMO-001') || posted[posted.length - 1]).id;
  const meth = App.sub.costMeth || 'rsv', tm = App.sub.target ?? 15;
  const run = S.runs.find(r => r.id === sel); const c = E.cost(run, meth, tm);
  const all = posted.map(r => E.cost(r, meth, tm)); const J = all.reduce((s, x) => s + x.joint, 0), TV = all.reduce((s, x) => s + x.tv, 0), TQ = all.reduce((s, x) => s + x.tq, 0), TI = all.reduce((s, x) => s + x.input, 0);
  const byG = {}; all.forEach(x => x.lines.forEach(l => { const g = byG[l.grade] = byG[l.grade] || {qty: 0, cost: 0, value: 0}; g.qty += l.qty; g.cost += l.cost; g.value += l.value; }));
  const flagged = c.lines.filter(l => l.flag).length;
  return `<div class="grid g4">${kpi('Joint cost (posted runs)', usd(J), posted.length + ' runs', '', 'costing')}${kpi('Kernel sales value', usd(TV), 'at price list')}${kpi('Gross margin', pct(TV ? (TV - J) * 100 / TV : null), 'value − cost ÷ value', '', 'percent')}${kpi('Avg kernel cost', usd(TQ ? J / TQ : 0) + '/kg', 'KOR ' + (kor(TQ, TI) || 0).toFixed(1) + ' lbs / 80 kg bag', '', 'scale')}</div>
  <div class="card"><h3>Grade cost split <span class="r"><select class="sel-sm" onchange="App.go('costing',this.value)">${posted.slice().reverse().map(r => `<option ${r.id === sel ? 'selected' : ''}>${r.id}</option>`).join('')}</select></span></h3>
    <div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">${[['rsv', 'By sales value'], ['weight', 'By weight']].map(([k, t]) => `<button class="${k === meth ? 'on' : ''}" onclick="App.sub.costMeth='${k}';App.render()">${t}</button>`).join('')}</div>
    <label style="display:flex;align-items:center;gap:6px">Target margin % <input type="number" value="${tm}" style="width:70px" onchange="App.sub.target=+this.value;App.render()"></label><span class="spacer"></span><button class="btn sm" onclick="rulesModal()">ⓘ Rules</button></div>
    <div class="grid g4" style="margin-bottom:12px">${kpi('Raw nut', usd(c.raw), kg(c.input) + ' × landed price')}${kpi('Processing', usd(c.proc), usd(M.costing.labour + M.costing.overhead) + '/kg labour + overhead')}${kpi('Shell credit', '−' + usd(c.credit), kg(c.shell) + ' × ' + usd(M.costing.shellCredit))}${kpi('Joint cost to split', usd(c.joint), 'KOR ' + (c.kor || 0).toFixed(1) + ' · ' + usd(c.costKg) + '/kg kernel')}</div>
    ${table(['Grade', 'Kernel#', 'Price / kg#', 'Sales value#', 'Share#', 'Cost amt#', 'Cost / kg#', 'P/L %#', 'Price @ target#'],
      [`<tr class="total"><td>Total · ${c.lines.length} grades</td><td class="num">${kg(c.tq)}</td><td class="num">${usd(c.tv / c.tq)}</td><td class="num">${usd(c.tv)}</td><td class="num">100%</td><td class="num">${usd(c.allocated)}</td><td class="num">${usd(c.costKg)}</td><td class="num">${pct(c.margin)}</td><td class="num"></td></tr>`,
       ...c.lines.map((l, i) => `<tr><td class="mono"><b>${l.grade}</b></td><td class="num">${kg(l.qty)}</td><td class="num">${usd(l.price)}</td><td class="num">${usd(l.value)}</td><td class="num">${(l.share * 100).toFixed(1)}%</td><td class="num">${usd(l.cost)}${i === c.lines.length - 1 ? ' <span class="muted small" title="Rounding difference goes to the last line (R07)">*</span>' : ''}</td><td class="num">${usd(l.costKg)}</td><td class="num"><span class="pill ${l.flag ? 'bad' : l.pl < 0 ? 'warn' : 'ok'}" ${l.flag ? 'title="Outside the −20% to +40% range (R06)"' : ''}>${pct(l.pl)}</span></td><td class="num">${usd(l.target)}</td></tr>`)])}
    <div class="row" style="margin-top:10px"><span class="pill ${Math.abs(c.allocated - c.joint) < 0.005 ? 'ok' : 'bad'}">Split cost ${usd(c.allocated)} = joint cost ${usd(c.joint)}</span>${flagged ? `<span class="pill bad">${flagged} grade(s) outside P/L range</span>` : ''}</div>
    <div class="formula" style="margin-top:10px">${meth === 'rsv' ? 'Share = grade sales value ÷ total sales value — every grade earns the same margin; best for valuing stock' : 'Share = grade kg ÷ total kernel kg — shows which grades really make or lose money'} · Cost/kg = cost amt ÷ kg · P/L % = (value − cost) × 100 ÷ value · Price @ target = cost/kg × (100 + target%) ÷ 100 · * last line takes rounding</div></div>
  <div class="grid g2">
    <div class="card"><h3>Grade profitability — all posted runs</h3>${table(['Grade', 'Kernel#', 'Cost / kg#', 'Price / kg#', 'Margin#'], Object.entries(byG).sort((x, y) => y[1].value - x[1].value).map(([g, x]) => { const m = (x.value - x.cost) * 100 / x.value; return `<tr><td class="mono"><b>${g}</b></td><td class="num">${kg(Math.round(x.qty))}</td><td class="num">${usd(x.cost / x.qty)}</td><td class="num">${usd(M.prices[g] || 0)}</td><td class="num"><span class="pill ${m < 0 ? 'bad' : m < 10 ? 'warn' : 'ok'}">${pct(m)}</span></td></tr>`; }))}</div>
    <div class="card"><h3>Price list & cost inputs <span class="r muted small">illustrative — edit to try</span></h3>
      <div class="sec" style="margin-top:0">Kernel price per kg (FOB)</div><div class="pricegrid">${M.grades.map(g => `<label>${g.id}<input type="number" step="0.1" value="${M.prices[g.id] || 0}" onchange="M.prices['${g.id}']=+this.value;App.render()"></label>`).join('')}</div>
      <div class="sec">Raw nut landed price per kg</div><div class="pricegrid">${Object.keys(M.costing.rcn).map(o => `<label>${o}<input type="number" step="0.01" value="${M.costing.rcn[o]}" onchange="M.costing.rcn['${o}']=+this.value;S.batches.filter(b=>b.origin==='${o}').forEach(b=>b.price=+this.value);App.render()"></label>`).join('')}</div>
      <div class="sec">Processing & by-product</div><div class="pricegrid"><label>Labour / kg<input type="number" step="0.01" value="${M.costing.labour}" onchange="M.costing.labour=+this.value;App.render()"></label><label>Overhead / kg<input type="number" step="0.01" value="${M.costing.overhead}" onchange="M.costing.overhead=+this.value;App.render()"></label><label>Shell credit / kg<input type="number" step="0.01" value="${M.costing.shellCredit}" onchange="M.costing.shellCredit=+this.value;App.render()"></label></div></div>
  </div>`;
};

/* ============================ GUIDED TOUR ============================ */
const Tour = {
  i: 0,
  steps: [
    {r: 'dashboard', t: 'Management dashboard', p: 'Consolidated KPIs across seven fictional factories — every figure is derived from underlying transactions. Alerts surface holds, incomplete mass balance and arrived shipments. Let\'s run one complete journey.'},
    {r: 'shipments', t: '1 · Shipment & goods receipt', p: 'SHP-DEMO-001 from Supplier A (Ivory Coast) has arrived. Posting the goods receipt automatically creates raw batch RCN-DEMO-001.', do: () => { if (!S.batches.find(b => b.id === 'RCN-DEMO-001')) { E.postReceipt('SHP-DEMO-001', 25000, 'WH-RAW-1', 'RCN-DEMO-001'); toast('✓ RCN-DEMO-001 created — 25,000 kg', 'ok'); } }},
    {r: 'batches', t: '2 · Factory allocation', p: 'Try allocating 30,000 kg — the system blocks over-allocation. Then 5,000 kg goes to Factory 01, leaving 20,000 kg unallocated.', do: () => { try { E.allocate('RCN-DEMO-001', 'F01', 30000); } catch (e) { toast('⛔ ' + e.message, 'bad'); } if (!S.allocations.find(a => a.batch === 'RCN-DEMO-001')) { E.allocate('RCN-DEMO-001', 'F01', 5000); toast('✓ 5,000 kg allocated to Factory 01 — 20,000 kg remain unallocated', 'ok'); } }},
    {r: 'production', t: '3 · Production run & grade outputs', p: 'PROD-DEMO-001 consumes 5,000 kg and records 11 grade outputs totalling 1,330 kg → 26.6% recovery. Shell/testa are recorded so mass balance is complete. Posting creates finished lots (A03–A06).', do: () => { if (!S.runs.find(r => r.id === 'PROD-DEMO-001')) { runForm({code: 'PROD-DEMO-001', fac: 'F01', date: M.today, shift: 'Morning', supervisor: 'S. Pillai', line: 'Line 2', cons: [{batch: 'RCN-DEMO-001', qty: 5000}], outputs: Object.entries(M.sampleOutput).map(([grade, qty]) => ({grade, qty})), other: [{type: 'SHELL', qty: 3480}, {type: 'TESTA', qty: 115}, {type: 'REJ', qty: 45}]}); } }, note: 'Review the live calculation, then click “Save & post”.'},
    {r: 'quality', t: '4 · Quality inspection', p: 'New lots are not saleable until inspected. We PASS the W-320 lot (releases stock) and HOLD the W-450 lot (stays blocked).', do: () => { ['W320', 'W450'].forEach((g, i) => { const l = S.lots.find(x => x.id === 'FG-DEMO-001-' + g); if (l && l.qc === 'Pending') E.inspect(l.id, i ? 'HOLD' : 'PASS', {moist: i ? '5.6' : '4.5', broken: '3.0', nlg: '2.1', colour: 'Conforms', infest: 'None found'}, i ? 'Moisture 5.6% above 5% reference — re-dry and re-test' : 'Meets customer spec'); }); toast('W-320 PASS · W-450 HOLD', 'ok'); }},
    {r: 'inventory', t: '5 · Inventory ledger', p: 'Balances come from the append-only ledger: PRODUCE → RELEASE → RESERVE → PACK → DISPATCH. Held stock is excluded from available-to-promise.', do: () => { App.sub.invTab = 'ledger'; }},
    {r: 'orders', t: '6 · Customer order', p: 'ABC Foods (UK) orders 300 kg W-320 in 25 lb flexi-pouches. 25 lb = 11.33980925 kg → 26 full packs + 5.165 kg remainder.', do: () => { if (!S.orders.find(o => o.id === 'ORD-DEMO-001')) { const o = E.createOrder({code: 'ORD-DEMO-001', cust: 'CUS-01', dest: 'United Kingdom', ship: addDays(M.today, 14), curr: 'GBP', lines: [{grade: 'W-320', qty: 300, pack: 'PK-25F'}]}); E.confirm(o.id); } App.sub.orders = 'ORD-DEMO-001'; }},
    {r: 'orders', t: '7 · Stock reservation', p: 'The system suggests released W-320 lots (oldest first); the user confirms. Reserving HOLD/REJECT stock or over-reserving is blocked.', do: () => { const o = S.orders.find(x => x.id === 'ORD-DEMO-001'); if (o.status !== 'Reserved' && o.status !== 'Packed' && o.status !== 'Dispatched') { const l = o.lines[0]; const lot = S.lots.find(x => x.id === 'FG-DEMO-001-W320'); try { E.reserve(o.id, l.id, 'FG-DEMO-001-W450', 300); } catch (e) { toast('⛔ ' + e.message, 'bad'); } E.reserve(o.id, l.id, lot.id, Math.min(300, E.bal(lot.id).available)); if (o.status !== 'Reserved') E.suggest(l).filter(s => s.take > 0).forEach(s => E.reserve(o.id, l.id, s.lot.id, s.take)); toast('✓ 300 kg W-320 reserved', 'ok'); } App.sub.orders = 'ORD-DEMO-001'; }},
    {r: 'packing', t: '8 · Packing', p: 'Packing Centre 01 records 26 full 25 lb pouches plus a 5.165 kg remainder pack — never silently rounded to 27.', do: () => { if (!S.packings.find(p => p.order === 'ORD-DEMO-001')) { E.pack('ORD-DEMO-001', 'PC01', 'Packing crew A'); toast('✓ Packing recorded', 'ok'); } }},
    {r: 'dispatch', t: '9 · Dispatch', p: 'Dispatch links packing records to a container and document checklist; stock is deducted exactly once. A second posting attempt is rejected.', do: () => { if (!S.dispatches.find(d => d.order === 'ORD-DEMO-001')) E.dispatch('ORD-DEMO-001', {container: 'DEMO-CONT-9001', forwarder: 'Demo Freight Ltd', vessel: 'MV Demo Horizon', checklist: {inv: true, pl: true, coo: true, phyto: true, bl: true, qc: true}}); try { E.dispatch('ORD-DEMO-001', {}); } catch (e) { toast('⛔ ' + e.message, 'bad'); } }},
    {r: 'trace', t: '10 · Traceability', p: 'From the finished W-320 lot back to the production run, raw batch and supplier shipment — and forward to the customer order and container.', do: () => { App.sub.trace = 'FG-DEMO-001-W320'; }},
    {r: 'costing', t: '11 · Grade costing & margin', p: 'The raw nut, processing cost and shell credit of PROD-DEMO-001 are shared across its 11 grades — by sales value or by weight — so every finished lot carries a cost per kg and a margin. KOR shows outturn in trade terms.', do: () => { App.sub.costing = 'PROD-DEMO-001'; }},
    {r: 'reports', t: '12 · Reports & reconciliation', p: 'Factory, grade, mass-balance, quality, stock and fulfilment reports — all reconcile with the ledger and export to CSV. End-to-end journey complete.', do: () => {}}
  ],
  start() { Tour.i = 0; Tour.show(); },
  show() {
    const s = Tour.steps[Tour.i]; App.go(s.r, s.r === 'orders' ? App.sub.orders : undefined);
    $('#tour').classList.remove('hidden');
    $('#tour').innerHTML = `<div class="prog"><i style="width:${(Tour.i + 1) / Tour.steps.length * 100}%"></i></div><h4>Guided tour · step ${Tour.i + 1} of ${Tour.steps.length}</h4><b style="font-size:16px">${s.t}</b><p style="margin-top:6px">${s.p}</p><div id="tourNote" class="small" style="margin:-6px 0 10px;color:#fbbf24"></div>
    <div class="row"><button class="btn sm" onclick="Tour.end()">Exit</button><span class="spacer"></span>${Tour.i ? '<button class="btn sm" onclick="Tour.i--;Tour.show()">← Back</button>' : ''}${s.do ? '<button class="btn sm primary" onclick="Tour.run()">▶ Do it for me</button>' : ''}${Tour.i < Tour.steps.length - 1 ? '<button class="btn sm" onclick="Tour.i++;Tour.show()">Next →</button>' : '<button class="btn sm primary" onclick="Tour.end()">Finish</button>'}</div>`;
  },
  run() { const s = Tour.steps[Tour.i]; if (App.ro()) return toast('Switch from Auditor role to run actions', 'warn'); try { s.do(); } catch (e) { toast('⛔ ' + e.message, 'bad'); } if (!$('#modal').classList.contains('hidden')) { $('#tourNote').textContent = s.note || ''; } else App.render(); },
  end() { $('#tour').classList.add('hidden'); }
};

seed();
