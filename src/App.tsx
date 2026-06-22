import { useEffect, useMemo, useRef, useState } from "react";

const COMMISSION = 0.08;
const PROC_PCT = 0.029;
const PROC_FLAT = 0.30;
const STORAGE_KEY = "dahlia_tonie_tracker_v3";
const OLD_STORAGE_KEY = "dahlia_tonie_tracker_v2";
const SETTINGS_KEY = "dahlia_tonie_settings_v4";
const OLD_SETTINGS_KEY = "dahlia_tonie_settings_v3";
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbziJgxAQhzdRd2MShDnHkGfHQxIbpp7Hbn6Zn-FDDEatNDNNOq6w8kmXECMNzJlXezB/exec";

const CONDITIONS = ["New (sealed)", "Like New", "Good", "Fair"];
const SOURCES = ["eBay", "Facebook Marketplace", "Garage Sale", "Retail", "Lot", "Other"];
const STATUSES = ["In Stock", "Listed", "Sold"];
const statusColor: Record<string, string> = { "In Stock": "#60a5fa", Listed: "#f59e0b", Sold: "#22c55e" };

type Unit = { id: string | number; name: string; status: string; goalSellPrice?: string; actualSalePrice?: string; notes?: string };
type Lot = { id: string | number; name: string; condition: string; source: string; totalCostPaid: string; inboundShipping: string; quantity?: string; goalSellPrice?: string; notes?: string; units: Unit[] };
type Settings = { scriptUrl: string; syncMode: string; lastSynced: number | null };

const EMPTY_FORM = { name: "", condition: "New (sealed)", source: "eBay", totalCostPaid: "", inboundShipping: "", quantity: "1", goalSellPrice: "", notes: "" };

function num(v: any) { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; }
function money(n: number | null | undefined) { if (n === null || n === undefined || !Number.isFinite(n)) return "—"; return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`; }
function dateText(ts: number | null) { if (!ts) return "Never"; return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function calcPayout(salePrice: any) { const sp = num(salePrice); return sp - sp * COMMISSION - (sp * PROC_PCT + PROC_FLAT); }
function calcBreakEven(totalCostToRecover: number) { return (totalCostToRecover + PROC_FLAT) / (1 - COMMISSION - PROC_PCT); }
function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function lotProductCost(lot: Lot) { return num(lot.totalCostPaid); }
function lotShipping(lot: Lot) { return num(lot.inboundShipping); }
function lotQty(lot: Lot) { return Math.max(1, lot.units?.length || num(lot.quantity) || 1); }
function productCostPerUnit(lot: Lot) { return lotProductCost(lot) / lotQty(lot); }
function shippingPerUnit(lot: Lot) { return lotShipping(lot) / lotQty(lot); }
function totalCostPerUnit(lot: Lot) { return productCostPerUnit(lot) + shippingPerUnit(lot); }
function lotTotal(lot: Lot) { return lotProductCost(lot) + lotShipping(lot); }

function makeUnits(qty: number, goalSellPrice: string, baseName: string): Unit[] {
  return Array.from({ length: Math.max(1, qty) }, (_, i) => ({
    id: uid(), name: qty > 1 ? `${baseName} #${i + 1}` : baseName, status: "In Stock", goalSellPrice: goalSellPrice || "", actualSalePrice: "", notes: ""
  }));
}

function normalizeLot(raw: any): Lot {
  const units = Array.isArray(raw.units) && raw.units.length ? raw.units : makeUnits(parseInt(raw.quantity || "1") || 1, raw.goalSellPrice || "", raw.name || "Tonie");
  return { id: raw.id ?? uid(), name: raw.name || "Untitled Lot", condition: raw.condition || "New (sealed)", source: raw.source || "Other", totalCostPaid: String(raw.totalCostPaid ?? ""), inboundShipping: String(raw.inboundShipping ?? ""), quantity: String(units.length), goalSellPrice: String(raw.goalSellPrice ?? ""), notes: raw.notes || "", units: units.map((u: any) => ({ id: u.id ?? uid(), name: u.name || raw.name || "Tonie", status: STATUSES.includes(u.status) ? u.status : "In Stock", goalSellPrice: String(u.goalSellPrice ?? raw.goalSellPrice ?? ""), actualSalePrice: String(u.actualSalePrice ?? ""), notes: u.notes || "" })) };
}

