import { useEffect, useMemo, useRef, useState } from "react";
import WhatnotCalculator from "./Calculator";

const COMMISSION = 0.08;
const PROC_PCT = 0.029;
const PROC_FLAT = 0.30;
const STORAGE_KEY = "dahlia_tonie_tracker_v11_units";
const SETTINGS_KEY = "dahlia_tonie_settings_v11";
const SESSION_PULL_KEY = "dahlia_tonie_session_pulled_v11";
const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbziJgxAQhzdRd2MShDnHkGfHQxIbpp7Hbn6Zn-FDDEatNDNNOq6w8kmXECMNzJlXezB/exec";

const CONDITIONS = ["New", "Like New", "Used Good", "Used Fair"];
const STATUSES = ["In Stock", "Listed", "Sold"];
const SCHEMA_VERSION = "12.0-safe-sync";

type Unit = {
  unitKey: string;
  lotKey: string;
  lotName: string;
  unitName: string;
  category: string;
  condition: string;
  source: string;
  seller: string;
  lotProductTotal: string;
  lotShippingTotal: string;
  goalSellPrice: string;
  status: string;
  actualSalePrice: string;
  notes: string;
  dateAdded: string;
  soldAt: string;
  updatedAt: string;
};

type Settings = {
  syncMode: "auto" | "manual";
  lastSynced: number | null;
  firstPullDone: boolean;
};

type DraftUnit = { unitName: string; category: string; condition: string; goalSellPrice: string; notes: string };

type AddForm = {
  lotMode: boolean;
  lotName: string;
  unitName: string;
  category: string;
  condition: string;
  source: string;
  seller: string;
  productTotal: string;
  shippingTotal: string;
  quantity: string;
  goalSellPrice: string;
  notes: string;
  unitDrafts: DraftUnit[];
};

type FlatCalc = Unit & { lotQty: number; productUnit: number; shippingUnit: number; totalUnit: number; breakEven: number; payout: number | null; profit: number | null };

