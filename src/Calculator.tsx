import { useState } from "react";

const WHATNOT_COMMISSION = 0.08;
const WHATNOT_PROCESSING_PCT = 0.029;
const WHATNOT_PROCESSING_FLAT = 0.30;

function calcFees(salePrice, shippingPaidBySeller = 0) {
  // Commission is on item sale price only
  const commission = salePrice * WHATNOT_COMMISSION;
  // Processing fee is on total order value (item + any shipping buyer pays)
  // We assume buyer pays shipping unless seller covers it
  const processingFee = salePrice * WHATNOT_PROCESSING_PCT + WHATNOT_PROCESSING_FLAT;
  const totalFees = commission + processingFee;
  const netPayout = salePrice - totalFees - shippingPaidBySeller;
  return { commission, processingFee, totalFees, netPayout };
}

function fmt(n) {
  return n < 0
    ? `-$${Math.abs(n).toFixed(2)}`
    : `$${n.toFixed(2)}`;
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

export default function WhatnotCalculator() {
  const [mode, setMode] = useState("single"); // "single" | "lot"
  const [costPaid, setCostPaid] = useState("");
  const [quantity, setQuantity] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [shippingPaidBy, setShippingPaidBy] = useState("buyer");

  const [inboundShipping, setInboundShipping] = useState("");

  const cost = parseFloat(costPaid) || 0;
  const qty = mode === "lot" ? (parseInt(quantity) || 1) : 1;
  const sale = parseFloat(salePrice) || 0;
  const shipping = parseFloat(shippingCost) || 0;
  const inbound = parseFloat(inboundShipping) || 0;

  const sellerShipping = shippingPaidBy === "seller" ? shipping : 0;
  const totalCost = cost + inbound;
  const costPerUnit = mode === "lot" ? (qty > 0 ? totalCost / qty : 0) : totalCost;
  const { commission, processingFee, totalFees, netPayout } = calcFees(sale, sellerShipping);
  const profit = netPayout - costPerUnit;
  const roi = costPerUnit > 0 ? profit / costPerUnit : null;
  const hasResult = sale > 0 && (mode === "single" ? cost > 0 : cost > 0 && qty > 0);


  const profitColor = profit >= 0 ? "#22c55e" : "#ef4444";
  const profitBg = profit >= 0 ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";

  return (
    <div style={{
      minHeight: "auto",
      background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: "16px 16px 96px",
      color: "#f0eeff",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🎵</div>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "#f0abfc", fontWeight: 600, letterSpacing: 0.5 }}>
          Made just for you, Dahlia 💜
        </p>
        <h1 style={{
          margin: 0,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "-0.5px",
          background: "linear-gradient(90deg, #a78bfa, #f0abfc)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>Tonie Profit Calculator</h1>
        <p style={{ margin: "6px 0 0", color: "#a78bfa", fontSize: 13, opacity: 0.8 }}>
          for Whatnot sellers
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#c4b5fd", opacity: 0.6, fontStyle: "italic" }}>
          with love, Levy Yitschock 💕
        </p>
      </div>

      {/* Mode Toggle */}
      <div style={{
        display: "flex",
        background: "rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: 4,
        marginBottom: 24,
        gap: 4,
      }}>
        {["single", "lot"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 14,
              transition: "all 0.2s",
              background: mode === m
                ? "linear-gradient(135deg, #7c3aed, #a855f7)"
                : "transparent",
              color: mode === m ? "#fff" : "#a78bfa",
            }}
          >
            {m === "single" ? "🧸 Single Tonie" : "📦 Lot / Bundle"}
          </button>
        ))}
      </div>

      {/* Form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Cost Section */}
        <Card label={mode === "lot" ? "💰 Total Paid for Lot" : "💰 What You Paid"}>
          <InputRow
            prefix="$"
            value={costPaid}
            onChange={setCostPaid}
            placeholder={mode === "lot" ? "e.g. 45.00" : "e.g. 12.00"}
            type="number"
          />
        </Card>

        {mode === "lot" && (
          <Card label="🔢 Number of Tonies in Lot">
            <InputRow
              value={quantity}
              onChange={setQuantity}
              placeholder="e.g. 5"
              type="number"
              suffix="tonies"
            />
            {cost > 0 && qty > 0 && (
              <div style={{ marginTop: 8, color: "#c4b5fd", fontSize: 13 }}>
                = <strong>${(cost / qty).toFixed(2)}</strong> per Tonie
              </div>
            )}
          </Card>
        )}

        <Card label="🚚 Shipping You Paid to Buy">
          <InputRow
            prefix="$"
            value={inboundShipping}
            onChange={setInboundShipping}
            placeholder="e.g. 8.00 (optional)"
            type="number"
          />
          {mode === "lot" && inbound > 0 && qty > 0 && (
            <div style={{ marginTop: 8, color: "#c4b5fd", fontSize: 13 }}>
              = <strong>${(inbound / qty).toFixed(2)}</strong> per Tonie
            </div>
          )}
        </Card>

        <Card label="🏷️ Your Sale Price on Whatnot">
          <InputRow
            prefix="$"
            value={salePrice}
            onChange={setSalePrice}
            placeholder="e.g. 18.00"
            type="number"
          />
        </Card>

        {/* Shipping */}
        <Card label="📦 Shipping (optional)">
          <div style={{ display: "flex", gap: 8, marginBottom: shippingCost ? 10 : 0 }}>
            {["buyer", "seller"].map(who => (
              <button
                key={who}
                onClick={() => setShippingPaidBy(who)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: `1.5px solid ${shippingPaidBy === who ? "#a855f7" : "rgba(255,255,255,0.12)"}`,
                  background: shippingPaidBy === who ? "rgba(168,85,247,0.15)" : "transparent",
                  color: shippingPaidBy === who ? "#e9d5ff" : "#9ca3af",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {who === "buyer" ? "Buyer pays shipping" : "I pay shipping"}
              </button>
            ))}
          </div>
          {shippingPaidBy === "seller" && (
            <InputRow
              prefix="$"
              value={shippingCost}
              onChange={setShippingCost}
              placeholder="e.g. 5.50"
              type="number"
            />
          )}
          {shippingPaidBy === "buyer" && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
              Buyer-paid shipping still affects Whatnot's processing fee slightly, but won't reduce your payout.
            </p>
          )}
        </Card>
      </div>

      {/* Results */}
      {hasResult && (
        <div style={{ marginTop: 24 }}>
          {/* Big profit number */}
          <div style={{
            background: profitBg,
            border: `1.5px solid ${profitColor}40`,
            borderRadius: 16,
            padding: "20px 20px 16px",
            marginBottom: 16,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
              {profit >= 0 ? "🎉 Your Profit" : "⚠️ Your Loss"} per Tonie
            </div>
            <div style={{ fontSize: 42, fontWeight: 900, color: profitColor, letterSpacing: "-1px" }}>
              {fmt(profit)}
            </div>
            {roi !== null && (
              <div style={{ fontSize: 13, color: profitColor, opacity: 0.85, marginTop: 4 }}>
                {profit >= 0 ? `+${fmtPct(roi)} ROI` : `${fmtPct(roi)} ROI`}
              </div>
            )}
          </div>

          {/* Fee Breakdown */}
          <div style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.07)",
          }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
              Breakdown
            </div>
            {[
              { label: "Sale price", value: fmt(sale), neutral: true },
              { label: "Whatnot commission (8%)", value: `-${fmt(commission)}`, neg: true },
              { label: `Processing fee (2.9% + $0.30)`, value: `-${fmt(processingFee)}`, neg: true },
              shippingPaidBy === "seller" && shipping > 0
                ? { label: "Shipping you pay", value: `-${fmt(shipping)}`, neg: true }
                : null,
              { label: "Whatnot payout", value: fmt(netPayout), bold: true },
              { label: mode === "lot" ? "Your cost per Tonie" : "Your cost (item)", value: `-${fmt(mode === "lot" ? cost / qty : cost)}`, neg: true },
              inbound > 0
                ? { label: mode === "lot" ? "Inbound shipping per Tonie" : "Shipping you paid to buy", value: `-${fmt(mode === "lot" ? inbound / qty : inbound)}`, neg: true }
                : null,
            ].filter(Boolean).map((row, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "11px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                fontSize: 14,
              }}>
                <span style={{ color: "#d1d5db" }}>{row.label}</span>
                <span style={{
                  fontWeight: row.bold ? 700 : 500,
                  color: row.bold ? "#f0eeff" : row.neg ? "#f87171" : row.neutral ? "#c4b5fd" : "#f0eeff",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {row.value}
                </span>
              </div>
            ))}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "13px 16px",
              background: profitBg,
              fontSize: 15,
              fontWeight: 800,
            }}>
              <span style={{ color: "#e9d5ff" }}>Your profit</span>
              <span style={{ color: profitColor }}>{fmt(profit)}</span>
            </div>
          </div>

          {/* Min sell tip */}
          {cost > 0 && (
            <div style={{
              marginTop: 14,
              padding: "12px 16px",
              background: "rgba(124,58,237,0.1)",
              borderRadius: 12,
              border: "1px solid rgba(167,139,250,0.2)",
              fontSize: 13,
              color: "#c4b5fd",
              lineHeight: 1.5,
            }}>
              💡 <strong>Break-even price:</strong> You need to sell for at least{" "}
              <strong style={{ color: "#e9d5ff" }}>
                {fmt(calcBreakEven(costPerUnit, sellerShipping))}
              </strong>{" "}
              to cover fees{shippingPaidBy === "seller" && shipping > 0 ? " & shipping" : ""}.
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <p style={{ textAlign: "center", fontSize: 11, color: "#4b5563", marginTop: 32 }}>
        Based on Whatnot's 2026 fee structure: 8% commission + 2.9% + $0.30 processing
      </p>
    </div>
  );
}

function calcBreakEven(costPerUnit, sellerShipping) {
  // sale - sale*0.08 - sale*0.029 - 0.30 - sellerShipping = costPerUnit
  // sale*(1 - 0.08 - 0.029) = costPerUnit + 0.30 + sellerShipping
  return (costPerUnit + 0.30 + sellerShipping) / (1 - 0.08 - 0.029);
}

function Card({ label, children }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.05)",
      borderRadius: 14,
      padding: "14px 16px",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#a78bfa", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function InputRow({ prefix, suffix, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {prefix && <span style={{ color: "#6b7280", fontWeight: 700, fontSize: 16 }}>{prefix}</span>}
      <input
        type={type}
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.07)",
          border: "1.5px solid rgba(255,255,255,0.12)",
          borderRadius: 9,
          padding: "10px 12px",
          color: "#f0eeff",
          fontSize: 16,
          fontWeight: 600,
          outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={e => e.target.style.borderColor = "#a855f7"}
        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
      />
      {suffix && <span style={{ color: "#6b7280", fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}