function flattenRows(lots: Lot[]) {
  const rows: any[] = [];
  lots.forEach((lot) => {
    const qty = lotQty(lot);
    const productUnit = productCostPerUnit(lot);
    const shipUnit = shippingPerUnit(lot);
    const unitTotal = totalCostPerUnit(lot);
    lot.units.forEach((unit, index) => {
      const payout = unit.actualSalePrice ? calcPayout(unit.actualSalePrice) : null;
      rows.push({
        lotId: lot.id, unitId: unit.id, lotName: lot.name, unitName: unit.name, condition: lot.condition, source: lot.source,
        unitsInLot: qty, lotProductCost: lotProductCost(lot).toFixed(2), lotShipping: lotShipping(lot).toFixed(2), lotTotalCost: lotTotal(lot).toFixed(2),
        productCostPerUnit: productUnit.toFixed(2), shippingPerUnit: shipUnit.toFixed(2), costPerUnit: unitTotal.toFixed(2), breakEven: calcBreakEven(unitTotal).toFixed(2),
        goalSellPrice: unit.goalSellPrice || "", status: unit.status, actualSalePrice: unit.actualSalePrice || "", payoutAfterFees: payout !== null ? payout.toFixed(2) : "", profitVsCost: payout !== null ? (payout - unitTotal).toFixed(2) : "", notes: index === 0 ? (lot.notes || "") : (unit.notes || ""), syncedAt: new Date().toISOString()
      });
    });
  });
  return rows;
}

async function syncToSheets(scriptUrl: string, lots: Lot[]) {
  if (!scriptUrl) throw new Error("No Google Apps Script URL set");
  await fetch(scriptUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "sync", rows: flattenRows(lots) }) });
  return true;
}

