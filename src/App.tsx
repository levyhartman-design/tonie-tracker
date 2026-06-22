import { useState, useMemo, useEffect, useCallback, useRef } from "react";

// ── WHATNOT FEE CONSTANTS ──
const COMMISSION = 0.08;
const PROC_PCT   = 0.029;
const PROC_FLAT  = 0.30;

function calcPayout(salePrice) {
  const sp = parseFloat(salePrice) || 0;
  return sp - sp * COMMISSION - (sp * PROC_PCT + PROC_FLAT);
}
function calcBreakEven(costToRecover) {
  return (costToRecover + PROC_FLAT) / (1 - COMMISSION - PROC_PCT);
}
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}
function fmtDate(ts) {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CONDITIONS  = ["New (sealed)", "Like New", "Good", "Fair"];
const SOURCES     = ["eBay", "Facebook Marketplace", "Garage Sale", "Retail", "Lot", "Other"];
const statusColor = { "In Stock": "#60a5fa", "Listed": "#f59e0b", "Sold": "#22c55e" };
const STORAGE_KEY = "dahlia_tonie_tracker_v2";
const SETTINGS_KEY = "dahlia_tonie_settings_v2";

const EMPTY_FORM = {
  name: "", condition: "New (sealed)", source: "eBay",
  totalCostPaid: "", inboundShipping: "", quantity: "1",
  goalSellPrice: "", notes: "",
};

function makeUnits(qty, goalSellPrice, baseName) {
  return Array.from({ length: qty }, (_, i) => ({
    id: Date.now() + i,
    name: qty > 1 ? `${baseName} #${i + 1}` : baseName,
    status: "In Stock",
    goalSellPrice: goalSellPrice || "",
    actualSalePrice: "",
  }));
}

// ── GOOGLE SHEETS SYNC ──
async function syncToSheets(scriptUrl, lots) {
  if (!scriptUrl) throw new Error("No Script URL set");
  // Flatten lots into rows
  const rows = [];
  lots.forEach(lot => {
    const lotCost = (parseFloat(lot.totalCostPaid) || 0) + (parseFloat(lot.inboundShipping) || 0);
    const perUnit = lotCost / lot.units.length;
    lot.units.forEach(unit => {
      const payout = unit.actualSalePrice ? calcPayout(unit.actualSalePrice) : null;
      rows.push({
        lotId: lot.id,
        lotName: lot.name,
        unitName: unit.name,
        condition: lot.condition,
        source: lot.source,
        totalCostPaid: lot.totalCostPaid,
        inboundShipping: lot.inboundShipping || 0,
        quantity: lot.units.length,
        costPerUnit: perUnit.toFixed(2),
        breakEven: calcBreakEven(perUnit).toFixed(2),
        goalSellPrice: unit.goalSellPrice || "",
        status: unit.status,
        actualSalePrice: unit.actualSalePrice || "",
        payoutAfterFees: payout !== null ? payout.toFixed(2) : "",
        profitVsCost: payout !== null ? (payout - perUnit).toFixed(2) : "",
        notes: lot.notes || "",
        syncedAt: new Date().toISOString(),
      });
    });
  });
  const response = await fetch(scriptUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync", rows }),
  });
  return true; // no-cors means we can't read response, assume success
}

