/* ===================================================
   AIRTEL SCM PLATFORM — app.js  ( PO Analytics)
   
=================================================== */

"use strict";

// ── Sheet data stores ─────────────────────────────
let fullData = [];          // SCM / first sheet raw rows
let sheetData = {           // named sheet data
    PO_Orders: [],
    PO_Deliveries: [],
    Open_PO: [],
    Transit_Stock: [],
    Consumption: [],
    ASN_InTransit: [],
    Stock_Report: [],
    Monthly_Consumption: [],
    Stock_Open_PO_Transit: [],
    PO_Dump: [],
};

let metrics = null;         // cached single-pass result
let poMetrics = null;       // cached PO metrics
let charts = {};
const PAGE_SIZE = 50;

// Table pagination state
const tableState = {
    inventory: { page: 0, filtered: [] },
    vendor: { page: 0, filtered: [] },
    shipment: { page: 0, filtered: [] },
    openPo: { page: 0, filtered: [] },
};
// ── HTML escape utility ───────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Toast notifications (replaces all alert() calls) ─
(function () {
    const el = document.createElement("div");
    el.id = "toast-container";
    document.body.appendChild(el);
})();

function showToast(msg, type = "info", duration = 4000) {
    const container = document.getElementById("toast-container");
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.textContent = msg;
    container.appendChild(t);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => t.classList.add("toast-show"));
    });
    setTimeout(() => {
        t.classList.remove("toast-show");
        setTimeout(() => t.remove(), 300);
    }, duration);
}

// ── Theme toggle with localStorage persistence ────
document.getElementById("themeToggle").addEventListener("click", function () {
    const isDark = document.body.classList.toggle("dark");
    this.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
    localStorage.setItem("scmTheme", isDark ? "dark" : "light");
    applyChartTheme(isDark);
});

// Apply chart-wide text color based on dark/light mode
function applyChartTheme(isDark) {
    const textColor = isDark ? "#e2e8f0" : "#374151";
    const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    if (window.Chart) {
        Chart.defaults.color = textColor;
        Chart.defaults.borderColor = gridColor;
        // Re-render all active charts to pick up new colors
        Object.values(charts).forEach(c => { if (c) c.update(); });
    }
}

// Apply saved theme on load
(function () {
    const saved = localStorage.getItem("scmTheme");
    if (saved === "dark") {
        document.body.classList.add("dark");
        const btn = document.getElementById("themeToggle");
        if (btn) btn.textContent = "☀️ Light Mode";
        // Chart.js defaults must be set before charts are built
        if (window.Chart) {
            Chart.defaults.color = "#e2e8f0";
            Chart.defaults.borderColor = "rgba(255,255,255,0.08)";
        }
    }
})();
/* ==========================================
   Show Dashboard
========================================== */
function showDashboard() {

    const dashboard = document.getElementById("dashboard");

    if (dashboard) {
        dashboard.classList.remove("hidden");
        dashboard.style.display = "block";
    }

    const loading = document.getElementById("loadingSection");

    if (loading) {
        loading.classList.add("hidden");
    }

}

// ── Tab navigation ────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".tab-btn").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
        this.classList.add("active");
        this.setAttribute("aria-selected", "true");
        document.getElementById(this.dataset.tab).classList.remove("hidden");

        // Resize all Chart.js instances so canvases that were hidden (0×0) now fill correctly
        if (window.Chart) {
            Object.values(charts).forEach(c => { if (c) c.resize(); });
        }
    });
});

// ── Backend configuration ─────────────────────────
// Set BACKEND_URL to your deployed backend (e.g. https://airtel-scm-api.onrender.com)
// or leave as "" to run fully local (browser-side parsing only).
// The app auto-detects: if it can reach /api/health it switches to server mode.
const BACKEND_URL = (function() {
    // In production, same-origin backend is auto-detected
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        // Try same-origin backend first (Render/Railway hosting frontend+backend together)
        return window.location.origin;
    }
    return "http://localhost:4000";
})();

let _backendAvailable = false;
(async function detectBackend() {
    try {
        const r = await fetch(BACKEND_URL + "/api/health", { signal: AbortSignal.timeout(3000) });
        if (r.ok) { _backendAvailable = true; console.log("✅ Backend connected:", BACKEND_URL); }
    } catch { console.log("ℹ️ Backend not found — running client-side mode"); }
})();

// ── File name display on input change ────────────
document.getElementById("fileInput").addEventListener("change", function () {
    const display = document.getElementById("fileNameDisplay");
    const nameEl = document.getElementById("fileNameText");
    if (this.files.length && display && nameEl) {
        nameEl.textContent = this.files[0].name + "  (" + (this.files[0].size / 1024).toFixed(1) + " KB)";
        display.style.display = "block";
    } else if (display) {
        display.style.display = "none";
    }
});

// ── File upload ───────────────────────────────────
async function uploadFile() {
    const input = document.getElementById("fileInput");
    if (!input.files.length) { showToast("Please select a file.", "warn"); return; }
    const file = input.files[0];
    document.getElementById("loadingSection").classList.remove("hidden");
    document.getElementById("progressFill").style.width = "5%";
    setStatus("Processing " + file.name + "…");

    // Try backend if available and file is xlsx/csv (not pdf)
    const ext = file.name.split(".").pop().toLowerCase();
    if (_backendAvailable && (ext === "xlsx" || ext === "xls" || ext === "csv")) {
        try {
            document.getElementById("progressFill").style.width = "30%";
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(BACKEND_URL + "/api/upload", { method: "POST", body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Upload failed");
            document.getElementById("progressFill").style.width = "90%";
            // Render from server response
            renderFromBackend(data, file.name);
            return;
        } catch (err) {
            console.warn("Backend upload failed, falling back to client-side:", err.message);
        }
    }

    // Client-side fallback
    saveHistory(file.name);
    if (ext === "xlsx" || ext === "xls") readExcel(file);
    else if (ext === "csv") readCSV(file);
    else if (ext === "pdf") readPDF(file);
    else showToast("Unsupported file type. Use .xlsx, .csv or .pdf", "error");
}

// ── Render dashboard from backend response ────────
function renderFromBackend(data, fileName) {
    // Populate fullData for client-side export/table functions
    fullData = (data.tables && data.tables.scmData) || [];
    sheetData = {
        PO_Orders: (data.tables && data.tables.poOrders) || [],
        PO_Deliveries: (data.tables && data.tables.poDeliveries) || [],
        Open_PO: (data.tables && data.tables.openPO) || [],
        Transit_Stock: (data.tables && data.tables.transitStock) || [],
        Consumption: (data.tables && data.tables.consumption) || [],
        ASN_InTransit: (data.tables && data.tables.asnInTransit) || [],
        Stock_Report: (data.tables && data.tables.stockReport) || [],
        Monthly_Consumption: (data.tables && data.tables.monthlyConsumption) || [],
        Stock_Open_PO_Transit: (data.tables && data.tables.stockOpenPoTransit) || [],
        PO_Dump: (data.tables && data.tables.poDump) || [],
    };

    // Save history using backend response
    saveHistory(fileName);
    // Run the normal dashboard (uses fullData/sheetData)
    processData(fullData);
}

function setStatus(msg) {
    const el = document.getElementById("uploadStatus");
    if (el) el.textContent = msg;
}

// ══════════════════════════════════════════════════
// MULTI-SHEET EXCEL READER
// Reads ALL named sheets: PO_Orders, PO_Deliveries,
// Open_PO, Transit_Stock, Consumption + first sheet
// ══════════════════════════════════════════════════
// ── Smart sheet reader ────────────────────────────
// Scans up to 5 leading rows to skip any number of banner
// rows (rows with only 1 filled cell). Uses the first row
// with >1 filled cells as the header row.
// Handles: no banners, 1 banner (PO sheets), 2 banners (SCM_Data).
function readSheet(ws, defval) {
    if (!ws) return [];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) return [];

    // Walk down until we find a row with >1 filled cells (= real header)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(raw.length, 5); i++) {
        const filled = (raw[i] || []).filter(
            v => v !== "" && v !== null && v !== undefined
        ).length;
        if (filled > 1) { headerIdx = i; break; }
    }

    // No banners to skip — use the standard fast path
    if (headerIdx === 0) {
        return XLSX.utils.sheet_to_json(ws, { defval: defval ?? "" });
    }

    // Build objects from headerIdx row as keys, rows below as values
    const headers = (raw[headerIdx] || []).map(h => String(h ?? "").trim());
    return raw.slice(headerIdx + 1)
        .map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                obj[h] = (row[i] !== undefined && row[i] !== null)
                    ? row[i]
                    : (defval ?? "");
            });
            return obj;
        })
        .filter(obj =>
            Object.values(obj).some(v => v !== "" && v !== null && v !== undefined)
        );
}

// ── Fixed-header sheet reader ─────────────────────
// For sheets where auto-detection picks the wrong header row.
// headerRowIdx is 0-based index of the row to use as column headers.
function readSheetFixedHeader(ws, headerRowIdx) {
    if (!ws) return [];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (raw.length <= headerRowIdx) return [];
    const headers = (raw[headerRowIdx] || []).map(h => String(h ?? "").trim());
    return raw.slice(headerRowIdx + 1)
        .map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                obj[h] = (row[i] !== undefined && row[i] !== null) ? row[i] : "";
            });
            return obj;
        })
        .filter(obj => Object.values(obj).some(v => v !== "" && v !== null && v !== undefined));
}

function readExcel(file) {

    const reader = new FileReader();

    reader.onload = function (e) {

        try {

            const workbook = XLSX.read(
                new Uint8Array(e.target.result),
                { type: "array" }
            );

            // Reset optional sheet storage
            sheetData = {
                PO_Orders: [],
                PO_Deliveries: [],
                Open_PO: [],
                Transit_Stock: [],
                Consumption: [],
                ASN_InTransit: [],
                Stock_Report: [],
                Monthly_Consumption: [],
                Stock_Open_PO_Transit: [],
                PO_Dump: [],
            };

            // Read optional PO sheets if present — using smart reader
            Object.keys(sheetData).forEach(name => {
                // handle the sheet with a space in its name
                const xlName = name === "Stock_Open_PO_Transit" ? "Stock_Open PO_Transit" : name;
                if (workbook.SheetNames.includes(xlName)) {
                    if (name === "Stock_Open_PO_Transit") {
                        // This sheet has a sparse row-0 banner (only 3 filled cols) that
                        // confuses readSheet's header-detection. Force row 1 as the header.
                        sheetData[name] = readSheetFixedHeader(workbook.Sheets[xlName], 1);
                    } else if (name === "PO_Dump") {
                        // PO_Dump (Sheet1) has a plain header row — no banner — read directly
                        sheetData[name] = readSheetFixedHeader(workbook.Sheets[xlName], 0);
                    } else {
                        sheetData[name] = readSheet(workbook.Sheets[xlName], "");
                    }
                }
            });

            // Prefer SCM_Data sheet if available, else first sheet
            let sheetName = workbook.SheetNames.includes("SCM_Data")
                ? "SCM_Data"
                : workbook.SheetNames[0];

            fullData = readSheet(workbook.Sheets[sheetName], "");

            if (!fullData.length) {
                showToast("No records found in the uploaded Excel file.", "warn");
                return;
            }

            processData(fullData);

        }
        catch (err) {

            console.error(err);
            showToast("Error reading Excel file: " + err.message, "error");

        }

    };

    reader.readAsArrayBuffer(file);

}
// ── CSV reader ────────────────────────────────────
function readCSV(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: "array" });

            // Extract data from the first sheet using the same smart banner-row
            // detection that Excel uploads use, so CSVs with a title row are handled correctly.
            const sheetName = wb.SheetNames[0];
            fullData = readSheet(wb.Sheets[sheetName], "");

            // Initialize optional sheet structures to match Excel defaults
            sheetData = {
                PO_Orders: [],
                PO_Deliveries: [],
                Open_PO: [],
                Transit_Stock: [],
                Consumption: [],
                ASN_InTransit: [],
                Stock_Report: [],
                Monthly_Consumption: [],
                Stock_Open_PO_Transit: [],
                PO_Dump: [],
            };

            if (!fullData.length) {
                showToast("No records found in the CSV file.", "warn");
                document.getElementById("loadingSection").classList.add("hidden");
                return;
            }

            // Successfully process the structural data arrays and kick off dashboard updates
            processData(fullData);
        } catch (err) {
            console.error(err);
            showToast("Error reading CSV file: " + err.message, "error");
            document.getElementById("loadingSection").classList.add("hidden");
        }
    };
    reader.readAsArrayBuffer(file);
}
// ── PDF reader ────────────────────────────────────
function readPDF(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
            let text = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(item => item.str).join(" ") + "\n\n";
            }

            showDashboard();

            // Uses the globally available single escHtml template definition safely
            document.getElementById("summaryText").innerHTML =
                "<strong>PDF Content Extracted</strong><br><br>" +
                "<textarea style='width:100%;height:280px;padding:10px;border-radius:8px;" +
                "border:1px solid #ddd;font-size:13px;'>" + escHtml(text) + "</textarea>";

            setStatus("PDF extracted — " + pdf.numPages + " pages");
            document.getElementById("loadingSection").classList.add("hidden");
        } catch (err) {
            console.error(err);
            showToast("Could not read PDF: " + err.message, "error");
            document.getElementById("loadingSection").classList.add("hidden");
        }
    };
    reader.readAsArrayBuffer(file);
}

// ── Loading bar → runDashboard ────────────────────
function processData(data) {

    fullData = data;

    const loading = document.getElementById("loadingSection");
    const fill = document.getElementById("progressFill");

    loading.classList.remove("hidden");
    fill.style.width = "100%";

    // Small delay so the progress bar renders before heavy work begins
    setTimeout(() => {
        runDashboard();
    }, 100);
}