function fetchJsonp(url: string, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sep = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => { if (done) return; done = true; try { delete (window as any)[callbackName]; } catch { (window as any)[callbackName] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); clearTimeout(timer); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Google Sheets read timed out")); }, timeoutMs);
    (window as any)[callbackName] = (data: any) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Google Sheets read failed")); };
    script.src = `${url}${sep}action=read&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

function rebuildLotsFromRows(rows: any[]): Lot[] {
  const map: Record<string, Lot> = {};
  rows.filter(Boolean).forEach((row, idx) => {
    const lotName = String(row["Lot Name"] || row.lotName || "Untitled Lot").trim();
    const source = String(row["Source"] || row.source || "Other").trim();
    const condition = String(row["Condition"] || row.condition || "New (sealed)").trim();
    const key = String(row["Lot ID"] || row.lotId || `${lotName}|${source}|${condition}`);
    const qty = num(row["Units In Lot"] || row.unitsInLot) || 1;
    const productTotal = row["Product Cost Total"] !== undefined ? row["Product Cost Total"] : row.lotProductCost;
    const shippingTotal = row["Shipping Total"] !== undefined ? row["Shipping Total"] : row.lotShipping;
    const legacyTotal = row["Lot Total Cost"] !== undefined ? row["Lot Total Cost"] : row.lotTotalCost;
    if (!map[key]) {
      let product = num(productTotal);
      let shipping = num(shippingTotal);
      if (!product && !shipping && legacyTotal !== undefined) product = num(legacyTotal);
      map[key] = { id: key, name: lotName, condition, source, totalCostPaid: product ? String(product) : "", inboundShipping: shipping ? String(shipping) : "", quantity: String(qty), goalSellPrice: "", notes: String(row["Notes"] || row.notes || ""), units: [] };
    } else {
      if (!map[key].totalCostPaid && num(productTotal)) map[key].totalCostPaid = String(num(productTotal));
      if (!map[key].inboundShipping && num(shippingTotal)) map[key].inboundShipping = String(num(shippingTotal));
      if (!map[key].notes && (row["Notes"] || row.notes)) map[key].notes = String(row["Notes"] || row.notes);
    }
    map[key].units.push({ id: String(row["Unit ID"] || row.unitId || `${key}_${idx}`), name: String(row["Unit Name"] || row.unitName || lotName), status: STATUSES.includes(String(row["Status"] || row.status)) ? String(row["Status"] || row.status) : "In Stock", goalSellPrice: row["Goal Price"] !== undefined ? String(row["Goal Price"] || "") : String(row.goalSellPrice || ""), actualSalePrice: row["Sold For"] !== undefined ? String(row["Sold For"] || "") : String(row.actualSalePrice || ""), notes: "" });
  });
  return Object.values(map).map((lot) => ({ ...lot, quantity: String(lot.units.length) }));
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
    'Product Cost Total','Shipping Total','Lot Total Cost',
    'Product Cost / Unit','Shipping / Unit','Total Cost / Unit','Break Even',
    'Goal Price','Status','Sold For','Payout','Profit','Notes','Synced At'
  ];
  sheet.appendRow(headers);

  rows.forEach(function(r) {
    sheet.appendRow([
      r.lotId, r.unitId, r.lotName, r.unitName, r.condition, r.source, Number(r.unitsInLot || 1),
      Number(r.lotProductCost || 0), Number(r.lotShipping || 0), Number(r.lotTotalCost || 0),
      Number(r.productCostPerUnit || 0), Number(r.shippingPerUnit || 0), Number(r.costPerUnit || 0), Number(r.breakEven || 0),
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
  for (var i = 2; i <= lastRow; i++) sheet.getRange(i, 1, 1, lastCol).setBackground(i % 2 === 0 ? '#f8f0ff' : '#ffffff').setFontColor('#222222');
  for (var j = 2; j <= lastRow; j++) {
    var statusCell = sheet.getRange(j, 16);
    var val = statusCell.getValue();
    if (val === 'Sold') statusCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
    if (val === 'Listed') statusCell.setBackground('#fff3cd').setFontColor('#856404').setFontWeight('bold');
    if (val === 'In Stock') statusCell.setBackground('#cce5ff').setFontColor('#004085').setFontWeight('bold');
    var profitCell = sheet.getRange(j, 19);
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
  const [lots, setLots] = useState<Lot[]>(() => {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const old = localStorage.getItem(OLD_STORAGE_KEY);
      const parsed = JSON.parse(current || old || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeLot) : [];
    } catch { return []; }
  });
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const current = localStorage.getItem(SETTINGS_KEY);
      const old = localStorage.getItem(OLD_SETTINGS_KEY);
      const saved = JSON.parse(current || old || "{}");
      return { scriptUrl: DEFAULT_SCRIPT_URL, syncMode: "auto", lastSynced: null, ...saved, scriptUrl: DEFAULT_SCRIPT_URL };
    } catch { return { scriptUrl: DEFAULT_SCRIPT_URL, syncMode: "auto", lastSynced: null }; }
  });
  const [view, setView] = useState("dashboard");
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [editLotId, setEditLotId] = useState<string | number | null>(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const autoTimer = useRef<any>(null);
  const initialCloudLoadDone = useRef(false);
  const skipNextAutoPush = useRef(false);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lots)); } catch {} }, [lots]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { pullFromSheets(true); }, []);
  useEffect(() => {
    if (!initialCloudLoadDone.current) return;
    if (skipNextAutoPush.current) { skipNextAutoPush.current = false; return; }
    if (settings.syncMode === "auto" && settings.scriptUrl && lots.length) {
      clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => doSync(true), 2500);
    }
  }, [lots]);

  const allUnits = useMemo(() => lots.flatMap(lot => lot.units.map(unit => ({ lot, unit, productUnit: productCostPerUnit(lot), shipUnit: shippingPerUnit(lot), unitCost: totalCostPerUnit(lot), breakEven: calcBreakEven(totalCostPerUnit(lot)) }))), [lots]);
  const filteredUnits = filterStatus === "All" ? allUnits : allUnits.filter(x => x.unit.status === filterStatus);
  const stats = useMemo(() => {
    const totalInvested = lots.reduce((s, l) => s + lotTotal(l), 0);
    const sold = allUnits.filter(x => x.unit.status === "Sold");
    const open = allUnits.filter(x => x.unit.status !== "Sold");
    const realizedProfit = sold.reduce((s, x) => s + (x.unit.actualSalePrice ? calcPayout(x.unit.actualSalePrice) - x.unitCost : -x.unitCost), 0);
    const projectedProfit = open.reduce((s, x) => s + (x.unit.goalSellPrice ? calcPayout(x.unit.goalSellPrice) - x.unitCost : 0), 0);
    return { totalInvested, soldUnits: sold.length, inStockUnits: open.length, realizedProfit, projectedProfit, totalUnits: allUnits.length };
  }, [lots, allUnits]);

  async function doSync(silent = false) {
    if (!settings.scriptUrl) { if (!silent) flash("Missing Google Apps Script URL"); setSyncStatus("error"); return; }
    setSyncStatus("syncing");
    try {
      await syncToSheets(settings.scriptUrl, lots);
      setSettings(s => ({ ...s, lastSynced: Date.now(), scriptUrl: DEFAULT_SCRIPT_URL }));
      setSyncStatus("success");
      if (!silent) flash("Pushed to Google Sheets");
    } catch (e: any) { setSyncStatus("error"); if (!silent) flash(e?.message || "Sync failed"); }
    setTimeout(() => setSyncStatus(null), 2500);
  }

  async function pullFromSheets(silent = false) {
    if (!settings.scriptUrl) { if (!silent) flash("Missing Google Apps Script URL"); return; }
    setSyncStatus("syncing");
    try {
      const data = await fetchJsonp(settings.scriptUrl);
      if (!data || data.error) throw new Error(data?.error || "Bad Google response");
      const nextLots = rebuildLotsFromRows(data.rows || []);
      skipNextAutoPush.current = true;
      setLots(nextLots);
      setSettings(s => ({ ...s, lastSynced: Date.now(), scriptUrl: DEFAULT_SCRIPT_URL }));
      setSyncStatus("success");
      if (!silent) flash(`Pulled ${nextLots.reduce((n, l) => n + l.units.length, 0)} units from Sheets`);
    } catch (e: any) { setSyncStatus("error"); if (!silent) flash(e?.message || "Pull failed"); }
    finally { initialCloudLoadDone.current = true; }
    setTimeout(() => setSyncStatus(null), 3000);
  }

  function flash(text: string) { setMessage(text); setTimeout(() => setMessage(""), 3000); }

  function saveLot() {
    if (!form.name || !form.totalCostPaid) return;
    const qty = Math.max(1, parseInt(form.quantity) || 1);
    if (editLotId !== null) {
      setLots(prev => prev.map(l => {
        if (l.id !== editLotId) return l;
        let units = [...l.units];
        if (qty > units.length) for (let i = units.length; i < qty; i++) units.push({ id: uid(), name: `${form.name} #${i + 1}`, status: "In Stock", goalSellPrice: form.goalSellPrice || "", actualSalePrice: "" });
        if (qty < units.length) units = units.slice(0, qty);
        return normalizeLot({ ...l, ...form, units });
      }));
      setEditLotId(null);
    } else setLots(prev => [...prev, normalizeLot({ ...form, id: uid(), units: makeUnits(qty, form.goalSellPrice, form.name) })]);
    setForm(EMPTY_FORM); setView("inventory");
  }

  function updateUnit(lotId: any, unitId: any, changes: Partial<Unit>) {
    setLots(prev => prev.map(l => l.id !== lotId ? l : { ...l, units: l.units.map(u => u.id !== unitId ? u : { ...u, ...changes }) }));
  }
  function deleteUnit(lotId: any, unitId: any) {
    setLots(prev => prev.map(l => l.id !== lotId ? l : { ...l, units: l.units.filter(u => u.id !== unitId), quantity: String(Math.max(0, l.units.length - 1)) }).filter(l => l.units.length));
  }
  function editLot(lot: Lot) { setForm({ name: lot.name, condition: lot.condition, source: lot.source, totalCostPaid: lot.totalCostPaid, inboundShipping: lot.inboundShipping, quantity: String(lot.units.length), goalSellPrice: lot.goalSellPrice || "", notes: lot.notes || "" }); setEditLotId(lot.id); setView("add"); }

  const totalCost = num(form.totalCostPaid) + num(form.inboundShipping);
  const formQty = Math.max(1, parseInt(form.quantity) || 1);
  const formProductUnit = num(form.totalCostPaid) / formQty;
  const formShipUnit = num(form.inboundShipping) / formQty;
  const formUnitCost = formProductUnit + formShipUnit;
  const formBreakEven = totalCost > 0 ? calcBreakEven(formUnitCost) : null;
  const syncText = syncStatus === "syncing" ? "⏳ Syncing" : syncStatus === "success" ? "✓ Synced" : syncStatus === "error" ? "✗ Failed" : settings.lastSynced ? `☁ ${dateText(settings.lastSynced)}` : "☁ Not synced";

  return <div style={styles.page}>
    <style>{css}</style>
    <header style={styles.header}>
      <div style={{ fontSize: 31 }}>🧸</div>
      <h1 style={styles.title}>Dahlia's Tonie Tracker</h1>
      <div style={styles.sub}>with love, Levy Yitschock 💕</div>
      <div style={styles.syncBar}>
        <span style={{ ...styles.syncBadge, color: syncStatus === "error" ? "#f87171" : syncStatus === "success" ? "#22c55e" : "#93c5fd" }}>{syncText}</span>
        {settings.scriptUrl && <><button style={styles.smallBtn} onClick={doSync}>↑ Push</button><button style={styles.smallBtn} onClick={pullFromSheets}>↓ Pull</button></>}
        <button style={styles.gear} onClick={() => setView("settings")}>⚙️</button>
      </div>
      {message && <div style={styles.toast}>{message}</div>}
    </header>

    <main style={styles.container}>
      {view === "dashboard" && <Dashboard stats={stats} lots={lots} setView={setView} editLot={editLot} />}
      {view === "inventory" && <Inventory lots={lots} filteredUnits={filteredUnits} filterStatus={filterStatus} setFilterStatus={setFilterStatus} updateUnit={updateUnit} deleteUnit={deleteUnit} editLot={editLot} />}
      {view === "add" && <AddForm form={form} setForm={setForm} saveLot={saveLot} editLotId={editLotId} setEditLotId={setEditLotId} setView={setView} totalCost={totalCost} formProductUnit={formProductUnit} formShipUnit={formShipUnit} formUnitCost={formUnitCost} formBreakEven={formBreakEven} formQty={formQty} />}
      {view === "settings" && <SettingsView settings={settings} setSettings={setSettings} doSync={doSync} pullFromSheets={pullFromSheets} syncStatus={syncStatus} setLots={setLots} setView={setView} />}
    </main>

    <nav style={styles.nav}>
      {[["dashboard","📊","Dashboard"],["inventory","📦","Inventory"],["add","➕","Add"],["settings","⚙️","Settings"]].map(([v, icon, label]) => <button key={v} onClick={() => { if (v === "add") { setForm(EMPTY_FORM); setEditLotId(null); } setView(v); }} style={{ ...styles.navBtn, color: view === v ? "#c4b5fd" : "#6b7280" }}><span style={{ fontSize: 20 }}>{icon}</span><span>{label}</span></button>)}
    </nav>
  </div>;
}

