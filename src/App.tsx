import { useEffect, useMemo, useRef, useState } from "react";

const COMMISSION = 0.08;
const PROC_PCT = 0.029;
const PROC_FLAT = 0.30;
const STORAGE_KEY = "dahlia_tonie_tracker_v5";
const OLD_KEYS = ["dahlia_tonie_tracker_v4", "dahlia_tonie_tracker_v3", "dahlia_tonie_tracker_v2"];
const SETTINGS_KEY = "dahlia_tonie_settings_v5";
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbziJgxAQhzdRd2MShDnHkGfHQxIbpp7Hbn6Zn-FDDEatNDNNOq6w8kmXECMNzJlXezB/exec";

const CONDITIONS = ["New (sealed)", "Like New", "Good", "Fair"];
const STATUSES = ["In Stock", "Listed", "Sold"];
const STATUS_COLORS: Record<string, string> = { "In Stock": "#60a5fa", Listed: "#f59e0b", Sold: "#22c55e" };

type Unit = { id: string; name: string; status: string; goalSellPrice: string; actualSalePrice: string; notes: string };
type Lot = { id: string; name: string; condition: string; source: string; productTotal: string; shippingTotal: string; goalSellPrice: string; notes: string; units: Unit[] };
type Settings = { syncMode: "manual" | "auto"; lastSynced: number | null };

type FlatUnit = { lot: Lot; unit: Unit; unitIndex: number; productUnit: number; shippingUnit: number; totalUnit: number; breakEven: number; payout: number | null; profit: number | null };

const EMPTY_FORM = { name: "", condition: "New (sealed)", source: "", productTotal: "", shippingTotal: "", quantity: "1", goalSellPrice: "", notes: "" };

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function num(v: any) { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; }
function money(n: number | null | undefined) { if (n === null || n === undefined || !Number.isFinite(n)) return "—"; return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`; }
function pct(n: number | null | undefined) { if (n === null || n === undefined || !Number.isFinite(n)) return "—"; return `${n.toFixed(0)}%`; }
function dateText(ts: number | null) { if (!ts) return "Never"; return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function payoutFromSale(sale: any) { const sp = num(sale); if (!sp) return null; return sp - sp * COMMISSION - (sp * PROC_PCT + PROC_FLAT); }
function breakEven(cost: number) { return (cost + PROC_FLAT) / (1 - COMMISSION - PROC_PCT); }
function lotProduct(lot: Lot) { return num(lot.productTotal); }
function lotShipping(lot: Lot) { return num(lot.shippingTotal); }
function lotQty(lot: Lot) { return Math.max(1, lot.units.length || 1); }
function productUnit(lot: Lot) { return lotProduct(lot) / lotQty(lot); }
function shipUnit(lot: Lot) { return lotShipping(lot) / lotQty(lot); }
function costUnit(lot: Lot) { return productUnit(lot) + shipUnit(lot); }
function lotTotal(lot: Lot) { return lotProduct(lot) + lotShipping(lot); }

function makeUnits(qty: number, goal: string, lotName: string): Unit[] {
  return Array.from({ length: Math.max(1, qty) }, (_, i) => ({
    id: uid(),
    name: Math.max(1, qty) > 1 ? `${lotName} #${i + 1}` : lotName,
    status: "In Stock",
    goalSellPrice: goal || "",
    actualSalePrice: "",
    notes: ""
  }));
}

function normalizeLot(raw: any): Lot {
  const rawUnits = Array.isArray(raw.units) && raw.units.length ? raw.units : makeUnits(parseInt(raw.quantity || raw.unitsInLot || "1") || 1, String(raw.goalSellPrice || ""), raw.name || raw.lotName || "Tonie");
  const product = raw.productTotal ?? raw.totalCostPaid ?? raw.lotProductCost ?? raw["Product Cost Total"] ?? raw["Lot Product Total"] ?? "";
  const shipping = raw.shippingTotal ?? raw.inboundShipping ?? raw.lotShipping ?? raw["Shipping Total"] ?? raw["Lot Shipping Total"] ?? "";
  return {
    id: String(raw.id ?? raw.lotId ?? uid()),
    name: String(raw.name ?? raw.lotName ?? raw["Lot Name"] ?? "Untitled Lot"),
    condition: String(raw.condition ?? raw["Condition"] ?? "New (sealed)"),
    source: String(raw.source ?? raw["Source"] ?? ""),
    productTotal: String(product ?? ""),
    shippingTotal: String(shipping ?? ""),
    goalSellPrice: String(raw.goalSellPrice ?? raw["Goal Price"] ?? ""),
    notes: String(raw.notes ?? raw["Notes"] ?? ""),
    units: rawUnits.map((u: any) => ({
      id: String(u.id ?? u.unitId ?? uid()),
      name: String(u.name ?? u.unitName ?? u["Unit Name"] ?? raw.name ?? "Tonie"),
      status: STATUSES.includes(String(u.status ?? u["Status"])) ? String(u.status ?? u["Status"]) : "In Stock",
      goalSellPrice: String(u.goalSellPrice ?? u["Goal Price"] ?? raw.goalSellPrice ?? ""),
      actualSalePrice: String(u.actualSalePrice ?? u["Sold For"] ?? ""),
      notes: String(u.notes ?? "")
    }))
  };
}