function uid(prefix = "id") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
function num(v: any) { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; }
function money(n: number | null | undefined) { if (n === null || n === undefined || !Number.isFinite(n)) return "—"; return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`; }
function pct(n: number | null | undefined) { if (n === null || n === undefined || !Number.isFinite(n)) return "—"; return `${n.toFixed(0)}%`; }
function isoNow() { return new Date().toISOString(); }
function dateMs(v: any) { const d = new Date(v || 0); return isNaN(d.getTime()) ? 0 : d.getTime(); }
function displayDate(v: any) { if (!v) return "—"; const d = new Date(v); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }); }
function inputDate(v: any) { if (!v) return ""; const d = new Date(v); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0,10); }
function isoFromDateInput(v: string) { if (!v) return ""; const d = new Date(v + "T12:00:00"); return isNaN(d.getTime()) ? "" : d.toISOString(); }
function dateText(ts: number | null) { if (!ts) return "Never"; return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function payoutFromSale(sale: any) { const sp = num(sale); if (!sp) return null; return sp - sp * COMMISSION - (sp * PROC_PCT + PROC_FLAT); }
function breakEven(cost: number) { return (cost + PROC_FLAT) / (1 - COMMISSION - PROC_PCT); }
function cleanCondition(v: any) { const s = String(v ?? "").trim(); if (!s || s === "New (sealed)") return "New"; if (s === "Good") return "Used Good"; if (s === "Fair") return "Used Fair"; return CONDITIONS.includes(s) ? s : "Used Good"; }
function safeName(v: any, fallback = "Tonie") { const s = String(v ?? "").trim(); return s && !/^\d{4}-\d{2}-\d{2}T/.test(s) ? s : fallback; }
function normalizeStatus(v: any) { const s = String(v ?? "").trim(); return STATUSES.includes(s) ? s : "In Stock"; }

const EMPTY_FORM: AddForm = {
  lotMode: false,
  lotName: "",
  unitName: "",
  category: "",
  condition: "New",
  source: "",
  seller: "",
  productTotal: "",
  shippingTotal: "",
  quantity: "1",
  goalSellPrice: "",
  notes: "",
  unitDrafts: [{ unitName: "", category: "", condition: "New", goalSellPrice: "", notes: "" }]
};

function normalizeUnit(raw: any): Unit {
  const lotName = safeName(raw.lotName ?? raw["Lot Name"] ?? raw.name ?? raw.unitName ?? raw["Unit Name"], "Tonie Lot");
  const unitName = safeName(raw.unitName ?? raw["Unit Name"] ?? raw.name ?? lotName, lotName);
  const lotKey = String(raw.lotKey ?? raw["Internal Lot Key"] ?? raw.lotId ?? raw["Lot ID"] ?? "").trim() || uid("lot");
  const unitKey = String(raw.unitKey ?? raw["Internal Unit Key"] ?? raw.unitId ?? raw["Unit ID"] ?? "").trim() || uid("unit");
  const rawTotal = raw.lotTotalCost ?? raw["Lot Total Cost"];
  let productTotal = raw.lotProductTotal ?? raw["Lot Product Total"] ?? raw.productTotal ?? raw["Product Cost Total"] ?? "";
  let shippingTotal = raw.lotShippingTotal ?? raw["Lot Shipping Total"] ?? raw.shippingTotal ?? raw["Shipping Total"] ?? "";
  if (!num(productTotal) && !num(shippingTotal) && num(rawTotal)) productTotal = String(num(rawTotal));
  return {
    unitKey,
    lotKey,
    lotName,
    unitName,
    category: String(raw.category ?? raw["Category"] ?? ""),
    condition: cleanCondition(raw.condition ?? raw["Condition"] ?? "New"),
    source: String(raw.source ?? raw["Source"] ?? ""),
    seller: String(raw.seller ?? raw["Seller"] ?? ""),
    lotProductTotal: String(productTotal ?? ""),
    lotShippingTotal: String(shippingTotal ?? ""),
    goalSellPrice: String(raw.goalSellPrice ?? raw["Goal Price"] ?? ""),
    status: normalizeStatus(raw.status ?? raw["Status"]),
    actualSalePrice: String(raw.actualSalePrice ?? raw["Sold For"] ?? ""),
    notes: String(raw.notes ?? raw["Notes"] ?? ""),
    dateAdded: String(raw.dateAdded ?? raw["Date Purchased"] ?? raw["Date Added"] ?? isoNow()),
    soldAt: String(raw.soldAt ?? raw["Date Sold"] ?? raw["Sold At"] ?? ""),
    updatedAt: String(raw.updatedAt ?? raw["Updated At"] ?? isoNow())
  };
}

function loadInitialUnits(): Unit[] {
  try {
    const direct = localStorage.getItem(STORAGE_KEY);
    if (direct) return JSON.parse(direct).map(normalizeUnit);
    const oldKeys = ["dahlia_tonie_tracker_v10_units", "dahlia_tonie_tracker_v7", "dahlia_tonie_tracker_v6", "dahlia_tonie_tracker_v5", "dahlia_tonie_tracker_v4"];
    for (const k of oldKeys) {
      const old = localStorage.getItem(k);
      if (!old) continue;
      const parsed = JSON.parse(old);
      if (Array.isArray(parsed) && parsed[0] && !parsed[0]?.units) return parsed.map(normalizeUnit);
      if (Array.isArray(parsed) && parsed[0]?.units) {
        const flat: Unit[] = [];
        parsed.forEach((lot: any) => (lot.units || []).forEach((u: any) => flat.push(normalizeUnit({ ...lot, lotKey: lot.id, lotName: lot.name, ...u, unitKey: u.id, unitName: u.name, lotProductTotal: lot.productTotal, lotShippingTotal: lot.shippingTotal, condition: u.condition || lot.condition }))));
        return flat;
      }
    }
    return [];
  } catch { return []; }
}

function enrichUnits(units: Unit[]): FlatCalc[] {
  const byLot: Record<string, Unit[]> = {};
  units.forEach(u => { (byLot[u.lotKey] ||= []).push(u); });
  return units.map(u => {
    const lotUnits = byLot[u.lotKey] || [u];
    const lotQty = Math.max(1, lotUnits.length);
    const productUnit = num(u.lotProductTotal) / lotQty;
    const shippingUnit = num(u.lotShippingTotal) / lotQty;
    const totalUnit = productUnit + shippingUnit;
    const payout = payoutFromSale(u.actualSalePrice);
    return { ...u, lotQty, productUnit, shippingUnit, totalUnit, breakEven: breakEven(totalUnit), payout, profit: payout !== null ? payout - totalUnit : null };
  });
}

function toSheetRows(units: Unit[]) {
  return enrichUnits(units).map(u => ({
    schemaVersion: SCHEMA_VERSION,
    unitKey: u.unitKey,
    lotKey: u.lotKey,
    lotName: u.lotName,
    unitName: u.unitName,
    category: u.category,
    condition: u.condition,
    source: u.source,
    seller: u.seller,
    unitsInLot: u.lotQty,
    lotProductTotalRaw: num(u.lotProductTotal).toFixed(2),
    lotShippingTotalRaw: num(u.lotShippingTotal).toFixed(2),
    productCostPerUnit: u.productUnit.toFixed(2),
    shippingPerUnit: u.shippingUnit.toFixed(2),
    totalCostPerUnit: u.totalUnit.toFixed(2),
    breakEven: u.breakEven.toFixed(2),
    goalSellPrice: u.goalSellPrice || "",
    status: u.status,
    actualSalePrice: u.actualSalePrice || "",
    payoutAfterFees: u.payout !== null ? u.payout.toFixed(2) : "",
    profitVsCost: u.profit !== null ? u.profit.toFixed(2) : "",
    notes: u.notes || "",
    dateAdded: u.dateAdded || isoNow(),
    soldAt: u.soldAt || "",
    updatedAt: u.updatedAt || isoNow(),
    syncedAt: isoNow()
  }));
}

async function pushToSheets(units: Unit[]) {
  await fetch(DEFAULT_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "syncInventory", schemaVersion: SCHEMA_VERSION, rows: toSheetRows(units) })
  });
}

function fetchJsonp(url: string, action = "readInventory", timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sep = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { delete (window as any)[callbackName]; } catch { (window as any)[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Google Sheets read timed out")); }, timeoutMs);
    (window as any)[callbackName] = (data: any) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Google Sheets read failed")); };
    script.src = `${url}${sep}action=${action}&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

function rowsToUnits(rows: any[]): Unit[] {
  const seen: Record<string, boolean> = {};
  const units = (rows || []).map((r, idx) => normalizeUnit({
    unitKey: r["Internal Unit Key"] || r.unitKey || r["Unit Key"],
    lotKey: r["Internal Lot Key"] || r.lotKey || r["Lot Key"],
    lotName: r["Lot Name"] || r.lotName,
    unitName: r["Unit Name"] || r.unitName,
    category: r["Category"] || r.category,
    condition: r["Condition"] || r.condition,
    source: r["Source"] || r.source,
    seller: r["Seller"] || r.seller,
    lotProductTotal: r["Lot Product Total Raw"] || r.lotProductTotalRaw || r["Lot Product Total"] || r.lotProductTotal,
    lotShippingTotal: r["Lot Shipping Total Raw"] || r.lotShippingTotalRaw || r["Lot Shipping Total"] || r.lotShippingTotal,
    goalSellPrice: r["Goal Price"] || r.goalSellPrice,
    status: r["Status"] || r.status,
    actualSalePrice: r["Sold For"] || r.actualSalePrice,
    notes: r["Notes"] || r.notes,
    dateAdded: r["Date Purchased"] || r["Date Added"] || r.dateAdded,
    soldAt: r["Date Sold"] || r["Sold At"] || r.soldAt,
    updatedAt: r["Updated At"] || r.updatedAt,
    _idx: idx
  }));
  return units.filter(u => {
    if (seen[u.unitKey]) return false;
    seen[u.unitKey] = true;
    return true;
  });
}

const APPS_SCRIPT_CODE = `var SCHEMA_VERSION = '12.0-safe-sync';

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.action === 'syncInventory' || data.action === 'sync') {
      writeInventory_(ss, data.rows || []);
      return output_({ status: 'ok', rowsWritten: (data.rows || []).length, schemaVersion: SCHEMA_VERSION });
    }
    return output_({ status: 'ok', message: 'No action' });
  } catch (err) {
    return output_({ status: 'error', message: String(err) });
  }
}

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action || 'readInventory';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (action === 'readInventory' || action === 'read') {
      return output_({ rows: readSheetRows_(ss, 'Inventory'), schemaVersion: SCHEMA_VERSION }, e);
    }
    if (action === 'backupNow') {
      var name = backupInventoryNow();
      return output_({ status: 'ok', backup: name }, e);
    }
    return output_({ rows: readSheetRows_(ss, 'Inventory'), schemaVersion: SCHEMA_VERSION }, e);
  } catch (err) {
    return output_({ rows: [], error: String(err) }, e);
  }
}

function readSheetRows_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  return values.slice(1).filter(function(r) { return r.join('').trim() !== ''; }).map(function(r) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = r[i]; });
    return obj;
  });
}

function writeInventory_(ss, rows) {
  var sheet = ss.getSheetByName('Inventory') || ss.insertSheet('Inventory');
  sheet.clearContents();
  sheet.clearFormats();
  sheet.showColumns(1, 26);

  var headers = [
    'Internal Unit Key','Internal Lot Key','Schema Version',
    'Lot Name','Unit Name','Category','Condition','Source','Seller','Qty in Lot',
    'Lot Product Total Raw','Lot Shipping Total Raw',
    'Product Cost / Unit','Shipping / Unit','Total Cost / Unit','Break Even',
    'Goal Price','Status','Sold For','Payout','Profit','Notes','Date Purchased','Date Sold','Updated At','Synced At'
  ];
  sheet.appendRow(headers);

  rows.forEach(function(r) {
    sheet.appendRow([
      r.unitKey || '', r.lotKey || '', r.schemaVersion || SCHEMA_VERSION,
      r.lotName || '', r.unitName || '', r.category || '', r.condition || '', r.source || '', r.seller || '', Number(r.unitsInLot || 1),
      Number(r.lotProductTotalRaw || 0), Number(r.lotShippingTotalRaw || 0),
      Number(r.productCostPerUnit || 0), Number(r.shippingPerUnit || 0), Number(r.totalCostPerUnit || 0), Number(r.breakEven || 0),
      r.goalSellPrice ? Number(r.goalSellPrice) : '', r.status || 'In Stock',
      r.actualSalePrice ? Number(r.actualSalePrice) : '', r.payoutAfterFees ? Number(r.payoutAfterFees) : '', r.profitVsCost ? Number(r.profitVsCost) : '',
      r.notes || '', r.dateAdded || '', r.soldAt || '', r.updatedAt || '', r.syncedAt || new Date().toISOString()
    ]);
  });

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = headers.length;
  sheet.getRange(1, 1, lastRow, lastCol).setFontFamily('Arial').setFontSize(10).setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(1, 1, 1, lastCol).setBackground('#4a235a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sheet.hideColumns(1, 3);
  sheet.hideColumns(11, 2);

  for (var i = 2; i <= lastRow; i++) {
    sheet.getRange(i, 1, 1, lastCol).setBackground(i % 2 === 0 ? '#f8f0ff' : '#ffffff').setFontColor('#222222');
    var statusCell = sheet.getRange(i, 18);
    var val = statusCell.getValue();
    if (val === 'Sold') statusCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
    if (val === 'Listed') statusCell.setBackground('#fff3cd').setFontColor('#856404').setFontWeight('bold');
    if (val === 'In Stock') statusCell.setBackground('#cce5ff').setFontColor('#004085').setFontWeight('bold');
    var profitCell = sheet.getRange(i, 21);
    var p = profitCell.getValue();
    if (p !== '') profitCell.setFontColor(Number(p) >= 0 ? '#155724' : '#721c24').setFontWeight('bold');
  }
  [11,12,13,14,15,16,17,19,20,21].forEach(function(col) {
    if (lastRow > 1) sheet.getRange(2, col, lastRow - 1, 1).setNumberFormat('"$"#,##0.00');
  });
  for (var c = 1; c <= lastCol; c++) sheet.autoResizeColumn(c);
  sheet.setFrozenRows(1);
}

function backupInventoryNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheetByName('Inventory');
  if (!source) throw new Error('Inventory sheet not found');
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  var copy = source.copyTo(ss).setName('Backup ' + ts);
  ss.setActiveSheet(copy);
  ss.moveActiveSheet(ss.getNumSheets());
  return copy.getName();
}

function createTwiceDailyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'backupInventoryNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupInventoryNow').timeBased().everyHours(12).create();
}

function output_(obj, e) {
  var text = JSON.stringify(obj);
  if (e && e.parameter && e.parameter.callback) {
    return ContentService.createTextOutput(e.parameter.callback + '(' + text + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}`;

export default function App() {
  const [units, setUnits] = useState<Unit[]>(loadInitialUnits);
  const [settings, setSettings] = useState<Settings>(() => {
    try { return { syncMode: "auto", lastSynced: null, firstPullDone: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch { return { syncMode: "auto", lastSynced: null, firstPullDone: false }; }
  });
  const [view, setView] = useState("dashboard");
  const [editUnitKey, setEditUnitKey] = useState<string | null>(null);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterCondition, setFilterCondition] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [filterSeller, setFilterSeller] = useState("All");
  const [sortBy, setSortBy] = useState("date-desc");
  const [dashRange, setDashRange] = useState("all");
  const [search, setSearch] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastPullInfo, setLastPullInfo] = useState("");
  const [hasPulledThisSession, setHasPulledThisSession] = useState(() => sessionStorage.getItem(SESSION_PULL_KEY) === "1");
  const [dirty, setDirty] = useState(false);
  const autoTimer = useRef<any>(null);
  const cloudLoaded = useRef(false);
  const skipNextAutoPush = useRef(false);
  const unitsRef = useRef<Unit[]>(units);
  const dirtyRef = useRef(false);
  const hasPulledRef = useRef(hasPulledThisSession);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(units)); } catch {}; unitsRef.current = units; }, [units]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { hasPulledRef.current = hasPulledThisSession; }, [hasPulledThisSession]);

  useEffect(() => {
    const alreadyPulled = sessionStorage.getItem(SESSION_PULL_KEY) === "1";
    if (settings.syncMode === "auto" && !alreadyPulled) {
      safePullFromSheets(true);
    } else {
      setHasPulledThisSession(alreadyPulled);
      cloudLoaded.current = true;
    }
  }, []);

  useEffect(() => {
    if (!cloudLoaded.current) return;
    if (skipNextAutoPush.current) { skipNextAutoPush.current = false; return; }
    if (!hasPulledThisSession) return;
    if (!dirty) return;
    if (settings.syncMode === "auto") {
      clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => doPush(true), 12000);
    }
  }, [units, dirty, hasPulledThisSession, settings.syncMode]);

  useEffect(() => {
    const emergencyPush = () => {
      if (!dirtyRef.current || !hasPulledRef.current) return;
      try {
        const payload = JSON.stringify({ action: "syncInventory", schemaVersion: SCHEMA_VERSION, rows: toSheetRows(unitsRef.current) });
        fetch(DEFAULT_SCRIPT_URL, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" }, body: payload });
      } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") emergencyPush(); };
    window.addEventListener("pagehide", emergencyPush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", emergencyPush); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  const enriched = useMemo(() => enrichUnits(units), [units]);
  const categories = useMemo(() => Array.from(new Set(units.map(x => x.category).filter(Boolean))).sort(), [units]);
  const sources = useMemo(() => Array.from(new Set(units.map(x => x.source).filter(Boolean))).sort(), [units]);
  const sellers = useMemo(() => Array.from(new Set(units.map(x => x.seller).filter(Boolean))).sort(), [units]);
  const conditions = useMemo(() => Array.from(new Set(units.map(x => x.condition).filter(Boolean))).sort(), [units]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = enriched.filter(x => {
      return (filterStatus === "All" || x.status === filterStatus) &&
        (filterCategory === "All" || x.category === filterCategory) &&
        (filterCondition === "All" || x.condition === filterCondition) &&
        (filterSource === "All" || x.source === filterSource) &&
        (filterSeller === "All" || x.seller === filterSeller) &&
        (!q || `${x.unitName} ${x.lotName} ${x.category} ${x.source} ${x.seller} ${x.condition} ${x.status}`.toLowerCase().includes(q));
    });
    return [...list].sort((a,b) => {
      if (sortBy === "name") return a.unitName.localeCompare(b.unitName);
      if (sortBy === "category") return (a.category || "").localeCompare(b.category || "") || a.unitName.localeCompare(b.unitName);
      if (sortBy === "seller") return (a.seller || "").localeCompare(b.seller || "") || a.unitName.localeCompare(b.unitName);
      if (sortBy === "date-asc") return dateMs(a.dateAdded) - dateMs(b.dateAdded);
      return dateMs(b.dateAdded) - dateMs(a.dateAdded);
    });
  }, [enriched, filterStatus, filterCategory, filterCondition, filterSource, filterSeller, sortBy, search]);

  const stats = useMemo(() => {
    const now = Date.now();
    const since = dashRange === "week" ? now - 7 * 86400000 : dashRange === "month" ? now - 30 * 86400000 : dashRange === "year" ? now - 365 * 86400000 : 0;
    const sold = enriched.filter(x => x.status === "Sold");
    const soldInRange = sold.filter(x => !since || dateMs(x.soldAt || x.updatedAt || x.dateAdded) >= since);
    const actualSales = soldInRange.reduce((s, x) => s + num(x.actualSalePrice), 0);
    const actualPayout = soldInRange.reduce((s, x) => s + (x.payout || 0), 0);
    const actualProfit = soldInRange.reduce((s, x) => s + (x.profit || 0), 0);
    const open = enriched.filter(x => x.status !== "Sold");
    const projectedSales = open.reduce((s, x) => s + num(x.goalSellPrice), 0);
    const projectedProfit = open.reduce((s, x) => { const p = payoutFromSale(x.goalSellPrice); return s + (p === null ? 0 : p - x.totalUnit); }, 0);
    const invested = enriched.reduce((s, x) => s + x.totalUnit, 0);
    return {
      totalUnits: enriched.length,
      inStock: enriched.filter(x => x.status === "In Stock").length,
      listed: enriched.filter(x => x.status === "Listed").length,
      sold: sold.length,
      lotCount: new Set(enriched.map(x => x.lotKey)).size,
      invested,
      actualSales,
      actualPayout,
      actualProfit,
      projectedSales,
      projectedProfit,
      avgCost: enriched.length ? invested / enriched.length : 0,
      avgGoal: enriched.length ? enriched.reduce((s, x) => s + num(x.goalSellPrice), 0) / enriched.length : 0,
      rangeSold: soldInRange.length
    };
  }, [enriched, dashRange]);

  function flash(text: string) { setMessage(text); setTimeout(() => setMessage(""), 3500); }
  function localBackup(label: string) { try { localStorage.setItem(`dahlia_backup_${label}_${Date.now()}`, JSON.stringify(units)); } catch {} }
  function markDirty() { setDirty(true); }

  async function doPush(silent = false, force = false) {
    if (!force && !hasPulledThisSession) {
      setSyncStatus("error");
      if (!silent) flash("Push blocked: first pull from Google Sheets this session.");
      setTimeout(() => setSyncStatus("idle"), 2600);
      return;
    }
    setSyncStatus("syncing");
    try {
      await pushToSheets(units);
      setDirty(false);
      setSettings(s => ({ ...s, lastSynced: Date.now(), firstPullDone: true }));
      setSyncStatus("success");
      if (!silent) flash("Pushed safely to Google Sheets");
    } catch (e: any) { setSyncStatus("error"); if (!silent) flash(e?.message || "Push failed"); }
    setTimeout(() => setSyncStatus("idle"), 2600);
  }

  async function safePullFromSheets(silent = false, force = false) {
    if (!force && !silent) {
      const ok = confirm("Pull will replace this browser's current app data with Google Sheets. A local backup will be saved first. Continue?");
      if (!ok) return;
    }
    setSyncStatus("syncing");
    try {
      const data = await fetchJsonp(DEFAULT_SCRIPT_URL, "readInventory");
      if (!data || data.error) throw new Error(data?.error || "Bad Google response");
      const next = rowsToUnits(data.rows || []);
      if (!next.length && units.length && !force) throw new Error("Sheet returned no inventory rows. Pull canceled to protect your local data.");
      localBackup("before_pull");
      skipNextAutoPush.current = true;
      setUnits(next);
      setDirty(false);
      sessionStorage.setItem(SESSION_PULL_KEY, "1");
      setHasPulledThisSession(true);
      cloudLoaded.current = true;
      setSettings(s => ({ ...s, lastSynced: Date.now(), firstPullDone: true }));
      setLastPullInfo(`Pulled ${next.length} units from Sheets`);
      setSyncStatus("success");
      if (!silent) flash(`Pulled ${next.length} units from Sheets`);
    } catch (e: any) { setSyncStatus("error"); cloudLoaded.current = true; if (!silent) flash(e?.message || "Pull failed"); }
    setTimeout(() => setSyncStatus("idle"), 3000);
  }

  function updateUnit(unitKey: string, changes: Partial<Unit>) {
    markDirty();
    setUnits(prev => prev.map(u => {
      if (u.unitKey !== unitKey) return u;
      const next = { ...u, ...changes, updatedAt: isoNow() };
      if ((changes.status === "Sold" || (changes.actualSalePrice !== undefined && changes.actualSalePrice !== "")) && !next.soldAt) next.soldAt = isoNow();
      if (changes.status && changes.status !== "Sold" && !next.actualSalePrice) next.soldAt = "";
      return next;
    }));
  }

  function updateLotShared(lotKey: string, changes: Partial<Unit>) {
    markDirty();
    setUnits(prev => prev.map(u => u.lotKey === lotKey ? { ...u, ...changes, updatedAt: isoNow() } : u));
  }

  function deleteUnit(unitKey: string) {
    if (!confirm("Delete this unit?")) return;
    markDirty();
    setUnits(prev => prev.filter(u => u.unitKey !== unitKey));
  }

  function setQuantityDraft(rawQty: any) {
    setForm(f => {
      const raw = String(rawQty ?? "");
      if (raw === "") return { ...f, quantity: "" };
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) return { ...f, quantity: raw };
      const qty = parsed;
      let drafts = [...f.unitDrafts];
      while (drafts.length < qty) drafts.push({ unitName: `${f.lotName || "Tonie"} #${drafts.length + 1}`, category: f.category, condition: f.condition, goalSellPrice: f.goalSellPrice, notes: "" });
      if (drafts.length > qty) drafts = drafts.slice(0, qty);
      return { ...f, quantity: raw, unitDrafts: drafts };
    });
  }

  function saveNew() {
    const lotMode = form.lotMode;
    const qty = lotMode ? Math.max(1, parseInt(form.quantity) || 1) : 1;
    const lotKey = uid("lot");
    const lotName = safeName(form.lotName || form.unitName, "Tonie Lot");
    const now = isoNow();
    const next: Unit[] = Array.from({ length: qty }, (_, i) => {
      const d = lotMode ? form.unitDrafts[i] || form.unitDrafts[0] : { unitName: form.unitName || form.lotName, category: form.category, condition: form.condition, goalSellPrice: form.goalSellPrice, notes: form.notes };
      return {
        unitKey: uid("unit"), lotKey, lotName,
        unitName: safeName(d.unitName || (qty > 1 ? `${lotName} #${i + 1}` : lotName), lotName),
        category: d.category || form.category || "",
        condition: cleanCondition(d.condition || form.condition),
        source: form.source || "", seller: form.seller || "",
        lotProductTotal: String(num(form.productTotal) || ""), lotShippingTotal: String(num(form.shippingTotal) || ""),
        goalSellPrice: d.goalSellPrice || form.goalSellPrice || "",
        status: "In Stock", actualSalePrice: "", notes: d.notes || form.notes || "",
        dateAdded: now, soldAt: "", updatedAt: now
      };
    });
    markDirty();
    setUnits(prev => [...next, ...prev]);
    setForm(EMPTY_FORM);
    setView("inventory");
  }

  const syncText = syncStatus === "syncing" ? "⏳ Syncing" : syncStatus === "success" ? "✓ Synced" : syncStatus === "error" ? "✗ Sync failed" : !hasPulledThisSession ? "Pull required before push" : dirty ? "🟡 Unsaved changes" : settings.lastSynced ? `☁ ${dateText(settings.lastSynced)}` : "☁ Ready";
  const formQty = form.lotMode ? Math.max(1, parseInt(form.quantity) || 1) : 1;
  const formProductUnit = num(form.productTotal) / formQty;
  const formShipUnit = num(form.shippingTotal) / formQty;
  const formUnitCost = formProductUnit + formShipUnit;
  const formBreakEven = formUnitCost ? breakEven(formUnitCost) : null;
  const projectedPayout = payoutFromSale(form.goalSellPrice);
  const expectedProfit = projectedPayout !== null ? projectedPayout - formUnitCost : null;
  const expectedRoi = expectedProfit !== null && formUnitCost ? (expectedProfit / formUnitCost) * 100 : null;

  return <div className="page">
    <style>{css}</style>
    <header className="header">
      <div className="bear">🧸</div>
      <h1>Dahlia's Tonie Tracker</h1>
      <div className="sub">safe edit edition • Sheets as database</div>
      <div className="syncBar"><span className={`syncBadge ${syncStatus}`}>{syncText}</span></div>
      {message && <div className="toast">{message}</div>}
    </header>
    <main className="container">
      {view === "dashboard" && <Dashboard stats={stats} units={enriched} dashRange={dashRange} setDashRange={setDashRange} setFilterStatus={setFilterStatus} setView={setView} />}
      {view === "inventory" && <Inventory units={filtered} setView={setView} setEditUnitKey={setEditUnitKey} updateUnit={updateUnit} updateLotShared={updateLotShared} deleteUnit={deleteUnit} search={search} setSearch={setSearch} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterCategory={filterCategory} setFilterCategory={setFilterCategory} filterCondition={filterCondition} setFilterCondition={setFilterCondition} filterSource={filterSource} setFilterSource={setFilterSource} filterSeller={filterSeller} setFilterSeller={setFilterSeller} categories={categories} conditions={conditions} sources={sources} sellers={sellers} sortBy={sortBy} setSortBy={setSortBy} />}
      {view === "edit" && <EditUnitView unit={enriched.find(u => u.unitKey === editUnitKey)} updateUnit={updateUnit} updateLotShared={updateLotShared} deleteUnit={deleteUnit} setView={setView} />}
      {view === "add" && <AddFormView form={form} setForm={setForm} setQuantityDraft={setQuantityDraft} saveNew={saveNew} formQty={formQty} formProductUnit={formProductUnit} formShipUnit={formShipUnit} formUnitCost={formUnitCost} formBreakEven={formBreakEven} expectedProfit={expectedProfit} expectedRoi={expectedRoi} />}
      {view === "calculator" && <WhatnotCalculator />}
      {view === "settings" && <SettingsView settings={settings} setSettings={setSettings} doPush={doPush} safePullFromSheets={safePullFromSheets} lastPullInfo={lastPullInfo} setUnits={setUnits} hasPulledThisSession={hasPulledThisSession} dirty={dirty} />}
    </main>
    <nav className="nav">
      <button onClick={() => setView("dashboard")} className={view === "dashboard" ? "navBtn active" : "navBtn"}>📊<span>Dashboard</span></button>
      <button onClick={() => setView("inventory")} className={view === "inventory" ? "navBtn active" : "navBtn"}>📦<span>Inventory</span></button>
      <button onClick={() => setView("add")} className={view === "add" ? "navBtn active" : "navBtn"}>➕<span>Add</span></button>
      <button onClick={() => setView("calculator")} className={view === "calculator" ? "navBtn active" : "navBtn"}>🧮<span>Calc</span></button>
      <button onClick={() => setView("settings")} className={view === "settings" ? "navBtn active" : "navBtn"}>⚙️<span>Settings</span></button>
    </nav>
  </div>;
}

function Dashboard({ stats, units, dashRange, setDashRange, setFilterStatus, setView }: any) {
  const topProfit = [...units].filter((u: FlatCalc) => u.profit !== null).sort((a: FlatCalc,b: FlatCalc) => (b.profit || 0) - (a.profit || 0)).slice(0,5);
  const groupedLots = Object.values(units.reduce((acc: any, u: FlatCalc) => { (acc[u.lotKey] ||= { lotName: u.lotName, count: 0, value: 0 }).count++; acc[u.lotKey].value += u.totalUnit; return acc; }, {})).slice(0,6) as any[];
  const rangeLabel = dashRange === "all" ? "All time" : dashRange === "week" ? "Last 7 days" : dashRange === "month" ? "Last 30 days" : "Last year";
  function clickStatus(s: string) { setFilterStatus(s); setView("inventory"); }
  return <>
    <div className="rangeBar"><span>Dashboard range:</span>{["all","week","month","year"].map(r => <button key={r} onClick={() => setDashRange(r)} className={dashRange === r ? "pill active" : "pill"}>{r === "all" ? "All" : r}</button>)}</div>
    <div className="statsGrid">
      <button className="statCard clickable" onClick={() => clickStatus("In Stock")}><span>In stock</span><b>{stats.inStock}</b><em>Click to filter</em></button>
      <button className="statCard clickable" onClick={() => clickStatus("Listed")}><span>Listed</span><b className="gold">{stats.listed}</b><em>Ready to sell</em></button>
      <button className="statCard clickable" onClick={() => clickStatus("Sold")}><span>Sold</span><b className="green">{stats.sold}</b><em>{rangeLabel}: {stats.rangeSold}</em></button>
      <div className="statCard"><span>Total invested</span><b>{money(stats.invested)}</b><em>{stats.totalUnits} units • {stats.lotCount} lots</em></div>
    </div>
    <div className="statsGrid wide">
      <div className="statCard"><span>Past sales collected</span><b>{money(stats.actualSales)}</b><em>Payout after fees: {money(stats.actualPayout)}</em></div>
      <div className="statCard"><span>Actual profit</span><b className={stats.actualProfit >= 0 ? "green" : "red"}>{money(stats.actualProfit)}</b><em>{rangeLabel}</em></div>
      <div className="statCard"><span>Future projected sales</span><b>{money(stats.projectedSales)}</b><em>Projected profit: {money(stats.projectedProfit)}</em></div>
    </div>
    <div className="dashGrid">
      <div className="panel"><h3>🏆 Best sold profit</h3>{topProfit.length ? topProfit.map((u: FlatCalc) => <div className="miniLine" key={u.unitKey}><span>{u.unitName}<small>{u.lotName}</small></span><b className={u.profit! >= 0 ? "green" : "red"}>{money(u.profit)}</b></div>) : <p className="muted">No sold items yet.</p>}</div>
      <div className="panel"><h3>📦 Lot summary</h3>{groupedLots.map((l:any) => <div className="miniLine" key={l.lotName}><span>{l.lotName}<small>{l.count} units</small></span><b>{money(l.value)}</b></div>)}</div>
      <div className="panel"><h3>📌 Averages</h3><Mini label="Average cost" value={money(stats.avgCost)} /><Mini label="Average goal" value={money(stats.avgGoal)} /></div>
    </div>
  </>;
}

function Inventory(props: any) {
  const { units, setView, setEditUnitKey, updateUnit, updateLotShared, deleteUnit, search, setSearch, filterStatus, setFilterStatus, filterCategory, setFilterCategory, filterCondition, setFilterCondition, filterSource, setFilterSource, filterSeller, setFilterSeller, categories, conditions, sources, sellers, sortBy, setSortBy } = props;
  return <>
    <div className="toolbar advanced">
      <input className="search" placeholder="Search unit, lot, seller, source..." value={search} onChange={e => setSearch(e.target.value)} />
      <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option>All</option>{STATUSES.map(x => <option key={x}>{x}</option>)}</select>
      <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}><option>All</option>{categories.map((x:string) => <option key={x}>{x}</option>)}</select>
      <select value={filterCondition} onChange={e => setFilterCondition(e.target.value)}><option>All</option>{conditions.map((x:string) => <option key={x}>{x}</option>)}</select>
      <select value={filterSource} onChange={e => setFilterSource(e.target.value)}><option>All</option>{sources.map((x:string) => <option key={x}>{x}</option>)}</select>
      <select value={filterSeller} onChange={e => setFilterSeller(e.target.value)}><option>All</option>{sellers.map((x:string) => <option key={x}>{x}</option>)}</select>
      <select value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="name">Name</option><option value="category">Category</option><option value="seller">Seller</option></select>
    </div>
    <div className="countLine">Showing <b>{units.length}</b> items</div>
    <div className="sheetWrap"><table className="inventoryTable"><thead><tr>
      <th>#</th><th>Edit</th><th>Lot Name</th><th>Unit Name</th><th>Category</th><th>Condition</th><th>Source</th><th>Seller</th><th>Qty in Lot</th><th>Product/Unit</th><th>Ship/Unit</th><th>Cost/Unit</th><th>Break Even</th><th>Goal</th><th>Projected Profit</th><th>Status</th><th>Sold For</th><th>Payout</th><th>Actual Profit</th><th>Notes</th><th>Date Purchased</th><th>Date Sold</th>
    </tr></thead><tbody>{units.map((u: FlatCalc, idx: number) => { const projectedPayout = payoutFromSale(u.goalSellPrice); const projectedProfit = projectedPayout === null ? null : projectedPayout - u.totalUnit; return <tr key={u.unitKey}>
      <td className="rowNum">{idx + 1}</td>
      <td><button className="editSmall" onClick={() => { setEditUnitKey(u.unitKey); setView("edit"); }}>Edit</button></td>
      <td><input value={u.lotName} onChange={e => updateLotShared(u.lotKey, { lotName: e.target.value })} /></td>
      <td><input value={u.unitName} onChange={e => updateUnit(u.unitKey, { unitName: e.target.value })} /></td>
      <td><input value={u.category} onChange={e => updateUnit(u.unitKey, { category: e.target.value })} /></td>
      <td><select value={u.condition} onChange={e => updateUnit(u.unitKey, { condition: e.target.value })}>{CONDITIONS.map(x => <option key={x}>{x}</option>)}</select></td>
      <td><input value={u.source} onChange={e => updateLotShared(u.lotKey, { source: e.target.value })} /></td>
      <td><input value={u.seller} onChange={e => updateLotShared(u.lotKey, { seller: e.target.value })} /></td>
      <td>{u.lotQty}</td><td>{money(u.productUnit)}</td><td>{money(u.shippingUnit)}</td><td>{money(u.totalUnit)}</td><td>{money(u.breakEven)}</td>
      <td><input value={u.goalSellPrice} inputMode="decimal" onChange={e => updateUnit(u.unitKey, { goalSellPrice: e.target.value })} /></td>
      <td className={projectedProfit === null ? "" : projectedProfit >= 0 ? "green" : "red"}>{money(projectedProfit)}</td>
      <td><select value={u.status} onChange={e => updateUnit(u.unitKey, { status: e.target.value })}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></td>
      <td><input value={u.actualSalePrice} inputMode="decimal" onChange={e => updateUnit(u.unitKey, { actualSalePrice: e.target.value })} /></td>
      <td>{money(u.payout)}</td><td className={u.profit === null ? "" : u.profit >= 0 ? "green" : "red"}>{money(u.profit)}</td>
      <td><input value={u.notes} onChange={e => updateUnit(u.unitKey, { notes: e.target.value })} /></td>
      <td><input type="date" value={inputDate(u.dateAdded)} onChange={e => updateUnit(u.unitKey, { dateAdded: isoFromDateInput(e.target.value) })} /></td>
      <td><input type="date" value={inputDate(u.soldAt)} onChange={e => updateUnit(u.unitKey, { soldAt: isoFromDateInput(e.target.value), status: e.target.value ? "Sold" : u.status })} /></td>
    </tr>})}</tbody></table></div>
    {!units.length && <div className="empty"><div>📦</div><h3>No inventory found</h3><p>Try clearing filters or adding inventory.</p></div>}
  </>;
}


function EditUnitView({ unit, updateUnit, updateLotShared, deleteUnit, setView }: any) {
  if (!unit) return <div className="formWrap"><div className="panel"><h2>Item not found</h2><button className="primary" onClick={() => setView("inventory")}>Back to Inventory</button></div></div>;
  const projectedPayout = payoutFromSale(unit.goalSellPrice);
  const projectedProfit = projectedPayout === null ? null : projectedPayout - unit.totalUnit;
  const projectedRoi = projectedProfit !== null && unit.totalUnit ? (projectedProfit / unit.totalUnit) * 100 : null;
  return <div className="formWrap">
    <h2>✏️ Edit Item</h2>
    <p className="formSub">Full edit page for pricing, purchase dates, sale dates, lot info, and deleting one unit from a lot.</p>
    <div className="flashyForm">
      <div className="twoCols"><Field label="🧺 Lot Name"><input value={unit.lotName} onChange={e => updateLotShared(unit.lotKey, { lotName: e.target.value })} /></Field><Field label="🎵 Unit Name"><input value={unit.unitName} onChange={e => updateUnit(unit.unitKey, { unitName: e.target.value })} /></Field></div>
      <div className="twoCols"><Field label="🏷️ Source"><input value={unit.source} onChange={e => updateLotShared(unit.lotKey, { source: e.target.value })} /></Field><Field label="🧑‍💼 Seller"><input value={unit.seller} onChange={e => updateLotShared(unit.lotKey, { seller: e.target.value })} /></Field></div>
      <div className="twoCols"><Field label="🗂️ Category"><input value={unit.category} onChange={e => updateUnit(unit.unitKey, { category: e.target.value })} /></Field><Field label="✨ Condition"><select value={unit.condition} onChange={e => updateUnit(unit.unitKey, { condition: e.target.value })}>{CONDITIONS.map(x => <option key={x}>{x}</option>)}</select></Field></div>
      <div className="twoCols"><Field label="💵 Lot Product Total"><input value={unit.lotProductTotal} inputMode="decimal" onChange={e => updateLotShared(unit.lotKey, { lotProductTotal: e.target.value })} /></Field><Field label="🚚 Lot Shipping Total"><input value={unit.lotShippingTotal} inputMode="decimal" onChange={e => updateLotShared(unit.lotKey, { lotShippingTotal: e.target.value })} /></Field></div>
      <div className="calcBox"><div className="miniGrid"><Mini label="Qty in Lot" value={unit.lotQty} /><Mini label="Product / Unit" value={money(unit.productUnit)} /><Mini label="Shipping / Unit" value={money(unit.shippingUnit)} /><Mini label="Cost / Unit" value={money(unit.totalUnit)} /><Mini label="Break Even" value={money(unit.breakEven)} /><Mini label="Projected Profit" value={money(projectedProfit)} /><Mini label="Projected ROI" value={pct(projectedRoi)} /></div></div>
      <div className="twoCols"><Field label="🎯 Goal Price"><input value={unit.goalSellPrice} inputMode="decimal" onChange={e => updateUnit(unit.unitKey, { goalSellPrice: e.target.value })} /></Field><Field label="📌 Status"><select value={unit.status} onChange={e => updateUnit(unit.unitKey, { status: e.target.value })}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></Field></div>
      <div className="twoCols"><Field label="💰 Sold For"><input value={unit.actualSalePrice} inputMode="decimal" onChange={e => updateUnit(unit.unitKey, { actualSalePrice: e.target.value })} /></Field><Field label="Actual Profit"><input value={money(unit.profit)} readOnly /></Field></div>
      <div className="twoCols"><Field label="📅 Date Purchased"><input type="date" value={inputDate(unit.dateAdded)} onChange={e => updateUnit(unit.unitKey, { dateAdded: isoFromDateInput(e.target.value) })} /></Field><Field label="✅ Date Sold"><input type="date" value={inputDate(unit.soldAt)} onChange={e => updateUnit(unit.unitKey, { soldAt: isoFromDateInput(e.target.value), status: e.target.value ? "Sold" : unit.status })} /></Field></div>
      <Field label="📝 Notes"><textarea value={unit.notes} onChange={e => updateUnit(unit.unitKey, { notes: e.target.value })} /></Field>
      <div className="buttonRow"><button className="primary" onClick={() => setView("inventory")}>Done</button><button className="secondary danger" onClick={() => { deleteUnit(unit.unitKey); setView("inventory"); }}>Delete this unit</button></div>
    </div>
  </div>;
}

function AddFormView({ form, setForm, setQuantityDraft, saveNew, formQty, formProductUnit, formShipUnit, formUnitCost, formBreakEven, expectedProfit, expectedRoi }: any) {
  function updateDraft(i: number, changes: Partial<DraftUnit>) { setForm((f: AddForm) => ({ ...f, unitDrafts: f.unitDrafts.map((d, idx) => idx === i ? { ...d, ...changes } : d) })); }
  return <div className="formWrap">
    <h2>{form.lotMode ? "📦 Add Lot" : "🎵 Add Single Unit"}</h2>
    <p className="formSub">Single items and lots use the same fields: every item has a Lot Name and Unit Name.</p>
    <div className="flashyForm">
      <div className="toggleRow"><button className={!form.lotMode ? "pill active" : "pill"} onClick={() => setForm((f: AddForm) => ({ ...f, lotMode: false, quantity: "1" }))}>Single item</button><button className={form.lotMode ? "pill active" : "pill"} onClick={() => { setForm((f: AddForm) => ({ ...f, lotMode: true })); setQuantityDraft(parseInt(form.quantity) || 2); }}>Lot builder</button></div>
      <div className="twoCols"><Field label="🧺 Lot Name"><input value={form.lotName} onChange={e => setForm((f: AddForm) => ({ ...f, lotName: e.target.value }))} placeholder="e.g. Whatnot 6/23 Lot" /></Field><Field label="🏷️ Source"><input value={form.source} onChange={e => setForm((f: AddForm) => ({ ...f, source: e.target.value }))} placeholder="Whatnot, eBay, Facebook..." /></Field></div>
      <div className="twoCols"><Field label="🧑‍💼 Seller"><input value={form.seller} onChange={e => setForm((f: AddForm) => ({ ...f, seller: e.target.value }))} /></Field><Field label="🔢 Qty in Lot"><input value={form.quantity} disabled={!form.lotMode} inputMode="numeric" onChange={e => setQuantityDraft(e.target.value)} onBlur={e => { if (!e.target.value) setQuantityDraft("1"); }} /></Field></div>
      <div className="twoCols"><Field label="💵 Product Total"><input value={form.productTotal} inputMode="decimal" onChange={e => setForm((f: AddForm) => ({ ...f, productTotal: e.target.value }))} /></Field><Field label="🚚 Shipping Total"><input value={form.shippingTotal} inputMode="decimal" onChange={e => setForm((f: AddForm) => ({ ...f, shippingTotal: e.target.value }))} /></Field></div>
      <div className="calcBox"><div className="miniGrid"><Mini label="Product / Unit" value={money(formProductUnit)} /><Mini label="Shipping / Unit" value={money(formShipUnit)} /><Mini label="Total / Unit" value={money(formUnitCost)} /><Mini label="Break Even" value={formBreakEven ? money(formBreakEven) : "—"} /><Mini label="Expected Profit" value={money(expectedProfit)} /><Mini label="Expected ROI" value={pct(expectedRoi)} /></div></div>
      {!form.lotMode ? <>
        <div className="twoCols"><Field label="🎵 Unit Name"><input value={form.unitName} onChange={e => setForm((f: AddForm) => ({ ...f, unitName: e.target.value }))} /></Field><Field label="🗂️ Category"><input value={form.category} onChange={e => setForm((f: AddForm) => ({ ...f, category: e.target.value }))} /></Field></div>
        <div className="twoCols"><Field label="✨ Condition"><select value={form.condition} onChange={e => setForm((f: AddForm) => ({ ...f, condition: e.target.value }))}>{CONDITIONS.map(x => <option key={x}>{x}</option>)}</select></Field><Field label="🎯 Goal Price"><input value={form.goalSellPrice} inputMode="decimal" onChange={e => setForm((f: AddForm) => ({ ...f, goalSellPrice: e.target.value }))} /></Field></div>
        <Field label="📝 Notes"><textarea value={form.notes} onChange={e => setForm((f: AddForm) => ({ ...f, notes: e.target.value }))} /></Field>
      </> : <div className="lotBuilder"><h3>Unit details</h3><div className="lotBuilderHead"><span>Unit Name</span><span>Category</span><span>Condition</span><span>Goal</span><span>Notes</span></div>{form.unitDrafts.map((d: DraftUnit, i: number) => <div className="lotBuilderRow" key={i}><input value={d.unitName} onChange={e => updateDraft(i, { unitName: e.target.value })} placeholder={`${form.lotName || "Tonie"} #${i + 1}`} /><input value={d.category} onChange={e => updateDraft(i, { category: e.target.value })} /><select value={d.condition} onChange={e => updateDraft(i, { condition: e.target.value })}>{CONDITIONS.map(x => <option key={x}>{x}</option>)}</select><input value={d.goalSellPrice} inputMode="decimal" onChange={e => updateDraft(i, { goalSellPrice: e.target.value })} /><input value={d.notes} onChange={e => updateDraft(i, { notes: e.target.value })} /></div>)}</div>}
      <button className="primary" disabled={!form.lotName || !form.productTotal} onClick={saveNew}>Add to Inventory</button>
    </div>
  </div>;
}

function SettingsView({ settings, setSettings, doPush, safePullFromSheets, lastPullInfo, setUnits, hasPulledThisSession, dirty }: any) {
  return <div className="formWrap">
    <h2>⚙️ Settings & Safe Sync</h2>
    <div className="panel"><h3>Google Sheets Sync</h3><p className="muted">Sync buttons live only here to prevent accidental pulls. Push is blocked until this browser session has successfully pulled from Google Sheets.</p>
      <Field label="Sync Mode"><select value={settings.syncMode} onChange={e => setSettings((s: Settings) => ({ ...s, syncMode: e.target.value as Settings["syncMode"] }))}><option value="auto">Auto: pull once per session, then batch-push after edits</option><option value="manual">Manual only</option></select></Field>
      <div className="syncStateBox"><b>{hasPulledThisSession ? "✅ Sheet loaded this session" : "⚠️ Pull required before any push"}</b><span>{dirty ? "Unsaved changes waiting to sync." : "No unsaved local changes."}</span></div><div className="buttonRow">{hasPulledThisSession ? <button className="primary" onClick={() => doPush(false)}>Save / Push to Sheet Now</button> : <button className="primary" disabled title="Pull first to unlock pushing">Save / Push locked until Pull</button>}<button className="secondary danger" onClick={() => safePullFromSheets(false, false)}>Pull from Sheets - requires confirmation</button></div>
      <p className="muted">Last synced: {dateText(settings.lastSynced)} {lastPullInfo ? `• ${lastPullInfo}` : ""}</p><p className="muted">Auto-push rule: after a successful pull, edits save locally right away and push to Sheets after about 12 seconds of no activity. Closing/switching apps also attempts an emergency push, but the manual Save button is the safest confirmation.</p>
    </div>
    <div className="panel"><h3>New Google Apps Script</h3><p className="muted">Replace the old Apps Script with this exact code and deploy a new version.</p><textarea className="codeBox" readOnly value={APPS_SCRIPT_CODE} onFocus={(e) => e.currentTarget.select()} /><Field label="Apps Script URL"><input value={DEFAULT_SCRIPT_URL} readOnly /></Field></div>
    <div className="panel"><h3>Backup reminder</h3><p className="muted">The script includes backupInventoryNow() and createTwiceDailyBackupTrigger(). Run createTwiceDailyBackupTrigger once inside Google Apps Script to create automatic backups every 12 hours.</p></div>
    <div className="panel dangerPanel"><h3>Danger Zone</h3><button className="secondary danger" onClick={() => { if (confirm("Clear local browser data only? This does not delete Google Sheets.")) setUnits([]); }}>Clear local browser data</button></div>
  </div>;
}

function Mini({ label, value }: { label: string; value: any }) { return <div className="mini"><small>{label}</small><b>{value}</b></div>; }
function Field({ label, children }: any) { return <label className="field"><span>{label}</span>{children}</label>; }

const css = `
*{box-sizing:border-box}body{margin:0}.page{min-height:100vh;background:linear-gradient(160deg,#0d0b1e 0%,#1a1035 60%,#0d1a2e 100%);color:#f8f7ff;font-family:Inter,system-ui,Segoe UI,sans-serif;padding-bottom:86px}.header{text-align:center;padding:22px 14px 10px;position:relative}.bear{font-size:31px}.header h1{margin:0;font-size:27px;font-weight:950;background:linear-gradient(90deg,#a78bfa,#f0abfc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.sub{font-size:12px;color:#c4b5fd;opacity:.75;font-style:italic}.syncBar{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px;flex-wrap:wrap}.syncBadge,.smallBtn{font-size:12px;padding:5px 10px;border-radius:9px;background:rgba(255,255,255,.065);font-weight:800;border:1px solid rgba(255,255,255,.12);color:#ddd6fe}.syncBadge.success{color:#22c55e}.syncBadge.error{color:#f87171}.syncBadge.syncing{color:#93c5fd}button{cursor:pointer}.toast{position:absolute;right:16px;top:12px;background:rgba(34,197,94,.16);color:#86efac;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:850}.container{width:min(1500px,calc(100% - 28px));margin:0 auto}.statsGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.statsGrid.wide{grid-template-columns:repeat(3,minmax(0,1fr))}.statCard,.panel,.empty,.unitCard,.calcBox{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:16px;color:inherit}.statCard{text-align:left;border:1px solid rgba(255,255,255,.10)}.clickable:hover{background:rgba(167,139,250,.16)}.statCard span,.muted{color:#9ca3af;font-size:12px;line-height:1.5}.statCard b{display:block;font-size:25px;font-weight:950}.statCard em{display:block;font-size:12px;color:#9ca3af;font-style:normal}.gold{color:#fbbf24}.green,.profitGood{color:#22c55e}.red,.profitBad{color:#ef4444}.dashGrid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}.panel h3{margin:0 0 12px;color:#c4b5fd;font-size:14px;text-transform:uppercase;letter-spacing:.8px}.miniLine{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px;border-radius:10px;background:rgba(255,255,255,.04);margin-bottom:8px}.miniLine small{display:block;color:#9ca3af}.empty{text-align:center;padding:38px}.empty div{font-size:48px}button:disabled{opacity:.45;cursor:not-allowed}.syncStateBox{display:flex;flex-direction:column;gap:4px;margin:10px 0 14px;padding:12px;border-radius:12px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.11)}.syncStateBox span{font-size:12px;color:#9ca3af}.primary,.secondary{border:0;border-radius:12px;padding:12px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-weight:900}.secondary{background:transparent;border:1.5px solid #7c3aed;color:#c4b5fd;margin-left:10px}.danger{color:#f87171;border-color:#ef4444}.toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px}.toolbar.advanced{display:grid;grid-template-columns:minmax(220px,1.7fr) repeat(6,minmax(120px,1fr))}.rangeBar,.toggleRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px;color:#c4b5fd;font-size:12px;font-weight:900}.search{min-width:320px}.pill{border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#9ca3af;border-radius:999px;padding:8px 14px;font-weight:850}.pill.active{border-color:#a78bfa;color:#fff;background:rgba(167,139,250,.2)}input,select,textarea{width:100%;background:rgba(255,255,255,.075);border:1.5px solid rgba(255,255,255,.13);border-radius:10px;padding:9px 10px;color:#f8f7ff;font-size:14px;outline:none;font-family:inherit}textarea{min-height:74px}.sheetWrap{overflow:auto;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.035)}.inventoryTable{width:100%;border-collapse:collapse;min-width:2180px}.inventoryTable th{position:sticky;top:0;background:#27183f;color:#ddd6fe;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:10px;border-bottom:1px solid rgba(255,255,255,.12);z-index:1}.inventoryTable td{padding:7px;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;white-space:nowrap}.inventoryTable tr:hover{background:rgba(255,255,255,.04)}.inventoryTable input,.inventoryTable select{padding:6px 7px;border-radius:7px;font-size:13px;min-width:86px}.dangerSmall{border:1px solid #ef4444;background:transparent;color:#f87171;border-radius:8px;padding:6px 9px;font-weight:850}.editSmall{border:1px solid #a78bfa;background:rgba(167,139,250,.12);color:#ddd6fe;border-radius:8px;padding:6px 9px;font-weight:850}.rowNum{color:#c4b5fd;font-weight:900;text-align:center}.countLine{font-size:13px;color:#c4b5fd;margin:0 0 8px;font-weight:850}.formWrap{max-width:1040px;margin:0 auto}.formWrap h2{margin:0 0 8px}.formSub{margin:0 0 16px;color:#c4b5fd;font-size:13px;opacity:.8}.flashyForm{background:linear-gradient(135deg,rgba(124,58,237,.09),rgba(240,171,252,.05));border:1px solid rgba(167,139,250,.18);border-radius:18px;padding:18px;box-shadow:0 18px 55px rgba(124,58,237,.12)}.twoCols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:block;margin-bottom:14px;color:#a78bfa;font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.7px}.field span{display:block;margin-bottom:6px}.miniGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.mini{background:rgba(255,255,255,.045);border-radius:10px;padding:10px;margin-bottom:8px}.mini small{display:block;color:#9ca3af;font-size:10px;margin-bottom:3px}.mini b{font-size:14px}.calcBox{margin-bottom:14px}.codeBox{min-height:360px;font-family:monospace;font-size:12px}.buttonRow{display:flex;gap:10px;flex-wrap:wrap}.dangerPanel{border-color:rgba(239,68,68,.35);margin-top:12px}.lotBuilder{margin:12px 0;overflow:auto}.lotBuilder h3{color:#c4b5fd}.lotBuilderHead,.lotBuilderRow{display:grid;grid-template-columns:1.4fr 1fr 1fr .8fr 1.4fr;gap:8px;min-width:850px}.lotBuilderHead{color:#a78bfa;font-size:11px;font-weight:900;text-transform:uppercase;margin-bottom:5px}.lotBuilderRow{margin-bottom:8px}.nav{position:fixed;bottom:0;left:0;right:0;background:rgba(13,11,30,.96);backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,.08);display:flex;padding:8px 0 12px;z-index:10}.navBtn{flex:1;background:none;border:0;color:#6b7280;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:20px;font-weight:850}.navBtn span{font-size:10px}.navBtn.active{color:#c4b5fd}option{background:#0d0b1e;color:#fff}@media(max-width:1050px){.statsGrid,.statsGrid.wide{grid-template-columns:repeat(2,1fr)}.dashGrid{grid-template-columns:1fr}.toolbar.advanced{display:grid;grid-template-columns:1fr 1fr}.search{min-width:0}.sheetWrap{max-height:calc(100vh - 230px)}}@media(max-width:640px){.statsGrid,.statsGrid.wide,.twoCols,.miniGrid{grid-template-columns:1fr}.toolbar.advanced{grid-template-columns:1fr}.container{width:min(100% - 22px,1500px)}.header h1{font-size:24px}.toast{position:static;display:inline-block;margin-top:8px}.secondary{margin-left:0;margin-top:8px}.inventoryTable{min-width:2180px}.sheetWrap{max-height:calc(100vh - 210px)}.lotBuilderHead,.lotBuilderRow{min-width:850px}}
`;