function Dashboard({ stats, lots, setView, editLot }: any) {
  return <>
    {lots.length === 0 ? <div style={{ ...styles.card, textAlign: "center", padding: 36 }}><div style={{ fontSize: 46 }}>📦</div><p style={{ color: "#9ca3af" }}>No Tonies yet — add your first purchase.</p><button style={styles.primaryBtn} onClick={() => setView("add")}>+ Add Tonie</button></div> : <>
      <div className="statsGrid">
        <StatCard title="Total Invested" value={money(stats.totalInvested)} tone="#fbbf24" />
        <StatCard title="Units" value={`${stats.totalUnits}`} sub={`${stats.inStockUnits} open · ${stats.soldUnits} sold`} tone="#a78bfa" />
        <StatCard title="Profit in Pocket" value={money(stats.realizedProfit)} tone={stats.realizedProfit >= 0 ? "#22c55e" : "#ef4444"} />
        <StatCard title="Potential Profit" value={money(stats.projectedProfit)} tone="#60a5fa" />
      </div>
      <h3 style={styles.sectionTitle}>Lots</h3>
      <div className="lotGrid">{lots.map((lot: Lot) => <div key={String(lot.id)} style={styles.card}><div style={styles.rowBetween}><div><b>{lot.name}</b><div style={styles.muted}>{lot.units.length} units · {lot.condition} · {lot.source}</div></div><button style={styles.tinyBtn} onClick={() => editLot(lot)}>Edit Lot</button></div><div style={styles.miniGrid}><Mini label="Product" value={money(lotProductCost(lot))}/><Mini label="Shipping" value={money(lotShipping(lot))}/><Mini label="Unit Cost" value={money(totalCostPerUnit(lot))}/><Mini label="Break Even" value={money(calcBreakEven(totalCostPerUnit(lot)))}/></div></div>)}</div>
    </>}
  </>;
}