function loadInitialLots(): Lot[] {
  try {
    const direct = localStorage.getItem(STORAGE_KEY);
    const old = OLD_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    const parsed = JSON.parse(direct || old || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeLot) : [];
  } catch { return []; }
}

function flattenRows(lots: Lot[]) {
  const rows: any[] = [];
  lots.forEach((lot) => {
    const qty = lotQty(lot);
    const pu = productUnit(lot);
    const su = shipUnit(lot);
    const cu = costUnit(lot);
    lot.units.forEach((unit, index) => {
      const payout = payoutFromSale(unit.actualSalePrice);
      rows.push({
        lotId: lot.id,
        unitId: unit.id,
        lotName: lot.name,
        unitName: unit.name,
        condition: lot.condition,
        source: lot.source,
        unitsInLot: qty,
        lotProductTotal: index === 0 ? lotProduct(lot).toFixed(2) : "",
        lotShippingTotal: index === 0 ? lotShipping(lot).toFixed(2) : "",
        lotTotalCost: index === 0 ? lotTotal(lot).toFixed(2) : "",
        productCostPerUnit: pu.toFixed(2),
        shippingPerUnit: su.toFixed(2),
        totalCostPerUnit: cu.toFixed(2),
        breakEven: breakEven(cu).toFixed(2),
        goalSellPrice: unit.goalSellPrice || "",
        status: unit.status,
        actualSalePrice: unit.actualSalePrice || "",
        payoutAfterFees: payout !== null ? payout.toFixed(2) : "",
        profitVsCost: payout !== null ? (payout - cu).toFixed(2) : "",
        notes: index === 0 ? lot.notes || unit.notes || "" : unit.notes || "",
        syncedAt: new Date().toISOString()
      });
    });
  });
  return rows;
}

async function pushToSheets(lots: Lot[]) {
  await fetch(DEFAULT_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "sync", rows: flattenRows(lots) })
  });
}

