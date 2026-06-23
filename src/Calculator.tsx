import { useEffect, useState } from "react";

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

  const [foreignCurrency, setForeignCurrency] = useState("GBP");
  const [foreignPrice, setForeignPrice] = useState("");
  const [foreignShipping, setForeignShipping] = useState("");
  const [currencyRate, setCurrencyRate] = useState(null);
  const [rateDate, setRateDate] = useState("");
  const [currencyError, setCurrencyError] = useState("");
  const [currencyLoading, setCurrencyLoading] = useState(false);

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

  const foreignTotal = (parseFloat(foreignPrice) || 0) + (parseFloat(foreignShipping) || 0);
  const convertedUsd = currencyRate && foreignTotal > 0 ? foreignTotal * currencyRate : 0;

  useEffect(() => {
    let cancelled = false;

    async function loadRate() {
      setCurrencyLoading(true);
      setCurrencyError("");
      setCurrencyRate(null);

      try {
        const url = `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(foreignCurrency)}&to=USD`;
        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Rate request failed with status ${response.status}`);
        }

        const data = await response.json();
        const rate = Number(data?.rates?.USD);

        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error("USD rate not found in Frankfurter response");
        }

        if (!cancelled) {
          setCurrencyRate(rate);
          setRateDate(data?.date || "");
        }
      } catch (err) {
        console.error("Currency rate error:", err);

        if (!cancelled) {
          setCurrencyRate(null);
          setRateDate("");
          setCurrencyError("Live rate unavailable. Try again, or enter USD manually in the calculator.");
        }
      } finally {
        if (!cancelled) setCurrencyLoading(false);
      }
    }

    loadRate();

    return () => {
      cancelled = true;
    };
  }, [foreignCurrency]);

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
      {/* Currency Converter */}
      <div style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 16,
        marginBottom: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#f5d0fe" }}>🌍 Foreign Deal Converter</div>
            <div style={{ fontSize: 12, color: "#c4b5fd", opacity: 0.75, marginTop: 2 }}>Convert GBP/AUD/CAD into USD before using the profit calculator.</div>
          </div>
          <select
            value={foreignCurrency}
            onChange={e => setForeignCurrency(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "#f0eeff",
              border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "9px 10px",
              fontWeight: 800,
              outline: "none",
            }}
          >
            <option value="GBP">🇬🇧 GBP</option>
            <option value="AUD">🇦🇺 AUD</option>
            <option value="CAD">🇨🇦 CAD</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <Card label="Item Price">
            <InputRow
              prefix={foreignCurrency === "GBP" ? "£" : "$"}
              value={foreignPrice}
              onChange={setForeignPrice}
              placeholder="e.g. 28.00"
              type="number"
            />
          </Card>
          <Card label="Shipping">
            <InputRow
              prefix={foreignCurrency === "GBP" ? "£" : "$"}
              value={foreignShipping}
              onChange={setForeignShipping}
              placeholder="optional"
              type="number"
            />
          </Card>
        </div>

        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          background: "rgba(15,12,41,0.45)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {currencyLoading ? (
            <div style={{ color: "#c4b5fd", fontSize: 13 }}>Getting live exchange rate…</div>
          ) : currencyError ? (
            <div style={{ color: "#fca5a5", fontSize: 13 }}>{currencyError}</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span style={{ color: "#c4b5fd", fontSize: 13 }}>USD Total</span>
                <strong style={{ color: "#22c55e", fontSize: 24 }}>{fmt(convertedUsd)}</strong>
              </div>
              <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 4 }}>
                Rate used: 1 {foreignCurrency} = ${currencyRate ? currencyRate.toFixed(4) : "--"} USD{rateDate ? ` · Updated ${rateDate}` : ""}
              </div>
              <button
                disabled={!convertedUsd}
                onClick={() => setCostPaid(convertedUsd ? convertedUsd.toFixed(2) : "")}
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: "11px 12px",
                  border: "none",
                  borderRadius: 10,
                  cursor: convertedUsd ? "pointer" : "not-allowed",
                  background: convertedUsd ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontWeight: 800,
                  opacity: convertedUsd ? 1 : 0.5,
                }}
              >
                Use USD Total in Calculator
              </button>
            </>
          )}
        </div>
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