function Inventory({ lots, filteredUnits, filterStatus, setFilterStatus, updateUnit, deleteUnit, editLot }: any) {
  return <>
    <div style={styles.filterBar}>{["All", "In Stock", "Listed", "Sold"].map(s => <button key={s} onClick={() => setFilterStatus(s)} style={{ ...styles.pill, borderColor: filterStatus === s ? (statusColor[s] || "#a78bfa") : "rgba(255,255,255,.12)", color: filterStatus === s ? "#fff" : "#9ca3af", background: filterStatus === s ? `${statusColor[s] || "#7c3aed"}33` : "transparent" }}>{s}</button>)}</div>
    {filteredUnits.length === 0 ? <div style={{ ...styles.card, textAlign: "center", color: "#9ca3af" }}>No units here.</div> : <div className="unitGrid">{filteredUnits.map(({ lot, unit, productUnit, shipUnit, unitCost, breakEven }: any) => {
      const payout = unit.actualSalePrice ? calcPayout(unit.actualSalePrice) : null;
      const profit = payout !== null ? payout - unitCost : null;
      return <div key={`${lot.id}_${unit.id}`} style={styles.unitCard}>
        <div style={styles.rowBetween}><div><b>{unit.name}</b><div style={styles.muted}>Lot: {lot.name}</div></div><span style={{ ...styles.status, color: statusColor[unit.status] }}>{unit.status}</span></div>
        <div style={styles.miniGrid}><Mini label="Product/Unit" value={money(productUnit)} /><Mini label="Ship/Unit" value={money(shipUnit)} /><Mini label="Cost/Unit" value={money(unitCost)} /><Mini label="Break Even" value={money(breakEven)} /></div>
        <div className="unitControls">
          <label>Status<select value={unit.status} onChange={e => updateUnit(lot.id, unit.id, { status: e.target.value })} style={styles.input}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Goal $<input value={unit.goalSellPrice || ""} onChange={e => updateUnit(lot.id, unit.id, { goalSellPrice: e.target.value })} style={styles.input} inputMode="decimal" /></label>
          <label>Sold $<input value={unit.actualSalePrice || ""} onChange={e => updateUnit(lot.id, unit.id, { actualSalePrice: e.target.value, status: e.target.value ? "Sold" : unit.status })} style={styles.input} inputMode="decimal" /></label>
        </div>
        {profit !== null && <div style={{ ...styles.result, color: profit >= 0 ? "#22c55e" : "#ef4444" }}>Payout {money(payout!)} · Profit {money(profit)}</div>}
        <div style={{ display:"flex", gap:8, marginTop:10 }}><button style={styles.tinyBtn} onClick={() => editLot(lot)}>Edit Lot</button><button style={{ ...styles.tinyBtn, borderColor:"#ef4444", color:"#f87171" }} onClick={() => { if (confirm("Delete this unit?")) deleteUnit(lot.id, unit.id); }}>Delete Unit</button></div>
      </div>;
    })}</div>}
  </>;
}