function fetchJsonp(url: string, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sep = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      try { delete (window as any)[callbackName]; } catch { (window as any)[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Google Sheets read timed out")); }, timeoutMs);
    (window as any)[callbackName] = (data: any) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Google Sheets read failed")); };
    script.src = `${url}${sep}action=read&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

function rebuildLotsFromRows(rows: any[]): Lot[] {
  const map: Record<string, Lot> = {};
  const lastTotals: Record<string, { product: number; shipping: number; notes: string; qty: number }> = {};

  rows.filter(Boolean).forEach((row, idx) => {
    const lotId = String(row["Lot ID"] || row.lotId || "").trim();
    const lotName = String(row["Lot Name"] || row.lotName || "Untitled Lot").trim();
    const condition = String(row["Condition"] || row.condition || "New (sealed)").trim();
    const source = String(row["Source"] || row.source || "").trim();
    const key = lotId || `${lotName}|${condition}|${source}`;

    const rawProduct = row["Lot Product Total"] ?? row["Product Cost Total"] ?? row.lotProductTotal ?? row.lotProductCost;
    const rawShipping = row["Lot Shipping Total"] ?? row["Shipping Total"] ?? row.lotShippingTotal ?? row.lotShipping;
    const rawLegacyLotTotal = row["Lot Total Cost"] ?? row.lotTotalCost;
    const rowQty = num(row["Units In Lot"] || row.unitsInLot) || 1;

    let product = num(rawProduct);
    let shipping = num(rawShipping);
    if (!product && !shipping && num(rawLegacyLotTotal)) product = num(rawLegacyLotTotal);

    if (product || shipping) lastTotals[key] = { product, shipping, notes: String(row["Notes"] || row.notes || ""), qty: rowQty };
    const totals = lastTotals[key] || { product, shipping, notes: String(row["Notes"] || row.notes || ""), qty: rowQty };

    if (!map[key]) {
      map[key] = {
        id: key,
        name: lotName,
        condition,
        source,
        productTotal: totals.product ? String(totals.product) : "",
        shippingTotal: totals.shipping ? String(totals.shipping) : "",
        goalSellPrice: "",
        notes: totals.notes || "",
        units: []
      };
    } else {
      if (!map[key].productTotal && totals.product) map[key].productTotal = String(totals.product);
      if (!map[key].shippingTotal && totals.shipping) map[key].shippingTotal = String(totals.shipping);
      if (!map[key].notes && totals.notes) map[key].notes = totals.notes;
    }

    map[key].units.push({
      id: String(row["Unit ID"] || row.unitId || `${key}_${idx}`),
      name: String(row["Unit Name"] || row.unitName || lotName),
      status: STATUSES.includes(String(row["Status"] || row.status)) ? String(row["Status"] || row.status) : "In Stock",
      goalSellPrice: String(row["Goal Price"] ?? row.goalSellPrice ?? ""),
      actualSalePrice: String(row["Sold For"] ?? row.actualSalePrice ?? ""),
      notes: ""
    });
  });

  return Object.values(map).map(normalizeLot);
}

const APPS_SCRIPT_CODE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.action === 'sync') writeInventory(ss, data.rows || []);
    return output_({ status: 'ok' });
  } catch (err) {
    return output_({ status: 'error', message: String(err) });
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Inventory');
    var rows = [];
    if (sheet && sheet.getLastRow() > 1) {
      var values = sheet.getDataRange().getValues();
      var headers = values[0];
      rows = values.slice(1).filter(function(r) { return r.join('').trim() !== ''; }).map(function(r) {
        var obj = {};
        headers.forEach(function(h, i) { obj[h] = r[i]; });
        return obj;
      });
    }
    return output_({ rows: rows }, e);
  } catch (err) {
    return output_({ rows: [], error: String(err) }, e);
  }
}

function writeInventory(ss, rows) {
  var sheet = ss.getSheetByName('Inventory') || ss.insertSheet('Inventory');
  sheet.clearContents();
  sheet.clearFormats();

  var headers = [
    'Lot ID','Unit ID','Lot Name','Unit Name','Condition','Source','Units In Lot',
    'Lot Product Total','Lot Shipping Total','Lot Total Cost',
    'Product Cost / Unit','Shipping / Unit','Total Cost / Unit','Break Even',
    'Goal Price','Status','Sold For','Payout','Profit','Notes','Synced At'
  ];
  sheet.appendRow(headers);

  rows.forEach(function(r) {
    sheet.appendRow([
      r.lotId || '', r.unitId || '', r.lotName || '', r.unitName || '', r.condition || '', r.source || '', Number(r.unitsInLot || 1),
      r.lotProductTotal === '' ? '' : Number(r.lotProductTotal || 0),
      r.lotShippingTotal === '' ? '' : Number(r.lotShippingTotal || 0),
      r.lotTotalCost === '' ? '' : Number(r.lotTotalCost || 0),
      Number(r.productCostPerUnit || 0), Number(r.shippingPerUnit || 0), Number(r.totalCostPerUnit || r.costPerUnit || 0), Number(r.breakEven || 0),
      r.goalSellPrice ? Number(r.goalSellPrice) : '', r.status || 'In Stock',
      r.actualSalePrice ? Number(r.actualSalePrice) : '', r.payoutAfterFees ? Number(r.payoutAfterFees) : '', r.profitVsCost ? Number(r.profitVsCost) : '',
      r.notes || '', r.syncedAt || new Date().toISOString()
    ]);
  });

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = headers.length;
  var full = sheet.getRange(1, 1, lastRow, lastCol);
  full.setFontFamily('Arial').setFontSize(10).setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(1, 1, 1, lastCol).setBackground('#4a235a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);

  for (var i = 2; i <= lastRow; i++) {
    sheet.getRange(i, 1, 1, lastCol).setBackground(i % 2 === 0 ? '#f8f0ff' : '#ffffff').setFontColor('#222222');
    var statusCell = sheet.getRange(i, 16);
    var val = statusCell.getValue();
    if (val === 'Sold') statusCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
    if (val === 'Listed') statusCell.setBackground('#fff3cd').setFontColor('#856404').setFontWeight('bold');
    if (val === 'In Stock') statusCell.setBackground('#cce5ff').setFontColor('#004085').setFontWeight('bold');
    var profitCell = sheet.getRange(i, 19);
    var p = profitCell.getValue();
    if (p !== '') profitCell.setFontColor(Number(p) >= 0 ? '#155724' : '#721c24').setFontWeight('bold');
  }

  [8,9,10,11,12,13,14,15,17,18,19].forEach(function(col) {
    if (lastRow > 1) sheet.getRange(2, col, lastRow - 1, 1).setNumberFormat('"$"#,##0.00');
  });
  for (var c = 1; c <= lastCol; c++) sheet.autoResizeColumn(c);
  sheet.setFrozenRows(1);
}

function output_(obj, e) {
  var text = JSON.stringify(obj);
  if (e && e.parameter && e.parameter.callback) {
    return ContentService.createTextOutput(e.parameter.callback + '(' + text + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}`;

export default function App() {
  const [lots, setLots] = useState<Lot[]>(loadInitialLots);
  const [settings, setSettings] = useState<Settings>(() => {
    try { return { syncMode: "auto", lastSynced: null, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch { return { syncMode: "auto", lastSynced: null }; }
  });
  const [view, setView] = useState("dashboard");
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [editLotId, setEditLotId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const autoTimer = useRef<any>(null);
  const cloudLoaded = useRef(false);
  const skipNextAutoPush = useRef(false);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lots)); } catch {} }, [lots]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { pullFromSheets(true); }, []);
  useEffect(() => {
    if (!cloudLoaded.current) return;
    if (skipNextAutoPush.current) { skipNextAutoPush.current = false; return; }
    if (settings.syncMode === "auto") {
      clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => doPush(true), 1500);
    }
  }, [lots, settings.syncMode]);

  const allUnits: FlatUnit[] = useMemo(() => lots.flatMap(lot => lot.units.map((unit, unitIndex) => {
    const totalUnit = costUnit(lot);
    const payout = payoutFromSale(unit.actualSalePrice);
    return { lot, unit, unitIndex, productUnit: productUnit(lot), shippingUnit: shipUnit(lot), totalUnit, breakEven: breakEven(totalUnit), payout, profit: payout !== null ? payout - totalUnit : null };
  })), [lots]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUnits.filter(x => {
      const statusOk = filterStatus === "All" || x.unit.status === filterStatus;
      const qOk = !q || `${x.unit.name} ${x.lot.name} ${x.lot.source} ${x.lot.condition} ${x.unit.status}`.toLowerCase().includes(q);
      return statusOk && qOk;
    });
  }, [allUnits, filterStatus, search]);

  const stats = useMemo(() => {
    const totalInvested = lots.reduce((s, l) => s + lotTotal(l), 0);
    const sold = allUnits.filter(x => x.unit.status === "Sold");
    const listed = allUnits.filter(x => x.unit.status === "Listed");
    const stock = allUnits.filter(x => x.unit.status === "In Stock");
    const realizedProfit = sold.reduce((s, x) => s + (x.profit ?? -x.totalUnit), 0);
    const potentialProfit = allUnits.filter(x => x.unit.status !== "Sold").reduce((s, x) => {
      const projectedPayout = payoutFromSale(x.unit.goalSellPrice);
      return s + (projectedPayout !== null ? projectedPayout - x.totalUnit : 0);
    }, 0);
    const avgCost = allUnits.length ? allUnits.reduce((s, x) => s + x.totalUnit, 0) / allUnits.length : 0;
    return { totalInvested, realizedProfit, potentialProfit, avgCost, totalUnits: allUnits.length, sold: sold.length, listed: listed.length, stock: stock.length, lots: lots.length };
  }, [lots, allUnits]);

  function flash(text: string) { setMessage(text); setTimeout(() => setMessage(""), 3000); }

  async function doPush(silent = false) {
    setSyncStatus("syncing");
    try {
      await pushToSheets(lots);
      setSettings(s => ({ ...s, lastSynced: Date.now() }));
      setSyncStatus("success");
      if (!silent) flash("Pushed to Google Sheets");
    } catch (e: any) { setSyncStatus("error"); if (!silent) flash(e?.message || "Push failed"); }
    setTimeout(() => setSyncStatus("idle"), 2600);
  }

  async function pullFromSheets(silent = false) {
    setSyncStatus("syncing");
    try {
      const data = await fetchJsonp(DEFAULT_SCRIPT_URL);
      if (!data || data.error) throw new Error(data?.error || "Bad Google response");
      const nextLots = rebuildLotsFromRows(data.rows || []);
      skipNextAutoPush.current = true;
      setLots(nextLots);
      setSettings(s => ({ ...s, lastSynced: Date.now() }));
      setSyncStatus("success");
      if (!silent) flash(`Pulled ${nextLots.reduce((n, l) => n + l.units.length, 0)} units from Sheets`);
    } catch (e: any) { setSyncStatus("error"); if (!silent) flash(e?.message || "Pull failed"); }
    finally { cloudLoaded.current = true; }
    setTimeout(() => setSyncStatus("idle"), 3000);
  }

  function saveLot() {
    if (!form.name.trim() || !form.productTotal) return;
    const qty = Math.max(1, parseInt(form.quantity) || 1);
    if (editLotId) {
      setLots(prev => prev.map(l => {
        if (l.id !== editLotId) return l;
        let units = [...l.units];
        if (qty > units.length) for (let i = units.length; i < qty; i++) units.push({ id: uid(), name: `${form.name} #${i + 1}`, status: "In Stock", goalSellPrice: form.goalSellPrice || "", actualSalePrice: "", notes: "" });
        if (qty < units.length) units = units.slice(0, qty);
        units = units.map((u, i) => ({ ...u, name: u.name || (qty > 1 ? `${form.name} #${i + 1}` : form.name), goalSellPrice: u.goalSellPrice || form.goalSellPrice || "" }));
        return normalizeLot({ ...l, ...form, units });
      }));
      setEditLotId(null);
    } else {
      setLots(prev => [...prev, normalizeLot({ ...form, id: uid(), units: makeUnits(qty, form.goalSellPrice, form.name) })]);
    }
    setForm(EMPTY_FORM);
    setView("inventory");
  }

  function updateUnit(lotId: string, unitId: string, changes: Partial<Unit>) {
    setLots(prev => prev.map(l => l.id !== lotId ? l : { ...l, units: l.units.map(u => u.id !== unitId ? u : { ...u, ...changes }) }));
  }
  function updateLot(lotId: string, changes: Partial<Lot>) {
    setLots(prev => prev.map(l => l.id !== lotId ? l : { ...l, ...changes }));
  }
  function deleteUnit(lotId: string, unitId: string) {
    setLots(prev => prev.map(l => l.id !== lotId ? l : { ...l, units: l.units.filter(u => u.id !== unitId) }).filter(l => l.units.length));
  }
  function deleteLot(lotId: string) { if (confirm("Delete this whole lot?")) setLots(prev => prev.filter(l => l.id !== lotId)); }
  function editLot(lot: Lot) {
    setForm({ name: lot.name, condition: lot.condition, source: lot.source, productTotal: lot.productTotal, shippingTotal: lot.shippingTotal, quantity: String(lot.units.length), goalSellPrice: lot.goalSellPrice || "", notes: lot.notes || "" });
    setEditLotId(lot.id);
    setView("add");
  }
  function goInventory(status = "All") { setFilterStatus(status); setView("inventory"); }

  const formQty = Math.max(1, parseInt(form.quantity) || 1);
  const formProductUnit = num(form.productTotal) / formQty;
  const formShipUnit = num(form.shippingTotal) / formQty;
  const formUnitCost = formProductUnit + formShipUnit;
  const formBreakEven = formUnitCost ? breakEven(formUnitCost) : null;
  const projectedPayout = payoutFromSale(form.goalSellPrice);
  const expectedProfit = projectedPayout !== null ? projectedPayout - formUnitCost : null;
  const expectedRoi = expectedProfit !== null && formUnitCost ? (expectedProfit / formUnitCost) * 100 : null;
  const syncText = syncStatus === "syncing" ? "⏳ Syncing" : syncStatus === "success" ? "✓ Synced" : syncStatus === "error" ? "✗ Sync failed" : settings.lastSynced ? `☁ ${dateText(settings.lastSynced)}` : "☁ Ready";

  return <div className="page">
    <style>{css}</style>
    <header className="header">
      <div className="bear">🧸</div>
      <h1>Dahlia's Tonie Tracker</h1>
      <div className="sub">with love, Levy Yitschock 💕</div>
      <div className="syncBar">
        <span className={`syncBadge ${syncStatus}`}>{syncText}</span>
        <button onClick={() => doPush(false)} className="smallBtn">↑ Push</button>
        <button onClick={() => pullFromSheets(false)} className="smallBtn">↓ Pull</button>
        <button onClick={() => setView("settings")} className="gear">⚙️</button>
      </div>
      {message && <div className="toast">{message}</div>}
    </header>

    <main className="container">
      {view === "dashboard" && <Dashboard stats={stats} lots={lots} allUnits={allUnits} goInventory={goInventory} editLot={editLot} setView={setView} />}
      {view === "inventory" && <Inventory filteredUnits={filteredUnits} filterStatus={filterStatus} setFilterStatus={setFilterStatus} search={search} setSearch={setSearch} updateUnit={updateUnit} updateLot={updateLot} deleteUnit={deleteUnit} editLot={editLot} />}
      {view === "add" && <AddForm form={form} setForm={setForm} saveLot={saveLot} editLotId={editLotId} setEditLotId={setEditLotId} setView={setView} formQty={formQty} formProductUnit={formProductUnit} formShipUnit={formShipUnit} formUnitCost={formUnitCost} formBreakEven={formBreakEven} expectedProfit={expectedProfit} expectedRoi={expectedRoi} />}
      {view === "settings" && <SettingsView settings={settings} setSettings={setSettings} doPush={doPush} pullFromSheets={pullFromSheets} setLots={setLots} setView={setView} />}
    </main>

    <nav className="nav">
      <button onClick={() => setView("dashboard")} className={view === "dashboard" ? "navBtn active" : "navBtn"}>📊<span>Dashboard</span></button>
      <button onClick={() => setView("inventory")} className={view === "inventory" ? "navBtn active" : "navBtn"}>📦<span>Inventory</span></button>
      <button onClick={() => { setForm(EMPTY_FORM); setEditLotId(null); setView("add"); }} className={view === "add" ? "navBtn active" : "navBtn"}>➕<span>Add</span></button>
      <button onClick={() => setView("settings")} className={view === "settings" ? "navBtn active" : "navBtn"}>⚙️<span>Settings</span></button>
    </nav>
  </div>;
}