// ═══════════════════════════════════════════════════
// SINGLE-PASS METRICS
// ═══════════════════════════════════════════════════
function calcMetrics() {
    if (metrics) return metrics;

    let inventoryRisk = 0, pendingPO = 0, slaBreaches = 0, delayed = 0;
    let invValue = 0, totalDelayDays = 0;
    const invRows = [], vendorRows = [], shipRows = [];
    const vendors = new Set();
    const vendorDelayMap = {}, vendorSlaMap = {}, monthMap = {};
    let missingCells = 0;
    const seen = new Map(); let dupes = 0;
    const fieldMissing = {};

    fullData.forEach(row => {
        const stock = Number(row.CurrentStock) || 0;
        const safety = Number(row.SafetyStock) || 0;
        const pending = Number(row.PendingDays) || 0;
        const delay = Number(row.DelayDays) || 0;
        const sla = String(row.SLAStatus || "").trim().toLowerCase();

        const isInvRisk = safety > 0 && stock < safety;  // Guard: only flag when SafetyStock is set
        const isPending = pending > 14;
        const isSlaBreak = sla === "breached";
        const isDelayed = delay > 5;

        if (isInvRisk) { inventoryRisk++; invRows.push(row); }
        if (isPending) { pendingPO++; }
        if (isSlaBreak) { slaBreaches++; vendorRows.push(row); }
        if (isDelayed) { delayed++; shipRows.push(row); }

        if (row.Vendor) vendors.add(row.Vendor);
        invValue += stock * (Number(row.UnitPrice) || 0);
        totalDelayDays += delay;

        const vName = row.Vendor || "Unknown";
        vendorDelayMap[vName] = (vendorDelayMap[vName] || 0) + delay;
        if (!vendorSlaMap[vName]) vendorSlaMap[vName] = 0;
        if (isSlaBreak) vendorSlaMap[vName]++;

        const mo = row.Month || "N/A";
        monthMap[mo] = (monthMap[mo] || 0) + delay;

        const rowKey = Object.values(row).join("|");
        if (seen.has(rowKey)) dupes++;
        else seen.set(rowKey, true);

        Object.keys(row).forEach(k => {
            const v = row[k];
            if (v === "" || v === null || v === undefined) {
                missingCells++;
                fieldMissing[k] = (fieldMissing[k] || 0) + 1;
            }
        });
    });

    const n = fullData.length || 1;
    const totalCells = n * (fullData[0] ? Object.keys(fullData[0]).length : 1);

    const shortages = invRows
        .map(r => ({ ...r, gap: (Number(r.SafetyStock) || 0) - (Number(r.CurrentStock) || 0) }))
        .sort((a, b) => b.gap - a.gap);

    metrics = {
        total: fullData.length,
        inventoryRisk, pendingPO, slaBreaches, delayed,
        invRows, vendorRows, shipRows,
        vendors, invValue, totalDelayDays,
        vendorDelayMap, vendorSlaMap, monthMap,
        shortages,
        missingCells, dupes, totalCells, fieldMissing,
        completeness: Math.round(((totalCells - missingCells) / totalCells) * 100),
    };
    return metrics;
}

// ═══════════════════════════════════════════════════
// PO ANALYTICS METRICS — reads from sheetData
// Falls back to fullData columns if sheets absent
// ═══════════════════════════════════════════════════
function calcPoMetrics() {
    if (poMetrics) return poMetrics;

    // ── PO Orders ────────────────────────────────
    const orders = sheetData.PO_Orders.length
        ? sheetData.PO_Orders
        : fullData.filter(r => r.PONumber || r.PO_Number || r.POValue || r.OrderValue);

    let totalOrders = orders.length;
    let totalPoValue = 0, totalQtyOrdered = 0;
    const supplierValueMap = {}, categoryMap = {}, monthlyPoMap = {};
    let topSupplier = "—";

    orders.forEach(r => {
        const val = Number(r.POValue || r.PO_Value || r.OrderValue || 0);
        const qty = Number(r.OrderedQty || r.Quantity || r.Qty || 0);
        const supplier = r.Supplier || r.Vendor || r.SupplierName || "Unknown";
        const category = r.Category || r.Material_Group || r.ItemCategory || "General";
        const month = r.Month || r.OrderMonth || r.CreatedMonth || "N/A";

        totalPoValue += val;
        totalQtyOrdered += qty;
        supplierValueMap[supplier] = (supplierValueMap[supplier] || 0) + val;
        categoryMap[category] = (categoryMap[category] || 0) + 1;
        monthlyPoMap[month] = (monthlyPoMap[month] || 0) + 1;
    });

    const sortedSuppliers = Object.entries(supplierValueMap).sort((a, b) => b[1] - a[1]);
    topSupplier = sortedSuppliers.length ? sortedSuppliers[0][0] : "—";

    // ── PO Deliveries ─────────────────────────────
    const deliveries = sheetData.PO_Deliveries.length
        ? sheetData.PO_Deliveries
        : fullData.filter(r => r.DeliveryStatus || r.ActualDeliveryDate || r.DeliveryDays);

    let delDelivered = 0, delPartial = 0, delLate = 0, delOnTime = 0, delDaysTotal = 0;
    const delMonthMap = {};

    deliveries.forEach(r => {
        const status = String(r.DeliveryStatus || r.Status || "").toLowerCase();
        const days = Number(r.DeliveryDays || r.LeadTime || r.ActualDays || 0);
        const month = r.Month || r.DeliveryMonth || "N/A";

        // Mutually exclusive, exhaustive bucketing — priority order matters:
        // partial → late/delayed → on time → delivered → other (counted in delivered as catch-all)
        if (status.includes("partial")) {
            delPartial++;
        } else if (status.includes("late") || status.includes("delayed")) {
            delLate++;
        } else if (status.includes("on time") || status.includes("ontime")) {
            delOnTime++;
            delDelivered++; // on-time is also a delivered state
        } else if (status.includes("delivered")) {
            delDelivered++;
        }
        // rows that match none (e.g. "In Transit") are intentionally not counted in any bucket
        // so chart totals reflect only rows with a resolved delivery status
        delDaysTotal += days;
        delMonthMap[month] = (delMonthMap[month] || 0) + 1;
    });
    const avgDeliveryDays = deliveries.length ? (delDaysTotal / deliveries.length).toFixed(1) : "—";

    // if no explicit on-time / late from status, derive from SLA
    if (delOnTime === 0 && delLate === 0 && deliveries.length) {
        deliveries.forEach(r => {
            const sla = String(r.SLAStatus || r.SLA || "").toLowerCase();
            if (sla === "breached") delLate++;
            else delOnTime++;
        });
    }

    // ── Open PO ───────────────────────────────────
    const openPoRows = sheetData.Open_PO.length
        ? sheetData.Open_PO
        : fullData.filter(r => {
            const s = String(r.POStatus || r.Status || "").toLowerCase();
            return s === "open" || s === "pending";
        });

    let openPoValue = 0, openAgingTotal = 0, overdueCount = 0;
    const today = new Date();

    openPoRows.forEach(r => {
        const val = Number(r.POValue || r.PO_Value || r.OpenValue || r.OrderValue || r.Value || 0);
        const age = Number(r.Age || r.Age_Days || r.AgingDays || r.PendingDays || 0);
        const expDate = r.ExpectedDate || r.DueDate || r.PromisedDate || "";
        const status = String(r.POStatus || r.Status || "").toLowerCase();
        openPoValue += val;
        openAgingTotal += age;

        // A PO is overdue if ANY of the following are true (non-double-counting via early flag):
        //   1. OverdueFlag column is explicitly "Yes"
        //   2. Status field is "Overdue"
        //   3. ExpectedDate / DueDate has passed (date-comparison is equally primary, not a fallback)
        // Previously the date check was only reached when flags 1 & 2 were both absent,
        // meaning a PO with a future OverdueFlag="No" but an expired date would be missed.
        const overdueFlag = String(r.OverdueFlag || "").trim().toLowerCase();
        const dateExpired = expDate
            ? (() => { const d = new Date(expDate); return !isNaN(d) && d < today; })()
            : false;
        const isOverdue = overdueFlag === "yes" || status === "overdue" || dateExpired;
        if (isOverdue) overdueCount++;
    });

    const avgAging = openPoRows.length ? (openAgingTotal / openPoRows.length).toFixed(1) : 0;

    // ── Transit Stock ─────────────────────────────
    const transit = sheetData.Transit_Stock.length
        ? sheetData.Transit_Stock
        : fullData.filter(r => r.TransitQty || r.InTransit || r.TransitStatus);

    let trQtyTotal = 0, trValueTotal = 0, trTimeTotal = 0, trDelayed = 0;
    const trSupplierMap = {}, trMaterialMap = {}, trTimelineMap = {};

    transit.forEach(r => {
        const qty = Number(r.TransitQty || r.Quantity || r.Qty || r.TransitQuantity || 0);
        const val = Number(r.TransitValue || r.TotalValue || r.Value || r.Amount || 0);
        const time = Number(r.TransitDays || r.TransitTime || r.TransitTime || r.Days || 0);
        const supplier = r.Supplier || r.Vendor || "Unknown";
        const material = r.Material || r.Item || "Unknown";
        const month = r.Month || r.ShipMonth || "N/A";

        trQtyTotal += qty;
        trValueTotal += val;
        trTimeTotal += time;

        const status = String(r.Status || r.TransitStatus || "").toLowerCase();
        // Count as delayed if status explicitly says so, OR if transit has been in-flight >20 days
        const TRANSIT_DELAY_THRESHOLD = 20; // days — flag long-running shipments even with neutral status
        if (status.includes("delay") || status.includes("overdue") || (time > TRANSIT_DELAY_THRESHOLD && time > 0)) trDelayed++;

        trSupplierMap[supplier] = (trSupplierMap[supplier] || 0) + val;
        trMaterialMap[material] = (trMaterialMap[material] || 0) + qty;
        trTimelineMap[month] = (trTimelineMap[month] || 0) + qty;
    });

    const avgTransitTime = transit.length ? (trTimeTotal / transit.length).toFixed(1) : "—";

    // ── Consumption ───────────────────────────────
    const consumption = sheetData.Consumption.length
        ? sheetData.Consumption
        : fullData.filter(r => r.DailyConsumption || r.MonthlyConsumption || r.Consumption);

    let totalCurrentStock = 0, totalDailyConsumption = 0, totalMonthlyConsumption = 0;
    let stockoutRiskCount = 0;

    consumption.forEach(r => {
        const stock = Number(r.CurrentStock || r.Stock || 0);
        const daily = Number(r.DailyConsumption || r.AvgDailyConsumption || 0);
        const monthly = Number(r.MonthlyConsumption || r.AvgMonthlyConsumption || 0);
        totalCurrentStock += stock;
        totalDailyConsumption += daily;
        totalMonthlyConsumption += monthly;

        const doc = daily > 0 ? stock / daily : 9999;
        // Zero-consumption items are counted separately as potential dead stock,
        // not as stockout risk, to avoid conflating "no consumption data" with "safe".
        if (daily === 0 && stock > 0) {
            // No action — tracked via deadStockCount if needed in future
        } else if (doc < 15) {
            stockoutRiskCount++;
        }
    });

    // Fallback: derive from fullData if no consumption sheet
    if (!consumption.length && fullData.length) {
        fullData.forEach(r => {
            totalCurrentStock += Number(r.CurrentStock || 0);
        });
    }

    const avgDailyConsumption = consumption.length ? (totalDailyConsumption / consumption.length).toFixed(1) : "—";
    const avgMonthlyConsumption = consumption.length ? (totalMonthlyConsumption / consumption.length).toFixed(1) : "—";
    const daysOfCover = (totalDailyConsumption > 0)
        ? Math.round(totalCurrentStock / totalDailyConsumption)
        : null;

    // ── Fulfillment rate ──────────────────────────
    // Join deliveries to orders on PONumber so the ratio reflects real fulfillment,
    // not just two independent row counts divided into each other (Finding 4 fix).
    let fulfilledOrders = 0;
    const canJoinOnPO = orders.length && deliveries.length &&
        (orders[0] && (orders[0].PONumber || orders[0].PO_Number)) &&
        (deliveries[0] && (deliveries[0].PONumber || deliveries[0].PO_Number));
    if (canJoinOnPO) {
        const deliveredPoNums = new Set(
            deliveries
                .filter(r => {
                    const s = String(r.DeliveryStatus || r.Status || "").toLowerCase();
                    return s.includes("delivered") || s.includes("on time") || s.includes("ontime");
                })
                .map(r => String(r.PONumber || r.PO_Number || "").trim())
                .filter(Boolean)
        );
        orders.forEach(r => {
            const poNum = String(r.PONumber || r.PO_Number || "").trim();
            if (poNum && deliveredPoNums.has(poNum)) fulfilledOrders++;
        });
    } else {
        // No PONumber column available — fall back to row-count ratio
        fulfilledOrders = delDelivered;
    }
    const fulfillmentRate = totalOrders ? Math.round((fulfilledOrders / totalOrders) * 100) : 0;
    const fulfillmentIsJoined = canJoinOnPO; // exposed for UI tooltip

    // ── In Transit PO count ───────────────────────
    const inTransitCount = transit.length || deliveries.filter(r =>
        String(r.DeliveryStatus || r.Status || "").toLowerCase().includes("transit")
    ).length;

    poMetrics = {
        // Orders
        totalOrders, totalPoValue, totalQtyOrdered, topSupplier,
        supplierValueMap, categoryMap, monthlyPoMap,
        // Deliveries
        delDelivered, delPartial, delLate, delOnTime, avgDeliveryDays, delMonthMap,
        fulfillmentRate, fulfillmentIsJoined, inTransitCount,
        // Open PO
        openPoRows, openPoCount: openPoRows.length, openPoValue, avgAging, overdueCount,
        // Transit
        transit, trQtyTotal, trValueTotal, avgTransitTime, trDelayed,
        trSupplierMap, trMaterialMap, trTimelineMap,
        // Consumption
        totalCurrentStock, avgDailyConsumption, avgMonthlyConsumption,
        daysOfCover, stockoutRiskCount,
    };
    return poMetrics;
}