function AddForm({ form, setForm, saveLot, editLotId, setEditLotId, setView, totalCost, formProductUnit, formShipUnit, formUnitCost, formBreakEven, formQty }: any) {
  return <div className="formWrap">
    <h2 style={styles.h2}>{editLotId ? "Edit Purchase Lot" : "Add Purchase Lot"}</h2>
    <Field label="Lot / Purchase Name"><input style={styles.input} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. eBay Tonies Lot" /></Field>
    <div className="twoCols"><Field label="Condition"><select style={styles.input} value={form.condition} onChange={e => setForm((f: any) => ({ ...f, condition: e.target.value }))}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Source"><select style={styles.input} value={form.source} onChange={e => setForm((f: any) => ({ ...f, source: e.target.value }))}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field></div>
    <div className="twoCols"><Field label="Product Cost Total"><input style={styles.input} value={form.totalCostPaid} onChange={e => setForm((f: any) => ({ ...f, totalCostPaid: e.target.value }))} inputMode="decimal" placeholder="150" /></Field><Field label="Shipping Total"><input style={styles.input} value={form.inboundShipping} onChange={e => setForm((f: any) => ({ ...f, inboundShipping: e.target.value }))} inputMode="decimal" placeholder="25" /></Field></div>
    <div className="twoCols"><Field label="How Many Units"><input style={styles.input} value={form.quantity} onChange={e => setForm((f: any) => ({ ...f, quantity: e.target.value }))} inputMode="numeric" /></Field><Field label="Goal Sell Price / Unit"><input style={styles.input} value={form.goalSellPrice} onChange={e => setForm((f: any) => ({ ...f, goalSellPrice: e.target.value }))} inputMode="decimal" /></Field></div>
    <div style={styles.card}><div style={styles.miniGrid}><Mini label="Product / Unit" value={money(formProductUnit)} /><Mini label="Shipping / Unit" value={money(formShipUnit)} /><Mini label="Total / Unit" value={money(formUnitCost)} /><Mini label="Break Even" value={formBreakEven ? money(formBreakEven) : "—"} /></div><div style={{ ...styles.muted, marginTop: 10 }}>Example: $150 product + $25 shipping ÷ {formQty} units = {money(formUnitCost)} per unit.</div></div>
    <Field label="Notes"><textarea style={{ ...styles.input, minHeight: 70 }} value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} /></Field>
    <button style={styles.primaryBtn} onClick={saveLot} disabled={!form.name || !form.totalCostPaid}>{editLotId ? "Save Changes" : "Add to Inventory"}</button>
    {editLotId && <button style={styles.secondaryBtn} onClick={() => { setEditLotId(null); setView("inventory"); }}>Cancel</button>}
  </div>;
}