function Dashboard({ stats, lots, allUnits, goInventory, editLot, setView }: any) {
  const recentSold = allUnits.filter((x: FlatUnit) => x.unit.status === "Sold").slice(0, 5);
  const needsListing = allUnits.filter((x: FlatUnit) => x.unit.status === "In Stock").slice(0, 6);
  return <>
    <div className="statsGrid">
      <button className="statCard" onClick={() => goInventory("All")}><span>Total invested</span><b className="gold">{money(stats.totalInvested)}</b></button>
      <button className="statCard" onClick={() => goInventory("In Stock")}><span>In stock</span><b className="blue">{stats.stock}</b><em>{stats.listed} listed · {stats.sold} sold</em></button>
      <button className="statCard" onClick={() => goInventory("Sold")}><span>Profit in pocket</span><b className={stats.realizedProfit >= 0 ? "green" : "red"}>{money(stats.realizedProfit)}</b></button>
      <button className="statCard" onClick={() => goInventory("Listed")}><span>Potential profit</span><b className="blue">{money(stats.potentialProfit)}</b><em>Avg cost {money(stats.avgCost)}</em></button>
    </div>

    {lots.length === 0 ? <div className="empty"><div>📦</div><p>No Tonies yet — add your first purchase.</p><button className="primary" onClick={() => setView("add")}>+ Add Tonie</button></div> : <>
      <div className="dashGrid">
        <section className="panel"><h3>Lots Summary</h3>{lots.map((lot: Lot) => <div className="lotSummary" key={lot.id}><div><b>{lot.name}</b><small>{lot.units.length} units · {lot.condition} · {lot.source || "No source"}</small></div><div><strong>{money(lotTotal(lot))}</strong><small>{money(costUnit(lot))}/unit</small></div><button onClick={() => editLot(lot)}>Edit</button></div>)}</section>
        <section className="panel"><h3>Needs Listing</h3>{needsListing.length ? needsListing.map((x: FlatUnit) => <div className="miniLine" key={x.unit.id}><span>{x.unit.name}</span><b>{money(x.unit.goalSellPrice ? num(x.unit.goalSellPrice) : 0)}</b></div>) : <p className="muted">Nothing waiting in stock.</p>}</section>
        <section className="panel"><h3>Recent Sold</h3>{recentSold.length ? recentSold.map((x: FlatUnit) => <div className="miniLine" key={x.unit.id}><span>{x.unit.name}</span><b className={x.profit && x.profit >= 0 ? "green" : "red"}>{money(x.profit)}</b></div>) : <p className="muted">No sold units yet.</p>}</section>
      </div>
    </>}
  </>;
}