// ── MAIN APP ──
export default function App() {
  const [lots, setLots] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [settings, setSettings] = useState(() => {
    try { const s = localStorage.getItem(SETTINGS_KEY); return s ? JSON.parse(s) : { scriptUrl: "", syncMode: "manual", lastSynced: null }; } catch { return { scriptUrl: "", syncMode: "manual", lastSynced: null }; }
  });

  const [view, setView]             = useState("dashboard");
  const [form, setForm]             = useState(EMPTY_FORM);
  const [editLotId, setEditLotId]   = useState(null);
  const [detailLotId, setDetailLotId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [savedFlash, setSavedFlash] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // null | "syncing" | "success" | "error"
  const autoSyncTimer = useRef(null);

  // ── PERSIST LOTS ──
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lots));
      if (lots.length > 0) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500); }
    } catch {}

    // Auto sync trigger
    if (settings.syncMode === "auto" && settings.scriptUrl && lots.length > 0) {
      clearTimeout(autoSyncTimer.current);
      autoSyncTimer.current = setTimeout(() => doSync(), 3000); // debounce 3s
    }
  }, [lots]);

  // ── PERSIST SETTINGS ──
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  async function doSync() {
    if (!settings.scriptUrl) { setSyncStatus("error"); setTimeout(() => setSyncStatus(null), 3000); return; }
    setSyncStatus("syncing");
    try {
      await syncToSheets(settings.scriptUrl, lots);
      const now = Date.now();
      setSettings(s => ({ ...s, lastSynced: now }));
      setSyncStatus("success");
      setTimeout(() => setSyncStatus(null), 2500);
    } catch {
      setSyncStatus("error");
      setTimeout(() => setSyncStatus(null), 3000);
    }
  }

  // ── STATS ──
  const stats = useMemo(() => {
    let totalInvested = 0, realizedProfit = 0, projectedProfit = 0, soldUnits = 0, inStockUnits = 0;
    lots.forEach(lot => {
      const lotCost = (parseFloat(lot.totalCostPaid)||0) + (parseFloat(lot.inboundShipping)||0);
      totalInvested += lotCost;
      const perUnit = lotCost / lot.units.length;
      const soldPayouts = lot.units.filter(u=>u.status==="Sold"&&u.actualSalePrice).reduce((s,u)=>s+calcPayout(u.actualSalePrice),0);
      soldUnits   += lot.units.filter(u=>u.status==="Sold").length;
      inStockUnits += lot.units.filter(u=>u.status!=="Sold").length;
      realizedProfit += soldPayouts - lotCost;
      lot.units.filter(u=>u.status!=="Sold").forEach(u => {
        const goal = parseFloat(u.goalSellPrice)||0;
        if (goal > 0) projectedProfit += calcPayout(goal) - perUnit;
      });
    });
    return { totalInvested, realizedProfit, projectedProfit, soldUnits, inStockUnits };
  }, [lots]);

  // ── CRUD ──
  function saveLot() {
    if (!form.name || !form.totalCostPaid) return;
    if (editLotId !== null) {
      setLots(prev => prev.map(l => {
        if (l.id !== editLotId) return l;
        const newQty = parseInt(form.quantity)||1;
        let units = [...l.units];
        if (newQty > units.length) {
          for (let i = units.length; i < newQty; i++)
            units.push({ id: Date.now()+i, name: `${form.name} #${i+1}`, status:"In Stock", goalSellPrice: form.goalSellPrice||"", actualSalePrice:"" });
        } else { units = units.slice(0, newQty); }
        return { ...form, id: editLotId, units };
      }));
      setEditLotId(null);
    } else {
      const units = makeUnits(parseInt(form.quantity)||1, form.goalSellPrice, form.name);
      setLots(prev => [...prev, { ...form, id: Date.now(), units }]);
    }
    setForm(EMPTY_FORM);
    setView("inventory");
  }

  function updateUnit(lotId, unitId, changes) {
    setLots(prev => prev.map(l =>
      l.id !== lotId ? l : { ...l, units: l.units.map(u => u.id !== unitId ? u : { ...u, ...changes }) }
    ));
  }

  function deleteLot(id) { setLots(prev => prev.filter(l => l.id !== id)); setView("inventory"); }

  const detailLot = lots.find(l => l.id === detailLotId);
  const filteredLots = filterStatus === "All" ? lots : lots.filter(l => l.units.some(u => u.status === filterStatus));
  const totalCost = (parseFloat(form.totalCostPaid)||0) + (parseFloat(form.inboundShipping)||0);
  const qty       = parseInt(form.quantity)||1;
  const perUnitCost = totalCost / qty;
  const breakEven   = totalCost > 0 ? calcBreakEven(perUnitCost) : null;
  const goalPayout  = form.goalSellPrice ? calcPayout(form.goalSellPrice) : null;
  const goalProfit  = goalPayout !== null ? goalPayout - perUnitCost : null;

  // ── STYLES ──
  const bg   = "linear-gradient(160deg,#0d0b1e 0%,#1a1035 60%,#0d1a2e 100%)";
  const card = { background:"rgba(255,255,255,0.05)", borderRadius:16, border:"1px solid rgba(255,255,255,0.08)", padding:16, marginBottom:12 };
  const inp  = { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.07)", border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10, padding:"11px 12px", color:"#f0eeff", fontSize:15, fontWeight:500, outline:"none", fontFamily:"inherit" };
  const pill = (active, color="#7c3aed") => ({ padding:"6px 14px", borderRadius:20, border:`1.5px solid ${active ? color : "rgba(255,255,255,0.12)"}`, background: active ? `${color}30` : "transparent", color: active ? "#e9d5ff" : "#6b7280", fontWeight:600, fontSize:12, cursor:"pointer" });

  const syncBadgeColor = syncStatus === "syncing" ? "#f59e0b" : syncStatus === "success" ? "#22c55e" : syncStatus === "error" ? "#ef4444" : settings.lastSynced ? "#60a5fa" : "#4b5563";
  const syncBadgeText  = syncStatus === "syncing" ? "⏳ Syncing..." : syncStatus === "success" ? "✓ Synced!" : syncStatus === "error" ? "✗ Sync failed" : settings.lastSynced ? `☁ ${fmtDate(settings.lastSynced)}` : "☁ Not synced";

  return (
    <div style={{ minHeight:"100vh", background:bg, fontFamily:"'Inter','Segoe UI',sans-serif", color:"#f0eeff", paddingBottom:90 }}>

      {/* ── HEADER ── */}
      <div style={{ textAlign:"center", padding:"22px 16px 10px", position:"relative" }}>
        <div style={{ fontSize:28, marginBottom:2 }}>🧸</div>
        <h1 style={{ margin:0, fontSize:21, fontWeight:900, background:"linear-gradient(90deg,#a78bfa,#f0abfc)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Dahlia's Tonie Tracker</h1>
        <p style={{ margin:"3px 0 0", fontSize:11, color:"#c4b5fd", opacity:0.6, fontStyle:"italic" }}>with love, Levy Yitschock 💕</p>

        {/* Sync badge + settings gear */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:8 }}>
          <span style={{ fontSize:11, color:syncBadgeColor, fontWeight:600, background:`${syncBadgeColor}18`, padding:"3px 10px", borderRadius:8 }}>
            {syncBadgeText}
          </span>
          {settings.syncMode === "manual" && settings.scriptUrl && (
            <button onClick={doSync} disabled={syncStatus==="syncing"}
              style={{ fontSize:11, padding:"3px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.06)", color:"#a78bfa", fontWeight:600, cursor:"pointer" }}>
              Sync now
            </button>
          )}
          {settings.syncMode === "export" && settings.scriptUrl && (
            <button onClick={doSync} disabled={syncStatus==="syncing"}
              style={{ fontSize:11, padding:"3px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.06)", color:"#a78bfa", fontWeight:600, cursor:"pointer" }}>
              Export to Sheets
            </button>
          )}
          <button onClick={() => setView("settings")}
            style={{ fontSize:16, background:"none", border:"none", cursor:"pointer", color:"#4b5563", padding:"0 4px" }}>⚙️</button>
        </div>
        {savedFlash && (
          <div style={{ position:"absolute", top:12, right:16, fontSize:11, color:"#22c55e", fontWeight:700, background:"rgba(34,197,94,0.1)", padding:"4px 10px", borderRadius:8 }}>✓ Saved</div>
        )}
      </div>

      <div style={{ padding:"0 16px" }}>

        {/* ══════════════════════════════════════
            SETTINGS VIEW
        ══════════════════════════════════════ */}
        {view === "settings" && (
          <div>
            <button onClick={() => setView("dashboard")} style={{ background:"none", border:"none", color:"#a78bfa", fontWeight:700, fontSize:14, cursor:"pointer", marginBottom:14, padding:0 }}>← Back</button>
            <h2 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800 }}>⚙️ Settings</h2>

            {/* Google Sheets Setup */}
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:800, color:"#a78bfa", marginBottom:12 }}>☁️ Google Sheets Sync</div>

              {/* Step by step instructions */}
              <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"12px 14px", marginBottom:14, fontSize:12, color:"#9ca3af", lineHeight:1.7 }}>
                <div style={{ color:"#e9d5ff", fontWeight:700, marginBottom:6 }}>📋 Setup Instructions (one time only):</div>
                <div>1. Open <strong style={{color:"#a78bfa"}}>Google Sheets</strong> and create a new spreadsheet</div>
                <div>2. Click <strong style={{color:"#a78bfa"}}>Extensions → Apps Script</strong></div>
                <div>3. Delete all existing code, paste in the Apps Script below</div>
                <div>4. Click <strong style={{color:"#a78bfa"}}>Deploy → New deployment → Web App</strong></div>
                <div>5. Set "Who has access" to <strong style={{color:"#a78bfa"}}>Anyone</strong></div>
                <div>6. Copy the Web App URL and paste it below</div>
              </div>

              {/* Apps Script code to copy */}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:"#6b7280", fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Apps Script Code (copy this):</div>
                <div style={{ background:"#0d0b1e", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 12px", fontSize:11, color:"#a78bfa", fontFamily:"monospace", lineHeight:1.6, overflowX:"auto", whiteSpace:"pre" }}>
{`function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action !== "sync") return ok();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Inventory") 
      || ss.insertSheet("Inventory");
    sheet.clearContents();
    var headers = [
      "Lot Name","Unit Name","Condition",
      "Source","Total Cost","Shipping",
      "Qty","Cost/Unit","Break Even",
      "Goal Price","Status","Sold For",
      "Payout","Profit","Notes","Synced"
    ];
    sheet.appendRow(headers);
    data.rows.forEach(function(r) {
      sheet.appendRow([
        r.lotName, r.unitName, r.condition,
        r.source, r.totalCostPaid, r.inboundShipping,
        r.quantity, r.costPerUnit, r.breakEven,
        r.goalSellPrice, r.status, r.actualSalePrice,
        r.payoutAfterFees, r.profitVsCost,
        r.notes, r.syncedAt
      ]);
    });
    return ok();
  } catch(err) {
    return ok();
  }
}
function ok() {
  return ContentService
    .createTextOutput(
      JSON.stringify({status:"ok"})
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}`}
                </div>
              </div>

              {/* Script URL input */}
              <Field label="Your Web App URL">
                <input style={inp} value={settings.scriptUrl} placeholder="https://script.google.com/macros/s/..." onChange={e => setSettings(s => ({ ...s, scriptUrl: e.target.value.trim() }))} />
              </Field>

              {/* Sync mode */}
              <Field label="Sync Mode">
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {[
                    ["auto",   "🔄 Auto",   "Syncs to Google Sheets every time you make a change (3 second delay)"],
                    ["manual", "👆 Manual", "You tap 'Sync now' in the header whenever you want"],
                    ["export", "📤 Export", "One button push — sends everything at once when you're ready"],
                  ].map(([val, label, desc]) => (
                    <div key={val} onClick={() => setSettings(s => ({ ...s, syncMode: val }))}
                      style={{ padding:"10px 14px", borderRadius:12, border:`1.5px solid ${settings.syncMode===val ? "#7c3aed" : "rgba(255,255,255,0.08)"}`, background: settings.syncMode===val ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.02)", cursor:"pointer" }}>
                      <div style={{ fontWeight:700, fontSize:13, color: settings.syncMode===val ? "#e9d5ff" : "#9ca3af" }}>{label}</div>
                      <div style={{ fontSize:12, color:"#4b5563", marginTop:2 }}>{desc}</div>
                    </div>
                  ))}
                </div>
              </Field>

              {settings.scriptUrl && (
                <button onClick={doSync} disabled={syncStatus==="syncing"}
                  style={{ width:"100%", padding:"12px 0", borderRadius:12, border:"none", background:"linear-gradient(135deg,#7c3aed,#a855f7)", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", marginTop:4 }}>
                  {syncStatus==="syncing" ? "⏳ Syncing..." : "Test Sync Now"}
                </button>
              )}
              {settings.lastSynced && (
                <div style={{ textAlign:"center", fontSize:11, color:"#4b5563", marginTop:8 }}>Last synced: {fmtDate(settings.lastSynced)}</div>
              )}
            </div>

            {/* Danger zone */}
            <div style={{ ...card, border:"1px solid rgba(239,68,68,0.2)", background:"rgba(239,68,68,0.04)" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"#f87171", marginBottom:10 }}>⚠️ Danger Zone</div>
              <button onClick={() => { if(window.confirm("Delete ALL data? This cannot be undone.")) { setLots([]); setView("dashboard"); } }}
                style={{ width:"100%", padding:"11px 0", borderRadius:10, border:"1.5px solid #ef4444", background:"transparent", color:"#f87171", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                🗑️ Clear All Data
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            DASHBOARD
        ══════════════════════════════════════ */}
        {view === "dashboard" && (
          <div>
            {lots.length === 0 ? (
              <div style={{ ...card, textAlign:"center", padding:32 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📦</div>
                <p style={{ color:"#6b7280", margin:"0 0 16px" }}>No Tonies yet — add your first purchase!</p>
                <button onClick={() => setView("add")} style={{ padding:"10px 24px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#7c3aed,#a855f7)", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:14 }}>+ Add Tonie</button>
              </div>
            ) : (<>
              <div style={{ ...card, background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)" }}>
                <div style={{ fontSize:11, color:"#86efac", textTransform:"uppercase", letterSpacing:1, marginBottom:10, fontWeight:700 }}>✅ Already Sold</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <Stat label="Units Sold" value={`${stats.soldUnits}`} unit="tonies" color="#22c55e" />
                  <Stat label="Profit in Pocket" value={fmt(stats.realizedProfit)} color={stats.realizedProfit>=0?"#22c55e":"#ef4444"} big />
                </div>
                <div style={{ marginTop:8, fontSize:11, color:"#4ade80", opacity:0.7 }}>All payouts received minus full lot costs paid</div>
              </div>

              <div style={{ ...card, background:"rgba(168,85,247,0.08)", border:"1px solid rgba(168,85,247,0.2)" }}>
                <div style={{ fontSize:11, color:"#c4b5fd", textTransform:"uppercase", letterSpacing:1, marginBottom:10, fontWeight:700 }}>🎯 Still to Sell (at Goal Prices)</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <Stat label="Units Left" value={`${stats.inStockUnits}`} unit="tonies" color="#a78bfa" />
                  <Stat label="Potential Profit" value={fmt(stats.projectedProfit)} color="#a78bfa" big />
                </div>
              </div>

              <div style={{ ...card, background:"rgba(249,168,37,0.07)", border:"1px solid rgba(249,168,37,0.2)" }}>
                <div style={{ fontSize:11, color:"#fcd34d", textTransform:"uppercase", letterSpacing:1, marginBottom:10, fontWeight:700 }}>💰 Full Picture</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <Stat label="Total Invested" value={fmt(stats.totalInvested)} color="#fbbf24" big />
                  <Stat label="Total Profit" value={fmt(stats.realizedProfit+stats.projectedProfit)} color={(stats.realizedProfit+stats.projectedProfit)>=0?"#fbbf24":"#ef4444"} big />
                </div>
              </div>

              <div style={{ marginTop:4 }}>
                <div style={{ fontSize:11, color:"#6b7280", marginBottom:8, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8 }}>Recent Purchases</div>
                {[...lots].reverse().slice(0,4).map(lot => {
                  const lotCost = (parseFloat(lot.totalCostPaid)||0)+(parseFloat(lot.inboundShipping)||0);
                  const sold = lot.units.filter(u=>u.status==="Sold").length;
                  const pct  = Math.round((sold/lot.units.length)*100);
                  return (
                    <div key={lot.id} onClick={() => { setDetailLotId(lot.id); setView("detail"); }}
                      style={{ ...card, cursor:"pointer", marginBottom:8, padding:"12px 14px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                        <div>
                          <div style={{ fontWeight:700 }}>{lot.name}</div>
                          <div style={{ fontSize:12, color:"#6b7280", marginTop:1 }}>{lot.units.length} units · {fmt(lotCost)}</div>
                        </div>
                        <div style={{ fontSize:12, color:"#22c55e", fontWeight:700 }}>{sold}/{lot.units.length} sold</div>
                      </div>
                      <div style={{ height:4, background:"rgba(255,255,255,0.08)", borderRadius:4, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#7c3aed,#22c55e)", borderRadius:4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>)}
          </div>
        )}

        {/* ══════════════════════════════════════
            INVENTORY
        ══════════════════════════════════════ */}
        {view === "inventory" && (
          <div>
            <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
              {["All","In Stock","Listed","Sold"].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={pill(filterStatus===s, statusColor[s]||"#7c3aed")}>
                  {s} ({s==="All" ? lots.reduce((n,l)=>n+l.units.length,0) : lots.reduce((n,l)=>n+l.units.filter(u=>u.status===s).length,0)})
                </button>
              ))}
            </div>
            {filteredLots.length === 0
              ? <div style={{ ...card, textAlign:"center", padding:32 }}><p style={{ color:"#6b7280", margin:0 }}>No items here.</p></div>
              : filteredLots.map(lot => {
                const lotCost = (parseFloat(lot.totalCostPaid)||0)+(parseFloat(lot.inboundShipping)||0);
                const sold = lot.units.filter(u=>u.status==="Sold").length;
                const soldPayouts = lot.units.filter(u=>u.status==="Sold"&&u.actualSalePrice).reduce((s,u)=>s+calcPayout(u.actualSalePrice),0);
                const profit = soldPayouts - lotCost;
                return (
                  <div key={lot.id} onClick={() => { setDetailLotId(lot.id); setView("detail"); }}
                    style={{ ...card, cursor:"pointer", marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ fontWeight:800, fontSize:15 }}>{lot.name}</div>
                        <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>{lot.condition} · {lot.source}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:12, color:"#22c55e", fontWeight:700 }}>{sold}/{lot.units.length} sold</div>
                        {sold > 0 && <div style={{ fontSize:12, color:profit>=0?"#22c55e":"#ef4444", marginTop:2 }}>{fmt(profit)}</div>}
                      </div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                      <MiniStat label="Total Cost" value={fmt(lotCost)} />
                      <MiniStat label="Min/unit" value={fmt(calcBreakEven(lotCost/lot.units.length))} color="#f59e0b" />
                      <MiniStat label="Goal/unit" value={lot.goalSellPrice ? fmt(parseFloat(lot.goalSellPrice)) : "—"} color="#a78bfa" />
                    </div>
                    <div style={{ height:3, background:"rgba(255,255,255,0.07)", borderRadius:4, overflow:"hidden", marginTop:10 }}>
                      <div style={{ height:"100%", width:`${Math.round((sold/lot.units.length)*100)}%`, background:"linear-gradient(90deg,#7c3aed,#22c55e)", borderRadius:4 }} />
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* ══════════════════════════════════════
            DETAIL
        ══════════════════════════════════════ */}
        {view === "detail" && detailLot && (() => {
          const lotCost = (parseFloat(detailLot.totalCostPaid)||0)+(parseFloat(detailLot.inboundShipping)||0);
          const perUnit = lotCost/detailLot.units.length;
          const be = calcBreakEven(perUnit);
          const totalSoldPayout = detailLot.units.filter(u=>u.status==="Sold"&&u.actualSalePrice).reduce((s,u)=>s+calcPayout(u.actualSalePrice),0);
          const realProfit = totalSoldPayout - lotCost;
          const projectedExtra = detailLot.units.filter(u=>u.status!=="Sold"&&u.goalSellPrice).reduce((s,u)=>s+calcPayout(u.goalSellPrice)-perUnit,0);
          const sold = detailLot.units.filter(u=>u.status==="Sold").length;
          return (
            <div>
              <button onClick={() => setView("inventory")} style={{ background:"none", border:"none", color:"#a78bfa", fontWeight:700, fontSize:14, cursor:"pointer", marginBottom:12, padding:0 }}>← Back</button>
              <div style={card}>
                <h2 style={{ margin:"0 0 4px", fontSize:19, fontWeight:900 }}>{detailLot.name}</h2>
                <div style={{ fontSize:12, color:"#6b7280", marginBottom:14 }}>{detailLot.condition} · {detailLot.source}</div>
                <Row label="Total cost paid" value={fmt(parseFloat(detailLot.totalCostPaid))} />
                {detailLot.inboundShipping && <Row label="Inbound shipping" value={fmt(parseFloat(detailLot.inboundShipping))} />}
                <Row label="Total invested" value={fmt(lotCost)} />
                <Row label="Units in lot" value={`${detailLot.units.length} tonies`} />
                <Row label="Cost per unit" value={fmt(perUnit)} />
                <div style={{ height:1, background:"rgba(255,255,255,0.07)", margin:"10px 0" }} />
                <Row label="⚠️ Break-even per unit" value={fmt(be)} color="#f59e0b" />
                <Row label="🎯 Goal per unit" value={detailLot.goalSellPrice ? fmt(parseFloat(detailLot.goalSellPrice)) : "—"} color="#a78bfa" />
                <div style={{ height:1, background:"rgba(255,255,255,0.07)", margin:"10px 0" }} />
                <Row label="Payout from sold units" value={fmt(totalSoldPayout)} color="#22c55e" />
                <Row label="Profit so far (payout − full lot cost)" value={fmt(realProfit)} color={realProfit>=0?"#22c55e":"#ef4444"} />
                {projectedExtra !== 0 && <Row label="+ Projected from unsold" value={fmt(projectedExtra)} color="#a78bfa" />}
                <div style={{ marginTop:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#6b7280", marginBottom:4 }}>
                    <span>{sold}/{detailLot.units.length} sold</span><span>{Math.round((sold/detailLot.units.length)*100)}%</span>
                  </div>
                  <div style={{ height:6, background:"rgba(255,255,255,0.07)", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${Math.round((sold/detailLot.units.length)*100)}%`, background:"linear-gradient(90deg,#7c3aed,#22c55e)", borderRadius:4 }} />
                  </div>
                </div>
              </div>

              <div style={{ fontSize:11, color:"#6b7280", fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Individual Units ({detailLot.units.length})</div>
              {detailLot.units.map((unit, i) => {
                const unitPayout = unit.actualSalePrice ? calcPayout(unit.actualSalePrice) : null;
                const unitProfit = unitPayout !== null ? unitPayout - perUnit : null;
                return (
                  <div key={unit.id} style={{ ...card, marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, gap:8 }}>
                      <input value={unit.name||`Unit #${i+1}`} onChange={e => updateUnit(detailLot.id, unit.id, { name:e.target.value })}
                        style={{ ...inp, padding:"6px 10px", fontSize:14, fontWeight:700, flex:1 }} placeholder={`Unit #${i+1}`} />
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        {["In Stock","Listed","Sold"].map(s => (
                          <button key={s} onClick={() => updateUnit(detailLot.id, unit.id, { status:s, actualSalePrice: s!=="Sold"?"":unit.actualSalePrice })}
                            style={{ padding:"4px 8px", borderRadius:10, border:`1.5px solid ${unit.status===s?statusColor[s]:"rgba(255,255,255,0.1)"}`, background: unit.status===s?`${statusColor[s]}25`:"transparent", color: unit.status===s?statusColor[s]:"#4b5563", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                            {s==="In Stock"?"Stock":s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:10, color:"#6b7280", marginBottom:4 }}>🎯 GOAL</div>
                        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ color:"#6b7280" }}>$</span>
                          <input type="number" inputMode="decimal" value={unit.goalSellPrice} placeholder="0.00"
                            onChange={e => updateUnit(detailLot.id, unit.id, { goalSellPrice:e.target.value })}
                            style={{ ...inp, padding:"7px 10px", fontSize:14 }} />
                        </div>
                      </div>
                      {unit.status === "Sold" && (
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, color:"#22c55e", marginBottom:4 }}>✅ SOLD FOR</div>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ color:"#6b7280" }}>$</span>
                            <input type="number" inputMode="decimal" value={unit.actualSalePrice} placeholder="0.00"
                              onChange={e => updateUnit(detailLot.id, unit.id, { actualSalePrice:e.target.value })}
                              style={{ ...inp, padding:"7px 10px", fontSize:14 }} />
                          </div>
                        </div>
                      )}
                    </div>
                    {unit.status==="Sold" && unitPayout!==null && unitProfit!==null && (
                      <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                        <span style={{ color:"#9ca3af" }}>Payout after fees: <span style={{ color:"#22c55e", fontWeight:700 }}>{fmt(unitPayout)}</span></span>
                        <span style={{ color:unitProfit>=0?"#22c55e":"#ef4444", fontWeight:700 }}>{unitProfit>=0?"+":""}{fmt(unitProfit)} vs cost</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                <button onClick={() => { setForm(detailLot); setEditLotId(detailLot.id); setView("add"); }}
                  style={{ flex:1, padding:"12px 0", borderRadius:12, border:"1.5px solid #7c3aed", background:"transparent", color:"#a78bfa", fontWeight:700, fontSize:14, cursor:"pointer" }}>✏️ Edit</button>
                <button onClick={() => deleteLot(detailLot.id)}
                  style={{ flex:1, padding:"12px 0", borderRadius:12, border:"1.5px solid #ef4444", background:"transparent", color:"#f87171", fontWeight:700, fontSize:14, cursor:"pointer" }}>🗑️ Delete</button>
              </div>
            </div>
          );
        })()}

        {/* ══════════════════════════════════════
            ADD / EDIT
        ══════════════════════════════════════ */}
        {view === "add" && (
          <div>
            <h2 style={{ margin:"0 0 16px", fontSize:18, fontWeight:800 }}>{editLotId?"✏️ Edit Purchase":"➕ Add Tonie Purchase"}</h2>
            <Field label="Lot / Purchase Name *">
              <input style={inp} value={form.name} placeholder="e.g. Mixed Lot, Peppa Pig" onChange={e => setForm(f=>({...f,name:e.target.value}))} />
              <div style={{ fontSize:11, color:"#6b7280", marginTop:5 }}>For mixed lots, you can rename each unit individually after saving</div>
            </Field>
            <Field label="Condition">
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {CONDITIONS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,condition:c}))} style={pill(form.condition===c)}>{c}</button>)}
              </div>
            </Field>
            <Field label="Where You Bought It">
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {SOURCES.map(s=><button key={s} onClick={()=>setForm(f=>({...f,source:s}))} style={pill(form.source===s)}>{s}</button>)}
              </div>
            </Field>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Field label="Total Cost Paid *">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ color:"#6b7280", fontWeight:700 }}>$</span>
                  <input style={inp} type="number" inputMode="decimal" value={form.totalCostPaid} placeholder="0.00" onChange={e=>setForm(f=>({...f,totalCostPaid:e.target.value}))} />
                </div>
              </Field>
              <Field label="Inbound Shipping">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ color:"#6b7280", fontWeight:700 }}>$</span>
                  <input style={inp} type="number" inputMode="decimal" value={form.inboundShipping} placeholder="0.00" onChange={e=>setForm(f=>({...f,inboundShipping:e.target.value}))} />
                </div>
              </Field>
            </div>
            <Field label="How Many Tonies?">
              <input style={inp} type="number" inputMode="numeric" value={form.quantity} placeholder="1" onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} />
            </Field>
            {totalCost > 0 && qty > 0 && (
              <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div><div style={{ fontSize:10, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Total you paid</div><div style={{ fontWeight:800 }}>{fmt(totalCost)}</div></div>
                  <div><div style={{ fontSize:10, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Cost per unit</div><div style={{ fontWeight:800 }}>{fmt(perUnitCost)}</div></div>
                </div>
              </div>
            )}
            {breakEven && (
              <div style={{ background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                <div style={{ fontSize:11, color:"#fbbf24", fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:2 }}>⚠️ Min Sell Price Per Unit</div>
                <div style={{ fontSize:28, fontWeight:900, color:"#fbbf24" }}>{fmt(breakEven)}</div>
                <div style={{ fontSize:11, color:"#92400e", marginTop:2 }}>Sell below this = a loss after Whatnot fees</div>
              </div>
            )}
            <Field label="🎯 Goal Sell Price (per unit)">
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ color:"#6b7280", fontWeight:700 }}>$</span>
                <input style={inp} type="number" inputMode="decimal" value={form.goalSellPrice} placeholder="0.00" onChange={e=>setForm(f=>({...f,goalSellPrice:e.target.value}))} />
              </div>
              {goalProfit !== null && breakEven && (
                <div style={{ marginTop:8, padding:"10px 12px", borderRadius:10, background: goalProfit>=0?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)", border:`1px solid ${goalProfit>=0?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"}` }}>
                  {goalProfit >= 0 ? (<>
                    <div style={{ fontSize:13, color:"#22c55e", fontWeight:700 }}>✅ Profit per unit: {fmt(goalProfit)}</div>
                    <div style={{ fontSize:12, color:"#4ade80", marginTop:3 }}>If all {qty} sell at goal: {fmt(calcPayout(parseFloat(form.goalSellPrice))*qty - totalCost)} total profit</div>
                  </>) : (
                    <div style={{ fontSize:13, color:"#ef4444", fontWeight:700 }}>⚠️ Below break-even — you'll lose money!</div>
                  )}
                </div>
              )}
            </Field>
            <Field label="Notes (optional)">
              <textarea style={{ ...inp, minHeight:60, resize:"vertical" }} value={form.notes} placeholder="Any notes..." onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
            </Field>
            <button onClick={saveLot} disabled={!form.name||!form.totalCostPaid} style={{
              width:"100%", padding:"14px 0", borderRadius:13, border:"none",
              background: form.name&&form.totalCostPaid?"linear-gradient(135deg,#7c3aed,#a855f7)":"rgba(255,255,255,0.08)",
              color: form.name&&form.totalCostPaid?"#fff":"#4b5563",
              fontWeight:800, fontSize:16, cursor: form.name&&form.totalCostPaid?"pointer":"not-allowed", marginTop:4,
            }}>
              {editLotId?"Save Changes":`Add ${qty>1?qty+" Tonies":"Tonie"} to Inventory`}
            </button>
          </div>
        )}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"rgba(13,11,30,0.95)", backdropFilter:"blur(12px)", borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", padding:"8px 0 12px" }}>
        {[["dashboard","📊","Dashboard"],["inventory","📦","Inventory"],["add","➕","Add"],["settings","⚙️","Settings"]].map(([v,icon,lbl]) => (
          <button key={v} onClick={() => { setView(v); if(v==="add"){setForm(EMPTY_FORM);setEditLotId(null);} }}
            style={{ flex:1, background:"none", border:"none", cursor:"pointer", color: view===v?"#a78bfa":"#4b5563", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span style={{ fontSize:18 }}>{icon}</span>
            <span style={{ fontSize:10, fontWeight:700 }}>{lbl}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color="#f0eeff", big }) {
  return (
    <div>
      <div style={{ fontSize:10, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.6, marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:big?19:24, fontWeight:900, color }}>{value}{unit&&<span style={{ fontSize:12, fontWeight:500, color:"#6b7280", marginLeft:3 }}>{unit}</span>}</div>
    </div>
  );
}
function MiniStat({ label, value, color="#f0eeff" }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
      <div style={{ fontSize:10, color:"#6b7280", marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:800, color }}>{value}</div>
    </div>
  );
}
function Row({ label, value, color="#f0eeff" }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:14 }}>
      <span style={{ color:"#9ca3af" }}>{label}</span>
      <span style={{ fontWeight:700, color }}>{value}</span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:11, fontWeight:700, color:"#a78bfa", textTransform:"uppercase", letterSpacing:0.8, display:"block", marginBottom:7 }}>{label}</label>
      {children}
    </div>
  );
}