function SettingsView({ settings, setSettings, doSync, pullFromSheets, syncStatus, setLots, setView }: any) {
  return <div className="formWrap"><button style={styles.linkBtn} onClick={() => setView("dashboard")}>← Back</button><h2 style={styles.h2}>Settings</h2><div style={styles.card}><h3 style={styles.sectionTitle}>Google Sheets Sync</h3><p style={styles.muted}>This app now has your Google Apps Script URL built in. Every device will connect to the same Google Sheet automatically. Keep the script below in your Google Apps Script deployment.</p><textarea readOnly style={{ ...styles.input, minHeight: 260, fontFamily: "monospace", fontSize: 12 }} value={APPS_SCRIPT_CODE} onFocus={(e) => e.currentTarget.select()} />
    <Field label="Google Apps Script Web App URL"><input style={styles.input} value={DEFAULT_SCRIPT_URL} readOnly /></Field>
    <Field label="Sync Mode"><select style={styles.input} value={settings.syncMode} onChange={e => setSettings((s: Settings) => ({ ...s, syncMode: e.target.value }))}><option value="manual">Manual</option><option value="auto">Auto pull on open + auto push after edits</option><option value="export">Export/Import only</option></select></Field>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button style={styles.primaryBtn} onClick={doSync}>{syncStatus === "syncing" ? "Working..." : "Push to Sheets"}</button><button style={styles.secondaryBtn} onClick={pullFromSheets}>Pull from Sheets</button></div><div style={{ ...styles.muted, marginTop: 8 }}>Last synced: {dateText(settings.lastSynced)}</div></div>
    <div style={{ ...styles.card, borderColor: "rgba(239,68,68,.35)" }}><h3 style={{ ...styles.sectionTitle, color: "#f87171" }}>Danger Zone</h3><button style={{ ...styles.secondaryBtn, color: "#f87171", borderColor: "#ef4444" }} onClick={() => { if (confirm("Delete all local inventory data?")) setLots([]); }}>Clear Local Data</button></div></div>;
}

function StatCard({ title, value, sub, tone }: any) { return <div style={styles.card}><div style={styles.muted}>{title}</div><div style={{ fontSize: 24, fontWeight: 900, color: tone }}>{value}</div>{sub && <div style={styles.muted}>{sub}</div>}</div>; }
function Mini({ label, value }: any) { return <div style={styles.mini}><div style={styles.miniLabel}>{label}</div><div style={styles.miniVal}>{value}</div></div>; }
function Field({ label, children }: any) { return <label style={styles.field}><span>{label}</span>{children}</label>; }