function Inventory({ filteredUnits, filterStatus, setFilterStatus, search, setSearch, updateUnit, updateLot, deleteUnit, editLot }: any) {
  return <>
    <div className="toolbar">
      <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit, lot, source…" />
      <div className="pills">{["All", "In Stock", "Listed", "Sold"].map(s => <button key={s} onClick={() => setFilterStatus(s)} className={filterStatus === s ? "pill active" : "pill"}>{s}</button>)}</div>
    </div>

    <div className="sheetWrap">
      <table className="inventoryTable">
        <thead><tr><th>Unit Name</th><th>Lot</th><th>Condition</th><th>Source</th><th>Status</th><th>Product/Unit</th><th>Ship/Unit</th><th>Cost/Unit</th><th>Break Even</th><th>Goal $</th><th>Sold $</th><th>Payout</th><th>Profit</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>{filteredUnits.map((x: FlatUnit) => <tr key={x.unit.id}>
          <td><input value={x.unit.name} onChange={e => updateUnit(x.lot.id, x.unit.id, { name: e.target.value })} /></td>
          <td><button className="lotLink" onClick={() => editLot(x.lot)}>{x.lot.name}</button></td>
          <td>{x.lot.condition}</td>
          <td><input value={x.lot.source} onChange={e => updateLot(x.lot.id, { source: e.target.value })} /></td>
          <td><select value={x.unit.status} onChange={e => updateUnit(x.lot.id, x.unit.id, { status: e.target.value })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></td>
          <td>{money(x.productUnit)}</td><td>{money(x.shippingUnit)}</td><td>{money(x.totalUnit)}</td><td>{money(x.breakEven)}</td>
          <td><input value={x.unit.goalSellPrice} onChange={e => updateUnit(x.lot.id, x.unit.id, { goalSellPrice: e.target.value })} inputMode="decimal" /></td>
          <td><input value={x.unit.actualSalePrice} onChange={e => updateUnit(x.lot.id, x.unit.id, { actualSalePrice: e.target.value, status: e.target.value ? "Sold" : x.unit.status })} inputMode="decimal" /></td>
          <td>{x.payout === null ? "—" : money(x.payout)}</td><td className={x.profit !== null && x.profit >= 0 ? "profitGood" : "profitBad"}>{x.profit === null ? "—" : money(x.profit)}</td>
          <td><input value={x.unit.notes} onChange={e => updateUnit(x.lot.id, x.unit.id, { notes: e.target.value })} /></td>
          <td><button className="dangerSmall" onClick={() => deleteUnit(x.lot.id, x.unit.id)}>Delete</button></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="mobileCards">{filteredUnits.map((x: FlatUnit) => <div className="unitCard" key={x.unit.id}>
      <div className="cardTop"><div><b>{x.unit.name}</b><small>Lot: {x.lot.name}</small></div><span style={{ color: STATUS_COLORS[x.unit.status] }}>{x.unit.status}</span></div>
      <div className="miniGrid"><Mini label="Product/Unit" value={money(x.productUnit)} /><Mini label="Ship/Unit" value={money(x.shippingUnit)} /><Mini label="Cost/Unit" value={money(x.totalUnit)} /><Mini label="Break Even" value={money(x.breakEven)} /></div>
      <div className="cardInputs"><Field label="Status"><select value={x.unit.status} onChange={e => updateUnit(x.lot.id, x.unit.id, { status: e.target.value })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Goal $"><input value={x.unit.goalSellPrice} onChange={e => updateUnit(x.lot.id, x.unit.id, { goalSellPrice: e.target.value })} /></Field><Field label="Sold $"><input value={x.unit.actualSalePrice} onChange={e => updateUnit(x.lot.id, x.unit.id, { actualSalePrice: e.target.value, status: e.target.value ? "Sold" : x.unit.status })} /></Field></div>
      {x.profit !== null && <div className={x.profit >= 0 ? "result good" : "result bad"}>Profit: {money(x.profit)}</div>}
      <div className="cardActions"><button onClick={() => editLot(x.lot)}>Edit Lot</button><button className="dangerSmall" onClick={() => deleteUnit(x.lot.id, x.unit.id)}>Delete Unit</button></div>
    </div>)}</div>
  </>;
}

function AddForm({ form, setForm, saveLot, editLotId, setEditLotId, setView, formQty, formProductUnit, formShipUnit, formUnitCost, formBreakEven, expectedProfit, expectedRoi }: any) {
  return <div className="formWrap">
    <h2>{editLotId ? "Edit Purchase Lot" : "Add Purchase Lot"}</h2>
    <Field label="Lot / Purchase Name"><input value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. eBay Tonies Lot" /></Field>
    <div className="twoCols"><Field label="Condition"><select value={form.condition} onChange={e => setForm((f: any) => ({ ...f, condition: e.target.value }))}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Source"><input value={form.source} onChange={e => setForm((f: any) => ({ ...f, source: e.target.value }))} placeholder="eBay, Whatnot, Woot, etc." /></Field></div>
    <div className="twoCols"><Field label="Product Cost Total"><input value={form.productTotal} onChange={e => setForm((f: any) => ({ ...f, productTotal: e.target.value }))} inputMode="decimal" placeholder="150" /></Field><Field label="Shipping Total"><input value={form.shippingTotal} onChange={e => setForm((f: any) => ({ ...f, shippingTotal: e.target.value }))} inputMode="decimal" placeholder="25" /></Field></div>
    <div className="twoCols"><Field label="How Many Units"><input value={form.quantity} onChange={e => setForm((f: any) => ({ ...f, quantity: e.target.value }))} inputMode="numeric" /></Field><Field label="Goal Sell Price / Unit"><input value={form.goalSellPrice} onChange={e => setForm((f: any) => ({ ...f, goalSellPrice: e.target.value }))} inputMode="decimal" placeholder="45" /></Field></div>
    <div className="calcBox"><div className="miniGrid"><Mini label="Product / Unit" value={money(formProductUnit)} /><Mini label="Shipping / Unit" value={money(formShipUnit)} /><Mini label="Total / Unit" value={money(formUnitCost)} /><Mini label="Break Even" value={formBreakEven ? money(formBreakEven) : "—"} /><Mini label="Expected Profit" value={money(expectedProfit)} /><Mini label="Expected ROI" value={pct(expectedRoi)} /></div><p className="muted">Example: product total ÷ units + shipping total ÷ units. For $150 product + $25 shipping ÷ 13 units = $13.46 per unit.</p></div>
    <Field label="Notes"><textarea value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
    <button className="primary" onClick={saveLot} disabled={!form.name || !form.productTotal}>{editLotId ? "Save Changes" : "Add to Inventory"}</button>
    {editLotId && <button className="secondary" onClick={() => { setEditLotId(null); setView("inventory"); }}>Cancel</button>}
  </div>;
}

function SettingsView({ settings, setSettings, doPush, pullFromSheets, setLots, setView }: any) {
  return <div className="formWrap">
    <button className="linkBtn" onClick={() => setView("dashboard")}>← Back</button>
    <h2>Settings</h2>
    <div className="panel"><h3>Google Sheets Sync</h3><p className="muted">Your Google Apps Script URL is built into the app, so new devices and incognito connect automatically. Paste this script into Google Apps Script when updating the sheet backend.</p><textarea className="codeBox" readOnly value={APPS_SCRIPT_CODE} onFocus={(e) => e.currentTarget.select()} />
      <Field label="Google Apps Script URL"><input value={DEFAULT_SCRIPT_URL} readOnly /></Field>
      <Field label="Sync Mode"><select value={settings.syncMode} onChange={e => setSettings((s: Settings) => ({ ...s, syncMode: e.target.value as Settings["syncMode"] }))}><option value="auto">Auto pull on open + auto push after edits</option><option value="manual">Manual only</option></select></Field>
      <div className="buttonRow"><button className="primary" onClick={() => doPush(false)}>Push to Sheets</button><button className="secondary" onClick={() => pullFromSheets(false)}>Pull from Sheets</button></div><p className="muted">Last synced: {dateText(settings.lastSynced)}</p></div>
    <div className="panel dangerPanel"><h3>Danger Zone</h3><button className="secondary danger" onClick={() => { if (confirm("Delete local data from this browser only?")) setLots([]); }}>Clear Local Data</button></div>
  </div>;
}

function Mini({ label, value }: { label: string; value: any }) { return <div className="mini"><small>{label}</small><b>{value}</b></div>; }
function Field({ label, children }: any) { return <label className="field"><span>{label}</span>{children}</label>; }

const css = `
*{box-sizing:border-box}body{margin:0}.page{min-height:100vh;background:linear-gradient(160deg,#0d0b1e 0%,#1a1035 60%,#0d1a2e 100%);color:#f8f7ff;font-family:Inter,system-ui,Segoe UI,sans-serif;padding-bottom:86px}.header{text-align:center;padding:22px 14px 10px;position:relative}.bear{font-size:31px}.header h1{margin:0;font-size:27px;font-weight:950;background:linear-gradient(90deg,#a78bfa,#f0abfc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.sub{font-size:12px;color:#c4b5fd;opacity:.75;font-style:italic}.syncBar{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px;flex-wrap:wrap}.syncBadge,.smallBtn{font-size:12px;padding:5px 10px;border-radius:9px;background:rgba(255,255,255,.065);font-weight:800;border:1px solid rgba(255,255,255,.12);color:#ddd6fe}.syncBadge.success{color:#22c55e}.syncBadge.error{color:#f87171}.syncBadge.syncing{color:#93c5fd}.smallBtn,.gear,button{cursor:pointer}.gear{background:none;border:0;font-size:18px}.toast{position:absolute;right:16px;top:12px;background:rgba(34,197,94,.16);color:#86efac;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:850}.container{width:min(1360px,calc(100% - 28px));margin:0 auto}.statsGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.statCard,.panel,.empty,.unitCard,.calcBox{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:16px;color:inherit}.statCard{text-align:left}.statCard span,.muted{color:#9ca3af;font-size:12px;line-height:1.5}.statCard b{display:block;font-size:25px;font-weight:950}.statCard em{display:block;font-size:12px;color:#9ca3af;font-style:normal}.gold{color:#fbbf24}.blue{color:#60a5fa}.green,.profitGood{color:#22c55e}.red,.profitBad{color:#ef4444}.dashGrid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}.panel h3{margin:0 0 12px;color:#c4b5fd;font-size:14px;text-transform:uppercase;letter-spacing:.8px}.lotSummary,.miniLine{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px;border-radius:10px;background:rgba(255,255,255,.04);margin-bottom:8px}.lotSummary small{display:block;color:#9ca3af}.lotSummary button,.cardActions button,.lotLink,.linkBtn{background:none;border:0;color:#c4b5fd;font-weight:850}.empty{text-align:center;padding:38px}.empty div{font-size:48px}.primary,.secondary{border:0;border-radius:12px;padding:12px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-weight:900}.secondary{background:transparent;border:1.5px solid #7c3aed;color:#c4b5fd;margin-left:10px}.danger{color:#f87171;border-color:#ef4444}.toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px}.search{min-width:320px}.pills{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#9ca3af;border-radius:999px;padding:8px 14px;font-weight:850}.pill.active{border-color:#a78bfa;color:#fff;background:rgba(167,139,250,.2)}input,select,textarea{width:100%;background:rgba(255,255,255,.075);border:1.5px solid rgba(255,255,255,.13);border-radius:10px;padding:9px 10px;color:#f8f7ff;font-size:14px;outline:none;font-family:inherit}textarea{min-height:74px}.sheetWrap{overflow:auto;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.035)}.inventoryTable{width:100%;border-collapse:collapse;min-width:1320px}.inventoryTable th{position:sticky;top:0;background:#27183f;color:#ddd6fe;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:10px;border-bottom:1px solid rgba(255,255,255,.12);z-index:1}.inventoryTable td{padding:7px;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;white-space:nowrap}.inventoryTable tr:hover{background:rgba(255,255,255,.04)}.inventoryTable input,.inventoryTable select{padding:6px 7px;border-radius:7px;font-size:13px;min-width:80px}.dangerSmall{border:1px solid #ef4444;background:transparent;color:#f87171;border-radius:8px;padding:6px 9px;font-weight:850}.mobileCards{display:none}.formWrap{max-width:900px;margin:0 auto}.formWrap h2{margin:0 0 16px}.twoCols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:block;margin-bottom:14px;color:#a78bfa;font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.7px}.field span{display:block;margin-bottom:6px}.miniGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.mini{background:rgba(255,255,255,.045);border-radius:10px;padding:10px}.mini small{display:block;color:#9ca3af;font-size:10px;margin-bottom:3px}.mini b{font-size:14px}.calcBox{margin-bottom:14px}.codeBox{min-height:270px;font-family:monospace;font-size:12px}.buttonRow{display:flex;gap:10px;flex-wrap:wrap}.dangerPanel{border-color:rgba(239,68,68,.35);margin-top:12px}.nav{position:fixed;bottom:0;left:0;right:0;background:rgba(13,11,30,.96);backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,.08);display:flex;padding:8px 0 12px;z-index:10}.navBtn{flex:1;background:none;border:0;color:#6b7280;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:20px;font-weight:850}.navBtn span{font-size:10px}.navBtn.active{color:#c4b5fd}option{background:#0d0b1e;color:#fff}@media(max-width:1050px){.statsGrid{grid-template-columns:repeat(2,1fr)}.dashGrid{grid-template-columns:1fr}.sheetWrap{display:none}.mobileCards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.toolbar{align-items:stretch;flex-direction:column}.search{min-width:0}.cardTop{display:flex;justify-content:space-between;gap:10px}.cardTop small{display:block;color:#9ca3af}.cardInputs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.result{margin-top:10px;border-radius:10px;padding:9px;background:rgba(255,255,255,.05);font-weight:900}.result.good{color:#22c55e}.result.bad{color:#ef4444}.cardActions{display:flex;gap:10px;margin-top:10px}}@media(max-width:640px){.statsGrid,.twoCols,.miniGrid,.mobileCards,.cardInputs{grid-template-columns:1fr}.container{width:min(100% - 22px,1360px)}.header h1{font-size:24px}.toast{position:static;display:inline-block;margin-top:8px}.secondary{margin-left:0;margin-top:8px}.lotSummary{grid-template-columns:1fr auto}.lotSummary button{grid-column:1/-1;text-align:left}}
`;