// ── Main orchestrator ─────────────────────────────
function runDashboard() {

    showDashboard();

    metrics = null;
    poMetrics = null;

    // Calculate metrics
    const m = calcMetrics();
    const pm = calcPoMetrics();

    // Update KPI cards
    updateKPIs(m);

    // Build dashboard sections
    buildExecutiveSummary(m);
    calcHealth(m);
    buildInsights(m);
    buildAlerts(m);
    buildRecommendations(m);
    dataQuality(m);
    topRisks(m);

    // Initialize tables first
    initTables(m);

    // Purchase Order Analytics
    buildPoAnalytics(pm);

    // SCM Insights (new sheets)
    buildScmInsights();

    // Footer information
    document.getElementById("lastRefresh").textContent =
        new Date().toLocaleString();

    setStatus(
        "Loaded " + fullData.length.toLocaleString() + " records"
    );

    document.getElementById("fileInput").value = "";

    // Render heavy visualizations after the UI is displayed
    requestAnimationFrame(() => {

        buildCharts(m);

        if (_googleChartsReady && window.google && google.visualization && google.visualization.GeoChart) {
            buildRegionMap();
        } else if (window.google) {
            // Charts package still loading — wait for it
            google.charts.setOnLoadCallback(() => {
                if (google.visualization && google.visualization.GeoChart) buildRegionMap();
            });
        }

    });

}
// ── KPI cards ─────────────────────────────────────
function updateKPIs(m) {
    setText("totalRecords", m.total);
    setText("inventoryRisk", m.inventoryRisk);
    setText("pendingPO", m.pendingPO);
    setText("slaBreaches", m.slaBreaches);
    setText("delayedShipments", m.delayed);
    setText("vendorCount", m.vendors.size);
    setText("inventoryValue", formatCurrency(m.invValue));
    const riskCount = m.inventoryRisk + m.pendingPO + m.slaBreaches + m.delayed;
    const invAtRiskVal = m.invRows.reduce((s, r) =>
        s + (Number(r.CurrentStock) || 0) * (Number(r.UnitPrice) || 0), 0);
    const noteEl = document.getElementById("invValueNote");
    if (noteEl) noteEl.textContent = "At-risk: " + formatCurrency(invAtRiskVal);
    const avg = m.total ? (m.totalDelayDays / m.total).toFixed(1) : 0;
    setText("avgDelayDays", avg);
    // SCM Efficiency uses the same weighted formula as the Health Score gauge
    // so both headline numbers always agree and are computed in one place.
    const eff = calcHealthScore(m);
    setText("efficiencyScore", eff + "%");
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── Currency formatter ────────────────────────────
function formatCurrency(value) {
    if (value >= 1e7) return "₹" + (value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " Cr";
    if (value >= 1e5) return "₹" + (value / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " L";
    return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/* ==========================================
   Executive Summary
========================================== */
function buildExecutiveSummary(m) {

    // Derive risk level from the single shared health score formula
    const healthScore = calcHealthScore(m);

    const level =
        healthScore < 40 ? "🔴 Critical" :
            healthScore < 60 ? "🟠 High Risk" :
                healthScore < 80 ? "🟡 Monitor" :
                    "🟢 Low";

    const efficiency =
        document.getElementById("efficiencyScore")
            ? document.getElementById("efficiencyScore").textContent
            : "N/A";

    const riskColor = healthScore < 40 ? "#dc2626" : healthScore < 60 ? "#f97316" : healthScore < 80 ? "#eab308" : "#22c55e";
    document.getElementById("summaryText").innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:14px 18px;background:linear-gradient(135deg,#fff5f5,#ffe4e6);border-radius:10px;border-left:5px solid var(--primary);">
            <div style="font-size:36px;font-weight:800;color:${riskColor};line-height:1;">${healthScore}</div>
            <div>
                <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Overall SCM Health Score</div>
                <div style="font-size:17px;font-weight:700;color:${riskColor};margin-top:2px;">${level}</div>
            </div>
            <div style="margin-left:auto;font-size:12px;color:var(--muted);text-align:right;">SCM Efficiency<br><strong style="font-size:18px;color:var(--secondary);">${efficiency}</strong></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div style="padding:12px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border);">
                <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">📊 Data Overview</div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:14px;">
                    <div style="display:flex;justify-content:space-between;"><span>Total Records</span><strong>${m.total.toLocaleString()}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Unique Vendors</span><strong>${m.vendors.size}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Inventory Value</span><strong style="color:var(--info)">${formatCurrency(m.invValue)}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Avg Delay</span><strong>${(m.totalDelayDays / Math.max(m.total, 1)).toFixed(1)} days</strong></div>
                </div>
            </div>
            <div style="padding:12px 16px;background:#fff5f5;border-radius:10px;border:1px solid #fecaca;">
                <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">⚠️ Risk Indicators</div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:14px;">
                    <div style="display:flex;justify-content:space-between;"><span>Inventory Risks</span><strong style="color:${m.inventoryRisk>0?'#dc2626':'#22c55e'}">${m.inventoryRisk}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Pending POs</span><strong style="color:${m.pendingPO>0?'#f59e0b':'#22c55e'}">${m.pendingPO}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>SLA Breaches</span><strong style="color:${m.slaBreaches>0?'#dc2626':'#22c55e'}">${m.slaBreaches}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Delayed Shipments</span><strong style="color:${m.delayed>0?'#f59e0b':'#22c55e'}">${m.delayed}</strong></div>
                </div>
            </div>
        </div>
    `;
}

// ── Shared health-score formula ───────────────────
// Single source of truth used by the gauge, the KPI card, and executive summary.
function calcHealthScore(m) {
    if (!m.total) return 100;
    const iPct = (m.inventoryRisk / m.total) * 100;
    const pPct = (m.pendingPO   / m.total) * 100;
    const sPct = (m.slaBreaches / m.total) * 100;
    const dPct = (m.delayed     / m.total) * 100;
    return Math.max(0, Math.round(100 - (iPct * 0.25 + pPct * 0.20 + sPct * 0.25 + dPct * 0.30)));
}

// ── Health Score ──────────────────────────────────
function calcHealth(m) {
    if (!m.total) return;
    const score = calcHealthScore(m);

    // Re-derive per-category percentages needed for sub-scores
    const iPct = (m.inventoryRisk / m.total) * 100;
    const pPct = (m.pendingPO     / m.total) * 100;
    const sPct = (m.slaBreaches   / m.total) * 100;
    const dPct = (m.delayed       / m.total) * 100;

    const gauge = document.getElementById("gauge");
    gauge.querySelector("span").textContent = score;

    let color = "#22c55e", level = "🟢 Healthy";
    if (score < 40) { color = "#dc2626"; level = "🔴 Critical"; }
    else if (score < 60) { color = "#f97316"; level = "🟠 High Risk"; }
    else if (score < 80) { color = "#eab308"; level = "🟡 Monitor"; }

    gauge.style.background =
        `conic-gradient(${color} 0deg, ${color} ${score * 3.6}deg, #e5e7eb ${score * 3.6}deg)`;
    gauge.style.setProperty("--score", score);
    document.getElementById("riskLevel").innerHTML =
        `${level} <small style="font-weight:400;font-size:14px;">(${score}/100)</small>`;

    const hScores = {
        inv: Math.max(0, Math.round(100 - iPct * 0.6)),
        proc: Math.max(0, Math.round(100 - pPct * 0.6)),
        vend: Math.max(0, Math.round(100 - sPct * 0.6)),
        log: Math.max(0, Math.round(100 - dPct * 0.6)),
    };
    setText("inventoryHealth", hScores.inv);
    setText("procurementHealth", hScores.proc);
    setText("vendorHealth", hScores.vend);
    setText("logisticsHealth", hScores.log);

    const colourBox = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove("hbox-good", "hbox-warn", "hbox-bad");
        if (val >= 80) el.classList.add("hbox-good");
        else if (val >= 60) el.classList.add("hbox-warn");
        else el.classList.add("hbox-bad");
    };
    colourBox("hbox-inv", hScores.inv);
    colourBox("hbox-proc", hScores.proc);
    colourBox("hbox-vend", hScores.vend);
    colourBox("hbox-log", hScores.log);
}

// ── Insights ──────────────────────────────────────
function buildInsights(m) {
    const list = [];
    if (m.inventoryRisk > 0) list.push(`[STOCK] <strong>${m.inventoryRisk}</strong> materials below safety stock — immediate replenishment required.`);
    if (m.pendingPO > 0) list.push(`[PO] <strong>${m.pendingPO}</strong> purchase orders pending >14 days — procurement review needed.`);
    if (m.delayed > 0) list.push(`[DELAY] <strong>${m.delayed}</strong> shipments delayed beyond 5 days — logistics performance impacted.`);
    if (m.slaBreaches > 0) list.push(`[SLA] <strong>${m.slaBreaches}</strong> vendor SLA breaches — vendor review required.`);
    if (!list.length) list.push("[OK] Supply chain is operating within acceptable parameters.");
    document.getElementById("aiInsights").innerHTML = "<ul><li>" + list.join("</li><li>") + "</li></ul>";
}

// ── Smart Alerts ──────────────────────────────────
function buildAlerts(m) {
    const el = document.getElementById("alertsContainer");
    const html = [];
    const MAX = 40;

    for (const row of fullData) {
        if (html.length >= MAX) break;
        const stock = Number(row.CurrentStock) || 0;
        const safety = Number(row.SafetyStock) || 0;
        const delay = Number(row.DelayDays) || 0;
        const sla = String(row.SLAStatus || "").trim().toLowerCase();
        const item = row.Material || row.ItemDescription || row.ItemCode || row.Item || "Unknown";
        const vendor = row.Vendor || row.Supplier || "Unknown";

        if (stock < safety && html.length < MAX) {
            html.push(`<div class="alert alert-critical">[STOCK] <strong>${escHtml(item)}</strong> — Stock: ${stock}, Safety: ${safety} (short by ${safety - stock})</div>`);
        }
        if (sla === "breached" && html.length < MAX) {
            html.push(`<div class="alert alert-warning">[SLA] Breach: <strong>${escHtml(vendor)}</strong> — ${escHtml(item)}</div>`);
        }
        if (delay > 5 && html.length < MAX) {
            html.push(`<div class="alert alert-info">[DELAY] <strong>${delay} days</strong> — ${escHtml(item)} (${escHtml(vendor)})</div>`);
        }
    }

    el.innerHTML = html.length
        ? html.join("")
        : `<div class="alert alert-info">[OK] No active alerts</div>`;
}

// ── Recommendations ───────────────────────────────
function buildRecommendations(m) {
    const el = document.getElementById("replenishmentContainer");
    const html = m.shortages.slice(0, 40).map(row => {
        const item = row.Material || row.ItemDescription || row.ItemCode || row.Item || "Unknown";
        return `<div class="recommendation">[REPLENISH] <strong>${escHtml(item)}</strong> — order <strong>${row.gap.toLocaleString()}</strong> units (Current: ${Number(row.CurrentStock).toLocaleString()}, Safety: ${Number(row.SafetyStock).toLocaleString()})</div>`;
    });
    el.innerHTML = html.length
        ? html.join("")
        : `<div class="recommendation">[OK] No replenishment actions required.</div>`;
}

// ── Data Quality ──────────────────────────────────
function dataQuality(m) {
    const compEl = document.getElementById("dqCompleteness");
    const dupEl = document.getElementById("dqDupes");
    const misEl = document.getElementById("dqMissing");
    if (compEl) {
        const val = compEl.querySelector(".dq-val");
        if (val) {
            val.textContent = m.completeness + "%";
            val.style.color = m.completeness >= 95 ? "var(--success)"
                : m.completeness >= 80 ? "var(--warning)"
                    : "var(--danger)";
        }
    }
    if (dupEl) { const v = dupEl.querySelector(".dq-val"); if (v) { v.textContent = m.dupes; v.style.color = m.dupes === 0 ? "var(--success)" : "var(--warning)"; } }
    if (misEl) { const v = misEl.querySelector(".dq-val"); if (v) { v.textContent = m.missingCells.toLocaleString(); v.style.color = m.missingCells === 0 ? "var(--success)" : "var(--danger)"; } }

    if (!fullData.length) return;
    const allFields = Object.keys(fullData[0]);
    const total = fullData.length;

    const critEl = document.getElementById("criticalFields");
    if (!critEl) return;
    const CRITICAL_FIELDS = ["Material", "Vendor", "CurrentStock", "SafetyStock", "SLAStatus", "DelayDays", "Region"];
    const critPcts = CRITICAL_FIELDS.map(f => {
        const missing = m.fieldMissing[f] || 0;
        return allFields.includes(f) ? Math.round(((total - missing) / total) * 100) : 0;
    });
    critEl.innerHTML = CRITICAL_FIELDS.map((f, idx) => {
        const pct = allFields.includes(f)
            ? critPcts[idx]
            : null;
        const status = pct === null ? "absent" : pct === 100 ? "ok" : pct >= 90 ? "warn" : "bad";
        const icons = { ok: "✅", warn: "⚠️", bad: "❌", absent: "🔴" };
        const labels = { ok: "Complete", warn: pct + "% complete", bad: pct + "% — needs attention", absent: "Column absent" };
        return `<div class="crit-row"><span class="crit-icon">${icons[status]}</span><span class="crit-field">${escHtml(f)}</span><span class="crit-status crit-${status}">${labels[status]}</span></div>`;
    }).join("");

    // Radar chart for critical field quality
    destroyChart("fieldRadar");
    const radarCtx = document.getElementById("fieldRadarChart");
    if (radarCtx) {
        charts.fieldRadar = new Chart(radarCtx, {
            type: "radar",
            data: {
                labels: CRITICAL_FIELDS,
                datasets: [{
                    label: "Field Completeness %",
                    data: critPcts,
                    backgroundColor: "rgba(228,0,70,0.15)",
                    borderColor: "#E40046",
                    borderWidth: 2,
                    pointBackgroundColor: critPcts.map(p => p === 100 ? "#22c55e" : p >= 90 ? "#f59e0b" : "#dc2626"),
                    pointRadius: 5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0, max: 100,
                        ticks: { stepSize: 25, font: { size: 10 } },
                        pointLabels: { font: { size: 11, weight: "600" } },
                        grid: { color: "rgba(0,0,0,0.08)" },
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

// ── Top Risks ─────────────────────────────────────
function topRisks(m) {
    const list = document.getElementById("topRisks");
    const risks = [];
    for (const row of fullData) {
        const stock = Number(row.CurrentStock) || 0;
        const safety = Number(row.SafetyStock) || 0;
        const delay = Number(row.DelayDays) || 0;
        const sla = String(row.SLAStatus || "").trim().toLowerCase();
        const itemLabel = row.Material || row.ItemDescription || row.ItemCode || row.Item || "Unknown";
        const vendorLabel = row.Vendor || row.Supplier || "Unknown";
        if (stock < safety) risks.push(`Inventory Risk — ${escHtml(itemLabel)} (short by ${safety - stock})`);
        if (sla === "breached") risks.push(`SLA Breach — ${escHtml(vendorLabel)}`);
        if (delay > 5) risks.push(`Shipment Delay — ${delay} days (${escHtml(itemLabel)})`);
        if (risks.length >= 10) break;
    }
    list.innerHTML = risks.length === 0
        ? "<li>No risks detected</li>"
        : risks.slice(0, 10).map(r => `<li>${r}</li>`).join("");
}

// ── Charts ────────────────────────────────────────
const COLORS = ["#E40046", "#2563eb", "#f59e0b", "#22c55e", "#dc2626", "#8b5cf6", "#06b6d4", "#f97316"];
// Supports both "Jan" and "Jan-25" / "Jan-2025" style month labels
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_ORDER = MONTH_NAMES.flatMap(m => [
    m,
    ...Array.from({ length: 30 }, (_, i) => `${m}-${String(i + 2000).slice(2)}`),
    ...Array.from({ length: 30 }, (_, i) => `${m}-${i + 2000}`)
]);

function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

function buildCharts(m) {
    destroyChart("risk");
    charts.risk = new Chart(document.getElementById("riskChart"), {
        type: "bar",
        data: {
            labels: ["Inventory Risk", "Pending POs", "SLA Breaches", "Delayed Shipments"],
            datasets: [{ label: "Count", data: [m.inventoryRisk, m.pendingPO, m.slaBreaches, m.delayed], backgroundColor: COLORS, borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    destroyChart("pie");
    charts.pie = new Chart(document.getElementById("riskPieChart"), {
        type: "doughnut",
        data: {
            labels: ["Inventory Risk", "Pending POs", "SLA Breaches", "Delayed"],
            datasets: [{ data: [m.inventoryRisk, m.pendingPO, m.slaBreaches, m.delayed], backgroundColor: COLORS, borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });

    const vKeys = Object.keys(m.vendorDelayMap).slice(0, 12);
    destroyChart("vendor");
    charts.vendor = new Chart(document.getElementById("vendorChart"), {
        type: "bar",
        data: { labels: vKeys, datasets: [{ label: "Total Delay Days", data: vKeys.map(k => m.vendorDelayMap[k]), backgroundColor: "#E40046", borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    const short12 = m.shortages.slice(0, 12);
    destroyChart("inv");
    charts.inv = new Chart(document.getElementById("inventoryChart"), {
        type: "bar",
        data: { labels: short12.map(s => s.ItemName || s.Material || s.Item || "Unknown"), datasets: [{ label: "Shortage Qty", data: short12.map(s => s.gap), backgroundColor: "#dc2626", borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    const sortedMonths = Object.keys(m.monthMap).sort((a, b) => {
        const ai = MONTH_ORDER.indexOf(a), bi = MONTH_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    destroyChart("ship");
    charts.ship = new Chart(document.getElementById("shipmentTrendChart"), {
        type: "line",
        data: {
            labels: sortedMonths,
            datasets: [{ label: "Total Delay Days", data: sortedMonths.map(k => m.monthMap[k]), fill: true, borderColor: "#E40046", backgroundColor: "rgba(228,0,70,0.1)", tension: 0.4, pointBackgroundColor: "#E40046", pointRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });

    const slaKeys = Object.keys(m.vendorSlaMap).slice(0, 12);
    destroyChart("sla");
    charts.sla = new Chart(document.getElementById("vendorSlaChart"), {
        type: "bar",
        data: { labels: slaKeys, datasets: [{ label: "SLA Breaches", data: slaKeys.map(k => m.vendorSlaMap[k]), backgroundColor: "#f59e0b", borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

// ═══════════════════════════════════════════════════
// PO ANALYTICS — full build
// ═══════════════════════════════════════════════════
function buildPoAnalytics(pm) {
    // 1. Summary KPIs
    setText("po-totalOrders", pm.totalOrders || "—");
    setText("po-totalValue", pm.totalPoValue ? formatCurrency(pm.totalPoValue) : "—");
    setText("po-openCount", pm.openPoCount || "—");
    setText("po-openValue", pm.openPoValue ? formatCurrency(pm.openPoValue) : "—");
    setText("po-deliveredCount", pm.delDelivered || "—");
    setText("po-inTransit", pm.inTransitCount || "—");
    setText("po-avgDelivery", pm.avgDeliveryDays !== "—" ? pm.avgDeliveryDays + " days" : "—");
    setText("po-fulfillment", pm.totalOrders ? pm.fulfillmentRate + "%" : "—");
    // Show a note if the fulfillment % couldn't be joined on PONumber
    const fulfillNoteEl = document.getElementById("po-fulfillment-note");
    if (fulfillNoteEl) {
        if (!pm.fulfillmentIsJoined && pm.totalOrders) {
            fulfillNoteEl.textContent = "⚠️ Estimated — no PONumber join";
            fulfillNoteEl.style.display = "block";
        } else {
            fulfillNoteEl.style.display = "none";
        }
    }

    // 2. Order Analysis
    setText("po-created", pm.totalOrders || "—");
    setText("po-totalQty", pm.totalQtyOrdered ? pm.totalQtyOrdered.toLocaleString() : "—");
    setText("po-orderValue", pm.totalPoValue ? formatCurrency(pm.totalPoValue) : "—");
    setText("po-topSupplier", pm.topSupplier);

    buildPoOrderCharts(pm);

    // 3. Delivery Analysis KPIs
    setText("del-delivered", pm.delDelivered || "—");
    setText("del-partial", pm.delPartial || "—");
    setText("del-late", pm.delLate || "—");
    setText("del-ontime", pm.delOnTime || "—");
    setText("del-avgdays", pm.avgDeliveryDays !== "—" ? pm.avgDeliveryDays + " days" : "—");
    buildDeliveryCharts(pm);

    // 4. Open PO Analysis
    setText("opo-count", pm.openPoCount || "—");
    setText("opo-value", pm.openPoValue ? formatCurrency(pm.openPoValue) : "—");
    setText("opo-aging", pm.avgAging || "—");
    setText("opo-overdue", pm.overdueCount || "—");
    buildOpenPoTable(pm);

    // 5. Transit Stock
    setText("tr-qty", pm.trQtyTotal ? pm.trQtyTotal.toLocaleString() : "—");
    setText("tr-value", pm.trValueTotal ? formatCurrency(pm.trValueTotal) : "—");
    setText("tr-avgtime", pm.avgTransitTime !== "—" ? pm.avgTransitTime + " days" : "—");
    setText("tr-delayed", pm.trDelayed || "—");
    buildTransitCharts(pm);

    // 6. Consumption Analysis
    setText("con-stock", pm.totalCurrentStock ? pm.totalCurrentStock.toLocaleString() : "—");
    setText("con-daily", pm.avgDailyConsumption !== "—" ? pm.avgDailyConsumption : "—");
    setText("con-monthly", pm.avgMonthlyConsumption !== "—" ? pm.avgMonthlyConsumption : "—");

    const docEl = document.getElementById("con-doc");
    const riskEl = document.getElementById("con-risk");
    const docCard = document.getElementById("con-docCard");
    const riskCard = document.getElementById("con-riskCard");

    if (pm.daysOfCover !== null) {
        docEl.textContent = pm.daysOfCover + " days";
        let docColor = "#22c55e";
        if (pm.daysOfCover < 15) { docColor = "#dc2626"; }
        else if (pm.daysOfCover < 30) { docColor = "#f59e0b"; }
        docEl.style.color = docColor;
    } else {
        docEl.textContent = "—";
    }

    if (pm.stockoutRiskCount > 0) {
        riskEl.textContent = pm.stockoutRiskCount + " items";
        riskEl.style.color = "#dc2626";
        riskCard.classList.add("po-kpi-danger");
    } else {
        riskEl.textContent = "None";
        riskEl.style.color = "#22c55e";
    }

    // 7. AI Insights
    buildPoInsights(pm);

    // 8. Recommendations
    buildPoRecommendations(pm);
}

function buildPoOrderCharts(pm) {
    // Monthly PO Trend
    const months = Object.keys(pm.monthlyPoMap).sort((a, b) => {
        const ai = MONTH_ORDER.indexOf(a), bi = MONTH_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    destroyChart("poMonthly");
    charts.poMonthly = new Chart(document.getElementById("poMonthlyChart"), {
        type: "line",
        data: {
            labels: months,
            datasets: [{ label: "PO Count", data: months.map(m => pm.monthlyPoMap[m]), borderColor: "#E40046", backgroundColor: "rgba(228,0,70,0.1)", fill: true, tension: 0.4, pointBackgroundColor: "#E40046", pointRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });

    // Supplier-wise PO Value (top 10)
    const supEntries = Object.entries(pm.supplierValueMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    destroyChart("poSupplier");
    charts.poSupplier = new Chart(document.getElementById("poSupplierChart"), {
        type: "bar",
        data: {
            labels: supEntries.map(e => e[0]),
            datasets: [{ label: "PO Value", data: supEntries.map(e => e[1]), backgroundColor: COLORS, borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // Category-wise PO
    const catEntries = Object.entries(pm.categoryMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    destroyChart("poCategory");
    charts.poCategory = new Chart(document.getElementById("poCategoryChart"), {
        type: "doughnut",
        data: {
            labels: catEntries.map(e => e[0]),
            datasets: [{ data: catEntries.map(e => e[1]), backgroundColor: COLORS, borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
}

function buildDeliveryCharts(pm) {
    // Delivery Performance (donut)
    destroyChart("delPerf");
    charts.delPerf = new Chart(document.getElementById("delPerfChart"), {
        type: "doughnut",
        data: {
            labels: ["Delivered", "Partial", "Late", "On Time"],
            datasets: [{ data: [pm.delDelivered, pm.delPartial, pm.delLate, pm.delOnTime], backgroundColor: ["#22c55e", "#f59e0b", "#dc2626", "#2563eb"], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });

    // Delivery Trend (monthly)
    const months = Object.keys(pm.delMonthMap).sort((a, b) => {
        const ai = MONTH_ORDER.indexOf(a), bi = MONTH_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    destroyChart("delTrend");
    charts.delTrend = new Chart(document.getElementById("delTrendChart"), {
        type: "bar",
        data: {
            labels: months,
            datasets: [{ label: "Deliveries", data: months.map(m => pm.delMonthMap[m]), backgroundColor: "#22c55e", borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // On-Time vs Late
    destroyChart("onTimeLate");
    charts.onTimeLate = new Chart(document.getElementById("onTimeLateChart"), {
        type: "bar",
        data: {
            labels: ["On Time", "Late"],
            datasets: [{ label: "Count", data: [pm.delOnTime, pm.delLate], backgroundColor: ["#22c55e", "#dc2626"], borderRadius: 8 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

function buildOpenPoTable(pm) {
    const tbody = document.getElementById("openPoTableBody");
    const pager = document.getElementById("openPoPager");
    const rows = pm.openPoRows;
    tableState.openPo = { page: 0, filtered: rows };

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:20px">No Open PO data found in uploaded file</td></tr>`;
        if (pager) pager.innerHTML = "";
        return;
    }
    renderOpenPoPage();
}

function renderOpenPoPage() {
    const state = tableState.openPo;
    const rows = state.filtered;
    const tbody = document.getElementById("openPoTableBody");
    const today = new Date();

    const start = state.page * PAGE_SIZE;
    const slice = rows.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = slice.map(r => {
        const age = Number(r.Age || r.Age_Days || r.AgingDays || r.PendingDays || 0);
        let ageBg = "";
        if (age <= 7) ageBg = "style='color:#166534;font-weight:700'";
        else if (age <= 15) ageBg = "style='color:#92400e;font-weight:700'";
        else ageBg = "style='color:#991b1b;font-weight:700'";

        return `<tr>
            <td>${escHtml(r.PONumber || r.PO_Number || "—")}</td>
            <td>${escHtml(r.Supplier || r.Vendor || "—")}</td>
            <td>${escHtml(r.Material || r.Item || "—")}</td>
            <td>${escHtml(String(r.OrderedQty || r.Quantity || "—"))}</td>
            <td>${escHtml(String(r.ReceivedQty || r.Received || 0))}</td>
            <td>${escHtml(String(r.OpenQty || r.Balance || "—"))}</td>
            <td>${escHtml(String(r.ExpectedDate || r.DueDate || "—"))}</td>
            <td ${ageBg}>${age || "—"}</td>
            <td>${escHtml(r.POStatus || r.Status || "Open")}</td>
        </tr>`;
    }).join("");

    buildPager("openPo", null, "openPoPager", null, rows.length, renderOpenPoPage);
}

function buildTransitCharts(pm) {
    // Transit by Supplier (top 10)
    const supE = Object.entries(pm.trSupplierMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    destroyChart("trSupplier");
    charts.trSupplier = new Chart(document.getElementById("trSupplierChart"), {
        type: "bar",
        data: { labels: supE.map(e => e[0]), datasets: [{ label: "Transit Value", data: supE.map(e => e[1]), backgroundColor: "#2563eb", borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // Transit by Material (top 10)
    const matE = Object.entries(pm.trMaterialMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    destroyChart("trMaterial");
    charts.trMaterial = new Chart(document.getElementById("trMaterialChart"), {
        type: "bar",
        data: { labels: matE.map(e => e[0]), datasets: [{ label: "Transit Qty", data: matE.map(e => e[1]), backgroundColor: "#8b5cf6", borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // Transit Timeline
    const tlMonths = Object.keys(pm.trTimelineMap).sort((a, b) => {
        const ai = MONTH_ORDER.indexOf(a), bi = MONTH_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    destroyChart("trTimeline");
    charts.trTimeline = new Chart(document.getElementById("trTimelineChart"), {
        type: "line",
        data: {
            labels: tlMonths,
            datasets: [{ label: "Transit Qty", data: tlMonths.map(k => pm.trTimelineMap[k]), borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.1)", fill: true, tension: 0.4, pointRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
}

function buildPoInsights(pm) {
    const insights = [];

    if (pm.overdueCount > 0)
        insights.push({ cls: "poi-danger", icon: "🔴", text: `<strong>${pm.overdueCount} Open POs</strong> are overdue and require immediate follow-up.` });

    // Find worst-performing supplier
    const worstDel = Object.entries(pm.trSupplierMap).sort((a, b) => b[1] - a[1])[0];
    if (worstDel && pm.trDelayed > 0)
        insights.push({ cls: "poi-warning", icon: "⚠️", text: `Supplier <strong>${worstDel[0]}</strong> has the highest transit value pending — monitor for delays.` });

    if (pm.daysOfCover !== null && pm.daysOfCover < 15)
        insights.push({ cls: "poi-danger", icon: "🔴", text: `Days of Cover is critically low at <strong>${pm.daysOfCover} days</strong>. Stockout risk is high.` });

    if (pm.trValueTotal > 0)
        insights.push({ cls: "poi-info", icon: "🚚", text: `Transit stock worth <strong>${formatCurrency(pm.trValueTotal)}</strong> is currently in pipeline.` });

    if (pm.totalOrders > 0 && pm.fulfillmentRate < 90)
        insights.push({ cls: "poi-warning", icon: "📋", text: `PO Fulfillment Rate is <strong>${pm.fulfillmentRate}%</strong>. Target: 90%+.` });

    if (pm.openPoCount > 0)
        insights.push({ cls: "poi-info", icon: "📂", text: `<strong>${pm.openPoCount} Open POs</strong> worth <strong>${formatCurrency(pm.openPoValue)}</strong> are pending.` });

    if (pm.delLate > 0)
        insights.push({ cls: "poi-warning", icon: "⏰", text: `<strong>${pm.delLate} deliveries</strong> are late. Review supplier SLAs.` });

    if (pm.totalOrders > 0) {
        const procEff = Math.round(100 - (pm.openPoCount / pm.totalOrders) * 100);
        insights.push({ cls: "poi-info", icon: "📊", text: `Procurement Efficiency: <strong>${procEff}%</strong> (closed vs total POs).` });
    }

    if (!insights.length)
        insights.push({ cls: "poi-info", icon: "✅", text: "PO metrics look healthy. No critical issues detected." });

    document.getElementById("poAiInsights").innerHTML = insights.map(i =>
        `<div class="po-insight-item ${i.cls}">${i.icon} ${i.text}</div>`
    ).join("");
}

function buildPoRecommendations(pm) {
    const recs = [];
    if (pm.overdueCount > 0) recs.push("🔁 Follow up immediately on <strong>" + pm.overdueCount + " overdue POs</strong> to prevent supply disruption.");
    if (pm.delLate > 0) recs.push("📞 Escalate with suppliers having late deliveries. Issue penalty notice if SLA breached.");
    if (pm.daysOfCover !== null && pm.daysOfCover < 15) recs.push("📦 Increase order quantity for fast-moving items — Days of Cover is below 15 days.");
    if (pm.openPoCount > 5) recs.push("🗂️ Review and close old Open POs to reduce procurement backlog.");
    if (pm.trDelayed > 0) recs.push("🚚 Reschedule overdue transit shipments and update ETA in system.");
    if (pm.stockoutRiskCount > 0) recs.push("⚠️ Increase safety stock for <strong>" + pm.stockoutRiskCount + " critical materials</strong> at stockout risk.");
    recs.push("🔄 Transfer excess stock from nearby warehouses to cover shortage locations.");
    recs.push("📊 Run monthly PO performance review with top 5 suppliers.");

    document.getElementById("poRecommendations").innerHTML = recs.map(r =>
        `<div class="recommendation">${r}</div>`
    ).join("");
}

// ═══════════════════════════════════════════════════
// PAGINATED TABLES
// ═══════════════════════════════════════════════════
function initTables(m) {
    tableState.inventory = { page: 0, filtered: m.invRows };
    tableState.vendor = { page: 0, filtered: m.vendorRows };
    tableState.shipment = { page: 0, filtered: m.shipRows };

    renderTable("inventory", "inventoryTable", "invPager", "invCount");
    renderTable("vendor", "vendorTable", "vendorPager", "vendorCount2");
    renderTable("shipment", "shipmentTable", "shipPager", "shipCount");
}

function renderTable(key, tableId, pagerId, countId) {
    const state = tableState[key];
    const data = state.filtered;
    const table = document.getElementById(tableId);
    if (!table) return;

    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = `(${data.length.toLocaleString()} rows)`;

    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (!data.length) {
        thead.innerHTML = "";
        tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;color:#6b7280;padding:20px">No data</td></tr>`;
        const pager = document.getElementById(pagerId);
        if (pager) pager.innerHTML = "";
        return;
    }

    const headers = Object.keys(data[0]);
    thead.innerHTML = "<tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr>";

    const start = state.page * PAGE_SIZE;
    const slice = data.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = slice.map(row =>
        "<tr>" + headers.map(h => `<td>${escHtml(row[h] ?? "")}</td>`).join("") + "</tr>"
    ).join("");

    buildPager(key, tableId, pagerId, countId, data.length);
}

// Global page-navigation dispatcher — avoids serialising closures into HTML
// onclick strings (which break after re-render because the closure is stale).
function _goPage(key, tableId, pagerId, countId, page, isOpenPo) {
    tableState[key].page = page;
    if (isOpenPo) renderOpenPoPage();
    else renderTable(key, tableId, pagerId, countId);
    document.getElementById(tableId || pagerId)
        ?.closest(".panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildPager(key, tableId, pagerId, countId, total, customRender) {
    const pager = document.getElementById(pagerId);
    if (!pager) return;
    const state = tableState[key];
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { pager.innerHTML = ""; return; }

    const isOpenPo = (customRender === renderOpenPoPage);
    const nav = (p) =>
        `_goPage('${key}','${tableId}','${pagerId}','${countId}',${p},${isOpenPo})`;

    let html = `<span class="page-info">Page ${state.page + 1} of ${pages} (${total.toLocaleString()} rows)</span>`;
    html += `<button class="page-btn" ${state.page === 0 ? "disabled" : ""} onclick="${nav(0)}">«</button>`;
    html += `<button class="page-btn" ${state.page === 0 ? "disabled" : ""} onclick="${nav(state.page - 1)}">‹</button>`;

    const win = 2;
    for (let p = Math.max(0, state.page - win); p <= Math.min(pages - 1, state.page + win); p++) {
        html += `<button class="page-btn ${p === state.page ? "active" : ""}" onclick="${nav(p)}">${p + 1}</button>`;
    }

    html += `<button class="page-btn" ${state.page === pages - 1 ? "disabled" : ""} onclick="${nav(state.page + 1)}">›</button>`;
    html += `<button class="page-btn" ${state.page === pages - 1 ? "disabled" : ""} onclick="${nav(pages - 1)}">»</button>`;
    pager.innerHTML = html;
}

// goPage() removed — use _goPage() dispatcher instead

// ── Functional Search + Risk Filter ───────────────
let searchDebounce = null;
document.getElementById("searchInput")?.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 280);
});
document.getElementById("itemCodeSearch")?.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 280);
});
document.getElementById("riskFilter")?.addEventListener("change", applyFilters);
document.getElementById("tableTarget")?.addEventListener("change", applyFilters);

function applyFilters() {
    if (!metrics) return;
    const q = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
    const qCode = (document.getElementById("itemCodeSearch")?.value || "").toLowerCase().trim();
    const risk = document.getElementById("riskFilter")?.value || "all";
    const target = document.getElementById("tableTarget")?.value || "all";

    function filterRows(rows) {
        return rows.filter(row => {
            const text = Object.values(row).join(" ").toLowerCase();
            if (q && !text.includes(q)) return false;
            if (qCode) {
                const code = String(row.ItemCode || row.Item_Code || row.Material || "").toLowerCase();
                if (!code.includes(qCode)) return false;
            }
            if (risk === "critical" && String(row.SLAStatus || "").toLowerCase() !== "breached") return false;
            if (risk === "high" && !((Number(row.DelayDays) || 0) > 5)) return false;
            if (risk === "medium" && !((Number(row.CurrentStock) || 0) < (Number(row.SafetyStock) || 0))) return false;
            return true;
        });
    }

    const applyInv = target === "all" || target === "inventory";
    const applyVend = target === "all" || target === "vendor";
    const applyShip = target === "all" || target === "shipment";

    if (applyInv) { tableState.inventory.filtered = filterRows(metrics.invRows); tableState.inventory.page = 0; }
    if (applyVend) { tableState.vendor.filtered = filterRows(metrics.vendorRows); tableState.vendor.page = 0; }
    if (applyShip) { tableState.shipment.filtered = filterRows(metrics.shipRows); tableState.shipment.page = 0; }

    renderTable("inventory", "inventoryTable", "invPager", "invCount");
    renderTable("vendor", "vendorTable", "vendorPager", "vendorCount2");
    renderTable("shipment", "shipmentTable", "shipPager", "shipCount");

    if (q || qCode || risk !== "all") {
        const tablesBtn = document.querySelector('[data-tab="tab-tables"]');
        if (tablesBtn) tablesBtn.click();
    }
}

// ── Export Excel ──────────────────────────────────
function exportExcel() {
    if (!fullData.length) { showToast("No data to export.", "warn"); return; }
    const m = calcMetrics();
    const pm = calcPoMetrics();
    const wb = XLSX.utils.book_new();

    const kpiData = [
        { Metric: "Total Records", Value: document.getElementById("totalRecords").textContent },
        { Metric: "Inventory Risks", Value: document.getElementById("inventoryRisk").textContent },
        { Metric: "Pending POs", Value: document.getElementById("pendingPO").textContent },
        { Metric: "SLA Breaches", Value: document.getElementById("slaBreaches").textContent },
        { Metric: "Delayed Shipments", Value: document.getElementById("delayedShipments").textContent },
        { Metric: "Vendor Count", Value: m.vendors.size },
        { Metric: "Inventory Value", Value: document.getElementById("inventoryValue").textContent },
        { Metric: "SCM Efficiency", Value: document.getElementById("efficiencyScore").textContent },
        { Metric: "Health Score", Value: document.getElementById("gauge").querySelector("span").textContent + "/100" },
        { Metric: "Data Completeness", Value: m.completeness + "%" },
        { Metric: "Duplicate Rows", Value: m.dupes },
        { Metric: "Missing Cells", Value: m.missingCells },
        // PO KPIs
        { Metric: "Total PO Orders", Value: pm.totalOrders },
        { Metric: "Total PO Value", Value: pm.totalPoValue },
        { Metric: "Open PO Count", Value: pm.openPoCount },
        { Metric: "Open PO Value", Value: pm.openPoValue },
        { Metric: "PO Fulfillment %", Value: pm.fulfillmentRate + "%" },
        { Metric: "Avg Delivery Days", Value: pm.avgDeliveryDays },
        { Metric: "Overdue POs", Value: pm.overdueCount },
        { Metric: "Transit Value", Value: pm.trValueTotal },
        { Metric: "Days of Cover", Value: pm.daysOfCover },
        { Metric: "Generated", Value: new Date().toLocaleString() },
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiData), "KPI Summary");
    if (m.invRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.invRows), "Inventory Risk Items");
    if (m.vendorRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.vendorRows), "Vendor Risk Analysis");
    if (m.shipRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.shipRows), "Delayed Shipments");
    if (pm.openPoRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pm.openPoRows), "Open PO");
    if (pm.transit.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pm.transit), "Transit Stock");
    if (sheetData.PO_Orders.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.PO_Orders), "PO Orders");
    if (sheetData.PO_Deliveries.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.PO_Deliveries), "PO Deliveries");
    if (sheetData.Consumption.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.Consumption), "Consumption");

    // SCM Insights tables (Master Sheet, ASN In Transit, Stock Report, Monthly Consumption)
    if (sheetData.Stock_Open_PO_Transit.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.Stock_Open_PO_Transit), "Master Sheet");
    if (sheetData.ASN_InTransit.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.ASN_InTransit), "ASN In Transit");
    if (sheetData.Stock_Report.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.Stock_Report), "Stock Report");
    if (sheetData.Monthly_Consumption.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.Monthly_Consumption), "Monthly Consumption");
    if (sheetData.PO_Dump.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData.PO_Dump), "PO Dump");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fullData), "SCM Raw Data");
    XLSX.writeFile(wb, "Airtel_SCM_Report.xlsx");
}

// ── PDF Report ────────────────────────────────────
async function generatePDFReport() {
    if (!fullData.length) { showToast("No data loaded.", "warn"); return; }
    showToast("Preparing PDF — please wait…", "info", 6000);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const m = calcMetrics();
    const pm = calcPoMetrics();
    const W = 210, mg = 14;
    let y = 0;

    // ── Helpers ──────────────────────────────────────
    // Strip HTML, HTML entities, emoji, ₹ symbol so jsPDF latin font renders cleanly
    const clean = s => (s || "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "and").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ")
        .replace(/&[a-z]+;/gi, "")
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "").replace(/[\u{2600}-\u{27BF}]/gu, "")
        .replace(/[^\x20-\x7E\u00A0-\u024F]/g, "")   // strip non-latin (incl. ₹ U+20B9)
        .replace(/  +/g, " ").trim();

    // For KPI values: also convert currency strings (₹…Cr/L) to readable form
    const cleanVal = v => clean(String(v))
        .replace(/Rs\.?\s*/gi, "INR ")
        .replace(/INR\s+INR/gi, "INR");

    const checkY = (n = 10) => { if (y + n > 280) { doc.addPage(); y = 20; } };

    const secHead = title => {
        checkY(14);
        doc.setFillColor(228, 0, 70);
        doc.roundedRect(mg, y, W - mg * 2, 9, 2, 2, "F");
        doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont(undefined, "bold");
        doc.text(title, mg + 4, y + 6.2);
        doc.setTextColor(30, 30, 30); doc.setFont(undefined, "normal");
        y += 13;
    };

    const kpiRow = (label, value, alt) => {
        checkY(8);
        if (alt) { doc.setFillColor(255, 245, 245); doc.rect(mg, y - 5, W - mg * 2, 7, "F"); }
        doc.setFont(undefined, "bold"); doc.setFontSize(10);
        doc.text(label + ":", mg + 2, y);
        doc.setFont(undefined, "normal");
        doc.text(cleanVal(value), mg + 80, y);
        y += 7;
    };

    const bullet = txt => {
        const lines = doc.splitTextToSize("• " + clean(txt), W - mg * 2 - 4);
        lines.forEach(l => { checkY(6); doc.text(l, mg + 2, y); y += 5.5; });
    };

    // Compact data-table renderer for SCM Insights sheets (no autotable plugin available)
    const drawTable = (headers, rows, widths, opts = {}) => {
        const fontSize = opts.fontSize || 7;
        const rowH = opts.rowH || 5.5;
        const tableW = widths.reduce((a, b) => a + b, 0);
        doc.setFontSize(fontSize);

        const drawHeader = () => {
            checkY(rowH + 2);
            doc.setFillColor(228, 0, 70);
            doc.rect(mg, y - 4, tableW, rowH, "F");
            doc.setTextColor(255, 255, 255); doc.setFont(undefined, "bold");
            let hx = mg;
            headers.forEach((h, i) => { doc.text(clean(String(h)), hx + 1, y, { maxWidth: widths[i] - 1.5 }); hx += widths[i]; });
            doc.setTextColor(30, 30, 30); doc.setFont(undefined, "normal");
            y += rowH;
        };

        drawHeader();
        rows.forEach((r, ri) => {
            if (y + rowH > 280) { doc.addPage(); y = 20; drawHeader(); }
            if (ri % 2 === 1) { doc.setFillColor(255, 245, 245); doc.rect(mg, y - 4, tableW, rowH, "F"); }
            let cx = mg;
            r.forEach((c, ci) => { doc.text(clean(String(c)), cx + 1, y, { maxWidth: widths[ci] - 1.5 }); cx += widths[ci]; });
            y += rowH;
        });
        y += 6;
    };

    // ── Chart capture: render each chart into a dedicated full-width off-screen canvas ──
    // This avoids the "tiny bars in top-left corner" problem caused by capturing
    // a live canvas that was sized by its CSS container (which may be narrow).
    // Instead we draw each Chart.js dataset directly onto a 1400×500 px canvas,
    // giving consistent, crisp, full-width chart images regardless of screen/tab state.
    const captureAllCharts = () => new Promise(resolve => {
        const CHART_W = 1400, CHART_H = 500;
        const captures = {};

        // Helper: clone chart config onto a fresh off-screen canvas at full resolution
        const renderOffscreen = (chartInstance, id) => {
            if (!chartInstance) return;
            const offCanvas = document.createElement("canvas");
            offCanvas.width  = CHART_W;
            offCanvas.height = CHART_H;
            offCanvas.style.display = "none";
            document.body.appendChild(offCanvas);

            try {
                // Deep-clone config so we don't mutate the live chart
                const cfg = chartInstance.config;
                const clonedData = {
                    labels: [...(cfg.data.labels || [])],
                    datasets: cfg.data.datasets.map(ds => ({ ...ds, data: [...ds.data] }))
                };

                // Build clean options: responsive off, fixed size, animation off
                const baseOpts = cfg.options || {};
                const clonedOpts = {
                    ...baseOpts,
                    responsive: false,
                    animation: false,
                    plugins: {
                        ...(baseOpts.plugins || {}),
                        legend: { ...(baseOpts.plugins && baseOpts.plugins.legend || {}), labels: { font: { size: 14 } } }
                    },
                    scales: baseOpts.scales ? Object.fromEntries(
                        Object.entries(baseOpts.scales).map(([k, v]) => [k, {
                            ...v,
                            ticks: { ...(v.ticks || {}), font: { size: 13 } }
                        }])
                    ) : undefined
                };

                const tmpChart = new Chart(offCanvas.getContext("2d"), {
                    type: cfg.type,
                    data: clonedData,
                    options: clonedOpts
                });
                captures[id] = { data: offCanvas.toDataURL("image/png", 1.0), w: CHART_W, h: CHART_H };
                tmpChart.destroy();
            } catch(e) {
                console.warn("Off-screen render failed for", id, e);
            }
            document.body.removeChild(offCanvas);
        };

        // Render all 6 charts off-screen
        const chartMap = {
            riskChart: charts.risk,
            riskPieChart: charts.pie,
            vendorChart: charts.vendor,
            inventoryChart: charts.inv,
            shipmentTrendChart: charts.ship,
            vendorSlaChart: charts.sla,
        };
        Object.entries(chartMap).forEach(([id, inst]) => renderOffscreen(inst, id));

        resolve(captures);
    });

    // Embed a captured chart image. Fixed height = 85mm for consistent PDF layout.
    const embedCapture = (captures, canvasId, label) => {
        const cap = captures[canvasId];
        if (!cap) return;
        const imgW = W - mg * 2;          // full printable width
        const imgH = imgW * (cap.h / cap.w);  // preserve 1400:500 aspect → ~64mm
        checkY(imgH + 16);
        if (label) {
            doc.setFontSize(10); doc.setFont(undefined, "bold");
            doc.text(label, mg, y); y += 6;
            doc.setFont(undefined, "normal");
        }
        doc.addImage(cap.data, "PNG", mg, y, imgW, imgH);
        y += imgH + 8;
    };

    // ── Capture charts first (before building PDF pages) ──
    const captures = await captureAllCharts();

    // ── Cover ─────────────────────────────────────────
    doc.setFillColor(228, 0, 70); doc.rect(0, 0, W, 38, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20); doc.setFont(undefined, "bold");
    doc.text("Airtel SCM Platform", mg, 16);
    doc.setFontSize(11); doc.setFont(undefined, "normal");
    doc.text("Supply Chain Analytics & Risk Report", mg, 24);
    doc.setFontSize(9);
    doc.text("Generated: " + new Date().toLocaleString(), mg, 32);
    doc.setTextColor(30, 30, 30);
    y = 48;

    secHead("KPI Summary");
    doc.setFontSize(10);
    // Read ₹ values from DOM — cleanVal will strip the ₹ symbol for the PDF font
    const invValText = document.getElementById("inventoryValue").textContent;
    [
        ["Total Records", m.total.toLocaleString()],
        ["Inventory Risks", m.inventoryRisk],
        ["Pending POs", m.pendingPO],
        ["SLA Breaches", m.slaBreaches],
        ["Delayed Shipments", m.delayed],
        ["Vendor Count", m.vendors.size],
        ["Inventory Value", invValText],
        ["SCM Efficiency", document.getElementById("efficiencyScore").textContent],
        ["Health Score", document.getElementById("gauge").querySelector("span").textContent + "/100"],
        ["Data Completeness", m.completeness + "%"],
    ].forEach(([l, v], i) => kpiRow(l, v, i % 2 === 0));

    y += 6;
    secHead("PO Analytics Summary");
    doc.setFontSize(10);
    [
        ["Total PO Orders", pm.totalOrders],
        ["Total PO Value", formatCurrency(pm.totalPoValue)],
        ["Open PO Count", pm.openPoCount],
        ["Open PO Value", formatCurrency(pm.openPoValue)],
        ["PO Fulfillment %", pm.fulfillmentRate + "%"],
        ["Overdue POs", pm.overdueCount],
        ["Avg Delivery Days", pm.avgDeliveryDays],
        ["Transit Value", formatCurrency(pm.trValueTotal)],
        ["Days of Cover", pm.daysOfCover !== null ? pm.daysOfCover + " days" : "N/A"],
        ["Stockout Risk Items", pm.stockoutRiskCount],
    ].forEach(([l, v], i) => kpiRow(l, v, i % 2 === 0));

    // ── Charts pages ─────────────────────────────────
    doc.addPage(); y = 20;
    secHead("Charts — Risk Overview");
    embedCapture(captures, "riskChart", "Risk Overview (Bar)");
    embedCapture(captures, "riskPieChart", "Risk Breakdown (Doughnut)");

    doc.addPage(); y = 20;
    secHead("Charts — Vendor & Inventory");
    embedCapture(captures, "vendorChart", "Vendor Delays");
    embedCapture(captures, "inventoryChart", "Inventory Shortages (Top 12)");

    doc.addPage(); y = 20;
    secHead("Charts — Shipment & SLA Trends");
    embedCapture(captures, "shipmentTrendChart", "Monthly Shipment Delays");
    embedCapture(captures, "vendorSlaChart", "Vendor SLA Breaches");

    // ── Text sections ─────────────────────────────────
    doc.addPage(); y = 20;
    secHead("Top Risk Indicators");
    doc.setFontSize(10);
    document.querySelectorAll("#topRisks li").forEach(el => bullet(el.innerText));

    y += 6;
    secHead("SCM Insights");
    document.querySelectorAll("#aiInsights li").forEach(el => bullet(el.innerText));

    y += 6;
    secHead("PO Smart Insights");
    document.querySelectorAll("#poAiInsights .po-insight-item").forEach(el => bullet(el.innerText));

    y += 6;
    secHead("Smart Alerts (top 15)");
    [...document.querySelectorAll("#alertsContainer .alert")].slice(0, 15).forEach(el => bullet(el.innerText));

    y += 6;
    secHead("PO Recommendations");
    document.querySelectorAll("#poRecommendations .recommendation").forEach(el => bullet(el.innerText));

    y += 6;
    secHead("SCM Recommendations");
    [...document.querySelectorAll("#replenishmentContainer .recommendation")].slice(0, 15).forEach(el => bullet(el.innerText));

    // ── SCM Insights — Data Tables (Master Sheet, ASN, Stock Report, Monthly Consumption) ──
    const getField = (r, ...keys) => {
        for (const k of keys) {
            if (r[k] !== undefined && r[k] !== "" && r[k] !== null) return r[k];
            const match = Object.keys(r).find(rk => rk.trim() === k.trim());
            if (match && r[match] !== undefined && r[match] !== "" && r[match] !== null) return r[match];
        }
        return "—";
    };
    const fmtN = v => typeof v === "number" ? Number(v.toFixed(2)).toLocaleString() : String(v);
    const fmtP = v => typeof v === "number" ? (v < 2 ? (v * 100).toFixed(1) + "%" : v.toFixed(1) + "%") : String(v);

    doc.addPage(); y = 20;
    secHead("SCM Insights — Data Tables");

    // Master Sheet
    if (sheetData.Stock_Open_PO_Transit.length) {
        doc.setFontSize(10); doc.setFont(undefined, "bold");
        checkY(8); doc.text("Master Sheet" + (sheetData.Stock_Open_PO_Transit.length > 40 ? " (top 40 of " + sheetData.Stock_Open_PO_Transit.length + ")" : ""), mg, y);
        y += 6; doc.setFont(undefined, "normal");
        const masterRows = sheetData.Stock_Open_PO_Transit.slice(0, 40).map(r => [
            getField(r, "Item Code ", "Item Code", "ItemCode"),
            getField(r, "Vendor"),
            getField(r, "AOP"),
            fmtN(getField(r, "20-Jan to 31-May Ordering", "20-Jan to 31-May Ordering ", "20 Jan to 31 May Ordering", "20Jan-31May Ordering")),
            fmtP(getField(r, "%AOP Ordering")),
            getField(r, "Stock"),
            getField(r, "Transit + Stock ", "Transit + Stock"),
            fmtN(getField(r, "Avg Consumption")),
            fmtN(getField(r, "Month Coverage with Stock+Transit")),
            fmtN(getField(r, "Month Coverage with Stock+ Open Order")),
        ]);
        drawTable(
            ["Item Code", "Vendor", "AOP", "20-Jan to 31-May Ord.", "%AOP Ord.", "Stock", "Trans+Stock", "Avg Cons.", "MC S+T", "MC S+OO"],
            masterRows,
            [22, 26, 14, 24, 16, 14, 18, 16, 16, 16]
        );
    }

    // ASN In Transit (aggregated by item, top 15)
    if (sheetData.ASN_InTransit.length) {
        const asnQtyMap = {};
        sheetData.ASN_InTransit.forEach(r => {
            const item = String(r.Item || r.item || "Unknown").trim();
            asnQtyMap[item] = (asnQtyMap[item] || 0) + Number(r.Quantity || r.quantity || 0);
        });
        const asnTop = Object.entries(asnQtyMap).sort((a, b) => b[1] - a[1]).slice(0, 15);
        doc.setFontSize(10); doc.setFont(undefined, "bold");
        checkY(8); doc.text("ASN In Transit — Top Items by Quantity", mg, y);
        y += 6; doc.setFont(undefined, "normal");
        drawTable(["Item", "Quantity"], asnTop.map(([item, qty]) => [item, qty.toLocaleString()]), [130, 52]);
    }

    // Stock Report (top 15)
    if (sheetData.Stock_Report.length) {
        doc.setFontSize(10); doc.setFont(undefined, "bold");
        checkY(8); doc.text("Stock Report" + (sheetData.Stock_Report.length > 15 ? " (top 15 of " + sheetData.Stock_Report.length + ")" : ""), mg, y);
        y += 6; doc.setFont(undefined, "normal");
        const stockRows = sheetData.Stock_Report.slice(0, 15).map(r => [
            getField(r, "Item_Code", "ItemCode", "Item Code"),
            getField(r, "Quantity"),
            getField(r, "Description"),
            getField(r, "StockValue (₹)", "StockValue"),
        ]);
        drawTable(["Item Code", "Quantity", "Description", "Stock Value"], stockRows, [32, 22, 86, 42]);
    }

    // Monthly Consumption (top 15)
    if (sheetData.Monthly_Consumption.length) {
        doc.setFontSize(10); doc.setFont(undefined, "bold");
        checkY(8); doc.text("Monthly Consumption" + (sheetData.Monthly_Consumption.length > 15 ? " (top 15 of " + sheetData.Monthly_Consumption.length + ")" : ""), mg, y);
        y += 6; doc.setFont(undefined, "normal");
        const monthlyRows = sheetData.Monthly_Consumption.slice(0, 15).map(r => [
            getField(r, "Item_Code", "ItemCode", "Item Code"),
            getField(r, "Quantity"),
            getField(r, "Usable To Site"),
            getField(r, "Planning Month"),
            getField(r, "Date Of Submition", "Date Of Submission"),
        ]);
        drawTable(["Item Code", "Quantity", "Usable To Site", "Planning Month", "Date Of Submission"], monthlyRows, [28, 18, 44, 40, 52]);
    }

    // PO Dump (top 40)
    if (sheetData.PO_Dump.length) {
        doc.addPage(); y = 20;
        secHead("PO Dump — Purchase Order Details");
        doc.setFontSize(10); doc.setFont(undefined, "bold");
        checkY(8);
        doc.text("PO Dump" + (sheetData.PO_Dump.length > 40 ? " (top 40 of " + sheetData.PO_Dump.length + ")" : ""), mg, y);
        y += 6; doc.setFont(undefined, "normal");

        const getPD = (r, ...keys) => {
            for (const k of keys) {
                if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
                const match = Object.keys(r).find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
                if (match && r[match] !== undefined && r[match] !== null && r[match] !== "") return r[match];
            }
            return "—";
        };
        const fmtCurrPD = v => { const n = parseFloat(v); return isNaN(n) ? (v || "—") : "INR " + n.toLocaleString("en-IN", { maximumFractionDigits: 2 }); };
        const fmtNumPD  = v => { const n = parseFloat(v); return isNaN(n) ? (v || "—") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }); };

        const poDumpRows = sheetData.PO_Dump.slice(0, 40).map(r => [
            getPD(r, "PO Number", "PONumber", "PO_Number"),
            getPD(r, "PO Date",   "PODate",   "PO_Date"),
            getPD(r, "Vendor Name", "VendorName", "Vendor"),
            getPD(r, "Item Code",   "ItemCode",   "Item_Code"),
            getPD(r, "Item Description", "ItemDescription", "Material", "Description"),
            fmtNumPD(getPD(r, "Qty Ordered",   "QtyOrdered",   "OrderedQty")),
            fmtNumPD(getPD(r, "Qty Received",  "QtyReceived",  "ReceivedQty")),
            fmtNumPD(getPD(r, "Qty Cancelled", "QtyCancelled", "CancelledQty")),
            fmtCurrPD(getPD(r, "Unit Price", "UnitPrice")),
            fmtCurrPD(getPD(r, "Total Value in Currency w/o Tax", "TotalValue", "POValue")),
        ]);

        drawTable(
            ["PO No.", "PO Date", "Vendor", "Item Code", "Description", "Ord Qty", "Rec Qty", "Can Qty", "Unit Price", "Total Value"],
            poDumpRows,
            [20, 18, 28, 20, 34, 14, 14, 14, 18, 22]
        );
    }

    // ── Footer on every page ──────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFillColor(228, 0, 70); doc.rect(0, 288, W, 9, "F");
        doc.setTextColor(255, 255, 255); doc.setFontSize(8);
        doc.text("Airtel SCM Platform © 2026 | Telecom Supply Chain Analytics", mg, 293.5);
        doc.text("Page " + p + " of " + totalPages, W - mg - 18, 293.5);
        doc.setTextColor(30, 30, 30);
    }
    doc.save("Airtel_SCM_Report.pdf");
}

// ── Collapsible Panels ────────────────────────────
function togglePanel(bodyId, btn) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const isCollapsed = body.classList.toggle("collapsed");
    btn.classList.toggle("is-collapsed", isCollapsed);
    const label = btn.querySelector(".toggle-icon").nextSibling;
    if (label) label.textContent = isCollapsed ? " Show" : " Hide";
}

// ── Upload History ────────────────────────────────
function saveHistory(name) {
    // Always save locally
    const history = JSON.parse(localStorage.getItem("uploadHistory") || "[]");
    history.unshift({ file: name, time: new Date().toLocaleString() });
    localStorage.setItem("uploadHistory", JSON.stringify(history.slice(0, 20)));
    renderHistory();
}
async function renderHistory() {
    const ul = document.getElementById("uploadHistory"); if (!ul) return;

    // Try backend history first
    if (_backendAvailable) {
        try {
            const r = await fetch(BACKEND_URL + "/api/history");
            const data = await r.json();
            if (r.ok && data.history && data.history.length) {
                ul.innerHTML = "";
                data.history.forEach(item => {
                    const li = document.createElement("li");
                    const score = item.healthScore !== undefined ? ` | Health: ${item.healthScore}` : "";
                    const records = item.recordCount !== undefined ? ` | Records: ${item.recordCount}` : "";
                    li.textContent = item.fileName + records + score + " | " + new Date(item.uploadedAt).toLocaleString();
                    ul.appendChild(li);
                });
                return;
            }
        } catch {}
    }

    // Fall back to localStorage
    const history = JSON.parse(localStorage.getItem("uploadHistory") || "[]");
    ul.innerHTML = "";
    history.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item.file + " | " + item.time;
        ul.appendChild(li);
    });
}
window.addEventListener("load", renderHistory);

// ── Google Region Map ─────────────────────────────
let _googleChartsReady = false;
google.charts.load("current", { packages: ["geochart"] });
google.charts.setOnLoadCallback(() => { _googleChartsReady = true; });
function buildRegionMap() {
    const regionRisk = { North: 0, South: 0, East: 0, West: 0, Central: 0 };
    let unrecognizedCount = 0;
    const unrecognizedRegions = new Set();
    fullData.forEach(row => {
        const region = (row.Region || "").trim();
        let risk = 0;
        if ((+row.CurrentStock || 0) < (+row.SafetyStock || 0)) risk++;
        if ((+row.PendingDays || 0) > 14) risk++;
        if (String(row.SLAStatus || "").toLowerCase() === "breached") risk++;
        if ((+row.DelayDays || 0) > 5) risk++;
        if (regionRisk.hasOwnProperty(region)) {
            regionRisk[region] += risk;
        } else if (region) {
            unrecognizedCount++;
            unrecognizedRegions.add(region);
        }
    });
    const data = google.visualization.arrayToDataTable([
        ["Province", "Risk"],
        ["Delhi", regionRisk.North], ["Punjab", regionRisk.North], ["Haryana", regionRisk.North], ["Uttar Pradesh", regionRisk.North],
        ["Tamil Nadu", regionRisk.South], ["Karnataka", regionRisk.South], ["Kerala", regionRisk.South], ["Telangana", regionRisk.South],
        ["West Bengal", regionRisk.East], ["Odisha", regionRisk.East], ["Bihar", regionRisk.East], ["Jharkhand", regionRisk.East],
        ["Maharashtra", regionRisk.West], ["Gujarat", regionRisk.West], ["Goa", regionRisk.West],
        ["Madhya Pradesh", regionRisk.Central], ["Chhattisgarh", regionRisk.Central],
    ]);
    const options = {
        region: "IN", resolution: "provinces", displayMode: "regions",
        backgroundColor: "transparent", datalessRegionColor: "#ececec",
        colorAxis: { colors: ["#22c55e", "#facc15", "#f97316", "#dc2626"] },
    };
    new google.visualization.GeoChart(document.getElementById("regionMap")).draw(data, options);
    const sorted = Object.entries(regionRisk).sort((a, b) => b[1] - a[1]);
    const rs = document.getElementById("regionSummary");
    if (rs) {
        let summaryHtml = `<strong>Highest Risk:</strong> ${escHtml(sorted[0][0])} (${sorted[0][1]}) &nbsp;|&nbsp; <strong>Lowest Risk:</strong> ${escHtml(sorted[sorted.length - 1][0])} (${sorted[sorted.length - 1][1]})`;
        if (unrecognizedCount > 0) {
            summaryHtml += ` &nbsp;|&nbsp; <span style="color:var(--warning)">⚠️ ${unrecognizedCount} row(s) excluded (unrecognized region: ${escHtml([...unrecognizedRegions].join(", "))})</span>`;
        }
        rs.innerHTML = summaryHtml;
    }
}

// ═══════════════════════════════════════════════════
// SCM INSIGHTS — ASN InTransit, Stock Report,
// Monthly Consumption, Master Sheet
// ═══════════════════════════════════════════════════

// Cached data for searchable tables
let _stockData = [];
let _monthlyData = [];
let _masterData = [];
let _poDumpData = [];
let _poDumpPage = 0;
const PO_DUMP_PAGE_SIZE = 50;

function buildScmInsights() {
    buildPoDump();
    buildAsnInTransit();
    buildStockReport();
    buildMonthlyConsumption();
    buildMasterSheet();
}

// ── ASN In Transit ────────────────────────────────
function buildAsnInTransit() {
    const rows = sheetData.ASN_InTransit || [];
    if (!rows.length) return;

    // Aggregate by Item: sum Quantity
    const itemQtyMap = {};
    const itemPoDpeMap = {};
    const itemPrDpeMap = {};

    rows.forEach(r => {
        const item = String(r.Item || r.item || "Unknown").trim();
        const qty = Number(r.Quantity || r.quantity || 0);
        const poDpe = String(r["PO DPE STATUS"] || "Unknown").trim();
        const prDpe = String(r["PR DPE STATUS"] || "Unknown").trim();

        itemQtyMap[item] = (itemQtyMap[item] || 0) + qty;
        if (!itemPoDpeMap[item]) itemPoDpeMap[item] = {};
        itemPoDpeMap[item][poDpe] = (itemPoDpeMap[item][poDpe] || 0) + 1;
        if (!itemPrDpeMap[item]) itemPrDpeMap[item] = {};
        itemPrDpeMap[item][prDpe] = (itemPrDpeMap[item][prDpe] || 0) + 1;
    });

    const topItems = Object.entries(itemQtyMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const itemLabels = topItems.map(e => e[0]);

    // Chart 1: Item vs Quantity
    destroyChart("asnItemQty");
    const ctx1 = document.getElementById("asnItemQtyChart");
    if (ctx1) {
        charts.asnItemQty = new Chart(ctx1, {
            type: "bar",
            data: {
                labels: itemLabels,
                datasets: [{ label: "Quantity", data: topItems.map(e => e[1]), backgroundColor: "#E40046", borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => "Qty: " + ctx.parsed.y.toLocaleString() } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 12, weight: "600" }, color: "#374151" } },
                    x: { ticks: { maxRotation: 40, minRotation: 30, font: { size: 11, weight: "500" }, color: "#374151" }, grid: { display: false } }
                }
            }
        });
    }

    // Chart 2: Item vs PO DPE Status (stacked)
    const allPoDpe = [...new Set(rows.map(r => String(r["PO DPE STATUS"] || "Unknown").trim()))];
    const dpeColors = { "Approved": "#22c55e", "Pending": "#f59e0b", "Under Review": "#2563eb", "Rejected": "#dc2626", "Unknown": "#94a3b8" };
    destroyChart("asnPoDpe");
    const ctx2 = document.getElementById("asnPoDpeChart");
    if (ctx2) {
        charts.asnPoDpe = new Chart(ctx2, {
            type: "bar",
            data: {
                labels: itemLabels,
                datasets: allPoDpe.map((status, i) => ({
                    label: status,
                    data: itemLabels.map(item => (itemPoDpeMap[item] && itemPoDpeMap[item][status]) || 0),
                    backgroundColor: dpeColors[status] || COLORS[i % COLORS.length],
                    borderRadius: 3,
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { maxRotation: 40, minRotation: 30, font: { size: 11, weight: "500" }, color: "#374151" }, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 12, weight: "600" }, color: "#374151" } }
                },
                plugins: { legend: { position: "bottom", labels: { font: { size: 12, weight: "600" }, padding: 14, color: "#1f2937" } } }
            }
        });
    }

    // Chart 3: Item vs PR DPE Status (stacked)
    const allPrDpe = [...new Set(rows.map(r => String(r["PR DPE STATUS"] || "Unknown").trim()))];
    destroyChart("asnPrDpe");
    const ctx3 = document.getElementById("asnPrDpeChart");
    if (ctx3) {
        charts.asnPrDpe = new Chart(ctx3, {
            type: "bar",
            data: {
                labels: itemLabels,
                datasets: allPrDpe.map((status, i) => ({
                    label: status,
                    data: itemLabels.map(item => (itemPrDpeMap[item] && itemPrDpeMap[item][status]) || 0),
                    backgroundColor: dpeColors[status] || COLORS[i % COLORS.length],
                    borderRadius: 3,
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { maxRotation: 40, minRotation: 30, font: { size: 11, weight: "500" }, color: "#374151" }, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 12, weight: "600" }, color: "#374151" } }
                },
                plugins: { legend: { position: "bottom", labels: { font: { size: 12, weight: "600" }, padding: 14, color: "#1f2937" } } }
            }
        });
    }
}

// ── Stock Report ──────────────────────────────────
function buildStockReport() {
    const rows = sheetData.Stock_Report || [];
    if (!rows.length) return;
    _stockData = rows;

    // Chart: Item vs Quantity (top 12)
    const itemQtyMap = {};
    rows.forEach(r => {
        const item = String(r.Item || "Unknown").trim();
        const qty = Number(r.Quantity || 0);
        itemQtyMap[item] = (itemQtyMap[item] || 0) + qty;
    });
    const top12 = Object.entries(itemQtyMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
    destroyChart("stockItemQty");
    const ctx = document.getElementById("stockItemQtyChart");
    if (ctx) {
        charts.stockItemQty = new Chart(ctx, {
            type: "bar",
            data: {
                labels: top12.map(e => e[0]),
                datasets: [{ label: "Quantity", data: top12.map(e => e[1]), backgroundColor: COLORS, borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => "Qty: " + c.parsed.y.toLocaleString() } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 12, weight: "600" }, color: "#374151" } },
                    x: { ticks: { maxRotation: 40, minRotation: 30, font: { size: 11, weight: "500" }, color: "#374151" }, grid: { display: false } }
                }
            }
        });
    }

    renderStockTable(rows);
}

function renderStockTable(rows) {
    const tbody = document.getElementById("stockReportTableBody");
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:20px">No matching results</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.slice(0, 200).map(r =>
        `<tr><td>${escHtml(String(r.Item_Code || r.ItemCode || "—"))}</td><td>${escHtml(String(r.Quantity ?? "—"))}</td><td>${escHtml(String(r.Description || "—"))}</td><td>${escHtml(String(r["StockValue (₹)"] || r.StockValue || "—"))}</td></tr>`
    ).join("");
}

function filterStockTable() {
    const q = (document.getElementById("stockSearchInput")?.value || "").toLowerCase().trim();
    if (!_stockData.length) return;
    if (!q) { renderStockTable(_stockData); return; }
    const filtered = _stockData.filter(r => {
        const code = String(r.Item_Code || r.ItemCode || "").toLowerCase();
        const item = String(r.Item || "").toLowerCase();
        const desc = String(r.Description || "").toLowerCase();
        return code.includes(q) || item.includes(q) || desc.includes(q);
    });
    renderStockTable(filtered);
}

// ── Monthly Consumption ───────────────────────────
function buildMonthlyConsumption() {
    const rows = sheetData.Monthly_Consumption || [];
    if (!rows.length) return;
    _monthlyData = rows;

    // Chart: Item vs Quantity (top 12)
    const itemQtyMap = {};
    rows.forEach(r => {
        const item = String(r.Item || "Unknown").trim();
        const qty = Number(r.Quantity || 0);
        itemQtyMap[item] = (itemQtyMap[item] || 0) + qty;
    });
    const top12 = Object.entries(itemQtyMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
    destroyChart("monthlyItemQty");
    const ctx = document.getElementById("monthlyItemQtyChart");
    if (ctx) {
        charts.monthlyItemQty = new Chart(ctx, {
            type: "bar",
            data: {
                labels: top12.map(e => e[0]),
                datasets: [{ label: "Quantity", data: top12.map(e => e[1]), backgroundColor: "#2563eb", borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => "Qty: " + c.parsed.y.toLocaleString() } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 12, weight: "600" }, color: "#374151" } },
                    x: { ticks: { maxRotation: 40, minRotation: 30, font: { size: 11, weight: "500" }, color: "#374151" }, grid: { display: false } }
                }
            }
        });
    }

    renderMonthlyTable(rows);
}

function renderMonthlyTable(rows) {
    const tbody = document.getElementById("monthlyConsTableBody");
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:20px">No matching results</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.slice(0, 200).map(r =>
        `<tr><td>${escHtml(String(r.Item_Code || r.ItemCode || "—"))}</td><td>${escHtml(String(r.Quantity ?? "—"))}</td><td>${escHtml(String(r["Usable To Site"] || "—"))}</td><td>${escHtml(String(r["Planning Month"] || "—"))}</td><td>${escHtml(String(r["Date Of Submition"] || r["Date Of Submission"] || "—"))}</td></tr>`
    ).join("");
}

function filterMonthlyTable() {
    const q = (document.getElementById("monthlySearchInput")?.value || "").toLowerCase().trim();
    if (!_monthlyData.length) return;
    if (!q) { renderMonthlyTable(_monthlyData); return; }
    const filtered = _monthlyData.filter(r => {
        const code = String(r.Item_Code || r.ItemCode || "").toLowerCase();
        const item = String(r.Item || "").toLowerCase();
        return code.includes(q) || item.includes(q);
    });
    renderMonthlyTable(filtered);
}

// ── Master Sheet ──────────────────────────────────
function buildMasterSheet() {
    const rows = sheetData.Stock_Open_PO_Transit || [];
    if (!rows.length) return;
    _masterData = rows;
    renderMasterTable(rows);
}

function renderMasterTable(rows) {
    const tbody = document.getElementById("masterSheetTableBody");
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:20px">No matching results</td></tr>`;
        return;
    }
    // Helper to find a value by trying multiple possible column name variants
    const get = (r, ...keys) => {
        for (const k of keys) {
            if (r[k] !== undefined && r[k] !== "" && r[k] !== null) return r[k];
            // also try trimmed version
            const match = Object.keys(r).find(rk => rk.trim() === k.trim());
            if (match && r[match] !== undefined && r[match] !== "" && r[match] !== null) return r[match];
        }
        return "—";
    };
    const fmtNum = v => typeof v === "number" ? Number(v.toFixed(2)).toLocaleString() : String(v);
    const fmtPct = v => typeof v === "number" ? (v < 2 ? (v * 100).toFixed(1) + "%" : v.toFixed(1) + "%") : String(v);

    tbody.innerHTML = rows.slice(0, 300).map(r => {
        const code     = get(r, "Item Code ", "Item Code", "ItemCode");
        const vendor   = get(r, "Vendor");
        const aop      = get(r, "AOP");
        const ordering = get(r, "20-Jan to 31-May Ordering", "20-Jan to 31-May Ordering ", "20 Jan to 31 May Ordering", "20Jan-31May Ordering");
        const aopPct   = get(r, "%AOP Ordering");
        const stock    = get(r, "Stock");
        const trStock  = get(r, "Transit + Stock ", "Transit + Stock");
        const avgCons  = get(r, "Avg Consumption");
        const covTr    = get(r, "Month Coverage with Stock+Transit");
        const covOp    = get(r, "Month Coverage with Stock+ Open Order");

        return `<tr>
            <td><strong>${escHtml(String(code))}</strong></td>
            <td>${escHtml(String(vendor))}</td>
            <td>${escHtml(String(aop))}</td>
            <td>${escHtml(fmtNum(ordering))}</td>
            <td>${escHtml(fmtPct(aopPct))}</td>
            <td>${escHtml(String(stock))}</td>
            <td>${escHtml(String(trStock))}</td>
            <td>${escHtml(fmtNum(avgCons))}</td>
            <td>${escHtml(fmtNum(covTr))}</td>
            <td>${escHtml(fmtNum(covOp))}</td>
        </tr>`;
    }).join("");
}

function filterMasterTable() {
    const q = (document.getElementById("masterSearchInput")?.value || "").toLowerCase().trim();
    if (!_masterData.length) return;
    if (!q) { renderMasterTable(_masterData); return; }
    const filtered = _masterData.filter(r => {
        // Try both "Item Code " (with trailing space) and "Item Code"
        const codeKey = Object.keys(r).find(k => k.trim() === "Item Code") || "Item Code";
        const code = String(r[codeKey] || "").toLowerCase();
        const vendor = String(r.Vendor || "").toLowerCase();
        const desc = String(r.Description || "").toLowerCase();
        return code.includes(q) || vendor.includes(q) || desc.includes(q);
    });
    renderMasterTable(filtered);
}

// ═══════════════════════════════════════════════════
// PO DUMP — Sheet "PO_Dump" (formerly Sheet1)
// Columns shown: PO Number, PO Date, Vendor Name,
// Item Code, Item Description, Qty Ordered,
// Qty Received, Qty Cancelled, Unit Price,
// Total Value in Currency w/o Tax
// ═══════════════════════════════════════════════════

function buildPoDump() {
    const rows = sheetData.PO_Dump || [];
    _poDumpData = rows;
    _poDumpPage = 0;

    const countEl = document.getElementById("poDumpCount");
    if (countEl) countEl.textContent = rows.length ? `(${rows.length.toLocaleString()} rows)` : "";

    renderPoDumpTable(_poDumpData, _poDumpPage);
}

function renderPoDumpTable(rows, page) {
    const tbody = document.getElementById("poDumpTableBody");
    const pager = document.getElementById("poDumpPager");
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:20px">No matching records found</td></tr>`;
        if (pager) pager.innerHTML = "";
        return;
    }

    // Helper: resolve a value from multiple possible column name variants
    const get = (r, ...keys) => {
        for (const k of keys) {
            if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
            const match = Object.keys(r).find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
            if (match && r[match] !== undefined && r[match] !== null && r[match] !== "") return r[match];
        }
        return "—";
    };

    const fmtNum = v => {
        const n = parseFloat(v);
        return isNaN(n) ? (v || "—") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    };
    const fmtCurr = v => {
        const n = parseFloat(v);
        return isNaN(n) ? (v || "—") : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    };

    const start = page * PO_DUMP_PAGE_SIZE;
    const pageRows = rows.slice(start, start + PO_DUMP_PAGE_SIZE);

    tbody.innerHTML = pageRows.map((r, i) => {
        const poNum   = get(r, "PO Number", "PONumber", "PO_Number");
        const poDate  = get(r, "PO Date", "PODate", "PO_Date");
        const vendor  = get(r, "Vendor Name", "VendorName", "Vendor");
        const code    = get(r, "Item Code", "ItemCode", "Item_Code");
        const desc    = get(r, "Item Description", "ItemDescription", "Material", "Description");
        const qOrd    = get(r, "Qty Ordered", "QtyOrdered", "OrderedQty");
        const qRec    = get(r, "Qty Received", "QtyReceived", "ReceivedQty");
        const qCan    = get(r, "Qty Cancelled", "QtyCancelled", "CancelledQty");
        const uPrice  = get(r, "Unit Price", "UnitPrice");
        const totVal  = get(r, "Total Value in Currency w/o Tax", "TotalValue", "POValue");

        const rowClass = (start + i) % 2 === 0 ? "" : " style=\"background:#fafafa\"";
        return `<tr${rowClass}>
            <td><strong>${escHtml(String(poNum))}</strong></td>
            <td>${escHtml(String(poDate))}</td>
            <td>${escHtml(String(vendor))}</td>
            <td><span style="font-weight:600;color:var(--primary)">${escHtml(String(code))}</span></td>
            <td>${escHtml(String(desc))}</td>
            <td style="text-align:right">${escHtml(fmtNum(qOrd))}</td>
            <td style="text-align:right;color:var(--success)">${escHtml(fmtNum(qRec))}</td>
            <td style="text-align:right;color:var(--danger)">${escHtml(fmtNum(qCan))}</td>
            <td style="text-align:right">${escHtml(fmtCurr(uPrice))}</td>
            <td style="text-align:right;font-weight:600">${escHtml(fmtCurr(totVal))}</td>
        </tr>`;
    }).join("");

    // Pagination
    if (pager) {
        const totalPages = Math.ceil(rows.length / PO_DUMP_PAGE_SIZE);
        if (totalPages <= 1) { pager.innerHTML = ""; return; }

        let html = `<span class="page-info">Showing ${start + 1}–${Math.min(start + PO_DUMP_PAGE_SIZE, rows.length)} of ${rows.length.toLocaleString()}</span>`;
        html += `<button class="page-btn" onclick="poDumpGoPage(0)" ${page === 0 ? "disabled" : ""}>«</button>`;
        html += `<button class="page-btn" onclick="poDumpGoPage(${page - 1})" ${page === 0 ? "disabled" : ""}>‹</button>`;

        const start2 = Math.max(0, page - 2);
        const end2   = Math.min(totalPages, start2 + 5);
        for (let p = start2; p < end2; p++) {
            html += `<button class="page-btn${p === page ? " active" : ""}" onclick="poDumpGoPage(${p})">${p + 1}</button>`;
        }
        html += `<button class="page-btn" onclick="poDumpGoPage(${page + 1})" ${page >= totalPages - 1 ? "disabled" : ""}>›</button>`;
        html += `<button class="page-btn" onclick="poDumpGoPage(${totalPages - 1})" ${page >= totalPages - 1 ? "disabled" : ""}>»</button>`;
        pager.innerHTML = html;
    }
}

function poDumpGoPage(p) {
    const q = (document.getElementById("poDumpSearchInput")?.value || "").toLowerCase().trim();
    const data = q ? _poDumpData.filter(r => poDumpMatchRow(r, q)) : _poDumpData;
    const totalPages = Math.ceil(data.length / PO_DUMP_PAGE_SIZE);
    _poDumpPage = Math.max(0, Math.min(p, totalPages - 1));
    renderPoDumpTable(data, _poDumpPage);
}

function poDumpMatchRow(r, q) {
    const get = (r, ...keys) => {
        for (const k of keys) {
            if (r[k] !== undefined && r[k] !== null && r[k] !== "") return String(r[k]);
            const match = Object.keys(r).find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
            if (match && r[match] !== undefined && r[match] !== null && r[match] !== "") return String(r[match]);
        }
        return "";
    };
    const poNum  = get(r, "PO Number", "PONumber", "PO_Number").toLowerCase();
    const code   = get(r, "Item Code", "ItemCode", "Item_Code").toLowerCase();
    const desc   = get(r, "Item Description", "ItemDescription", "Material", "Description").toLowerCase();
    const vendor = get(r, "Vendor Name", "VendorName", "Vendor").toLowerCase();
    return poNum.includes(q) || code.includes(q) || desc.includes(q) || vendor.includes(q);
}

function filterPoDumpTable() {
    if (!_poDumpData.length) return;
    const q = (document.getElementById("poDumpSearchInput")?.value || "").toLowerCase().trim();
    _poDumpPage = 0;
    const filtered = q ? _poDumpData.filter(r => poDumpMatchRow(r, q)) : _poDumpData;

    const countEl = document.getElementById("poDumpCount");
    if (countEl) countEl.textContent = `(${filtered.length.toLocaleString()} rows)`;

    renderPoDumpTable(filtered, 0);
}

console.log("Airtel SCM Platform — PO Analytics loaded.");