const styles: Record<string, any> = {
  page: { minHeight: "100vh", background: "linear-gradient(160deg,#0d0b1e 0%,#1a1035 60%,#0d1a2e 100%)", color: "#f8f7ff", fontFamily: "Inter, system-ui, Segoe UI, sans-serif", paddingBottom: 86 },
  header: { textAlign: "center", padding: "22px 14px 10px", position: "relative" }, title: { margin: 0, fontSize: 25, fontWeight: 900, background: "linear-gradient(90deg,#a78bfa,#f0abfc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }, sub: { fontSize: 12, color: "#c4b5fd", opacity: .7, fontStyle: "italic" },
  syncBar: { display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 10, flexWrap: "wrap" }, syncBadge: { fontSize: 12, padding: "4px 10px", borderRadius: 9, background: "rgba(255,255,255,.06)", fontWeight: 700 }, smallBtn: { border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.06)", color: "#ddd6fe", borderRadius: 9, padding: "5px 10px", cursor: "pointer", fontWeight: 700 }, gear: { background: "none", border: 0, cursor: "pointer", fontSize: 18 }, toast: { position: "absolute", right: 16, top: 12, background: "rgba(34,197,94,.16)", color: "#86efac", padding: "6px 10px", borderRadius: 10, fontSize: 12, fontWeight: 800 },
  container: { width: "min(1180px, calc(100% - 28px))", margin: "0 auto" }, card: { background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 16, padding: 16, marginBottom: 12, boxSizing: "border-box" },
  primaryBtn: { border: 0, borderRadius: 12, padding: "12px 18px", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", fontWeight: 850, cursor: "pointer" }, secondaryBtn: { border: "1.5px solid #7c3aed", borderRadius: 12, padding: "12px 18px", background: "transparent", color: "#c4b5fd", fontWeight: 800, cursor: "pointer" }, linkBtn: { background: "none", border: 0, color: "#c4b5fd", fontWeight: 800, cursor: "pointer", marginBottom: 8 }, tinyBtn: { border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.05)", color: "#ddd6fe", borderRadius: 9, padding: "7px 10px", cursor: "pointer", fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.075)", border: "1.5px solid rgba(255,255,255,.13)", borderRadius: 10, padding: "10px 12px", color: "#f8f7ff", fontSize: 15, outline: "none", fontFamily: "inherit" }, field: { display: "block", marginBottom: 14, color: "#a78bfa", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: .7 },
  h2: { margin: "0 0 16px", fontSize: 20 }, sectionTitle: { margin: "0 0 12px", color: "#c4b5fd", fontSize: 14, textTransform: "uppercase", letterSpacing: .8 }, muted: { color: "#9ca3af", fontSize: 12, lineHeight: 1.5 }, rowBetween: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }, miniGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }, mini: { background: "rgba(255,255,255,.045)", borderRadius: 10, padding: 10 }, miniLabel: { color: "#9ca3af", fontSize: 10, marginBottom: 3 }, miniVal: { fontWeight: 850, fontSize: 14 },
  filterBar: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }, pill: { border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 999, padding: "7px 13px", cursor: "pointer", fontWeight: 800 }, unitCard: { background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 16, padding: 14, boxSizing: "border-box" }, status: { fontSize: 12, fontWeight: 900 }, result: { marginTop: 10, background: "rgba(255,255,255,.05)", borderRadius: 10, padding: 9, fontSize: 13, fontWeight: 800 }, nav: { position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(13,11,30,.96)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", padding: "8px 0 12px", zIndex: 10 }, navBtn: { flex: 1, background: "none", border: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 800 }
};

const css = `
.statsGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.lotGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.unitGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.unitControls{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px}.unitControls label{font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:800;letter-spacing:.5px}.formWrap{max-width:760px;margin:0 auto}.twoCols{display:grid;grid-template-columns:1fr 1fr;gap:12px}option{background:#0d0b1e;color:#fff}@media(max-width:980px){.statsGrid{grid-template-columns:repeat(2,1fr)}.unitGrid{grid-template-columns:repeat(2,1fr)}.lotGrid{grid-template-columns:1fr}}@media(max-width:640px){.unitGrid,.statsGrid,.twoCols{grid-template-columns:1fr}.unitControls{grid-template-columns:1fr}.lotGrid{grid-template-columns:1fr}}
`;
