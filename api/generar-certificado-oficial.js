export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};

// ==========================================
// API: generar-certificado-oficial (PRO)
// ISO/IEC 17025 + ILAC-G8
// PDFKit + QR + Supabase Storage
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ==== CONFIG SUPABASE ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY; // service role
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ==== BRAND / LOGO ====
const TMP_LOGO_PNG_BASE64 = process.env.TMP_LOGO_PNG_BASE64 || ""; // "iVBORw0KGgoAAA..." sin prefijo data:
const LAB_NAME = process.env.TMP_LAB_NAME || "LABORATORIO TALLERES PARAMIO (TMP)";
const LAB_ADDR = process.env.TMP_LAB_ADDR || "—";
const LAB_CONTACT = process.env.TMP_LAB_CONTACT || "—";
const LAB_SCOPE = process.env.TMP_LAB_SCOPE || "Calibración interna · ISO/IEC 17025 · ILAC-G8";

// ==========================================
// Subir PDF a Supabase Storage
// ==========================================
async function subirPDF(buffer, fileName) {
  const { error: uploadError } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicURL } = supabase.storage
    .from("certificados")
    .getPublicUrl(fileName);

  return publicURL.publicUrl;
}

// ==========================================
// Generar número oficial CC-AAAA-XXXX
// ==========================================
async function generarNumeroCertificado() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("certificados")
    .select("numero")
    .like("numero", `CC-${year}-%`);

  if (error) throw error;

  const nums = (data || []).map((r) => {
    const m = r.numero?.match(/CC-\d+-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });

  const next = (Math.max(0, ...nums) + 1).toString().padStart(4, "0");
  return `CC-${year}-${next}`;
}

// ==========================================
// Helpers de formato / cálculo
// ==========================================
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNum = (v) => (isFiniteNum(v) ? Number(v) : null);

const fmt = (v, dec = 3) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(dec);
};

function mean(arr) {
  const a = (arr || []).map(toNum).filter((x) => x !== null);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function stdevSample(arr) {
  const a = (arr || []).map(toNum).filter((x) => x !== null);
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

// intentamos sacar lecturas desde cualquier clave típica
function pickLecturas(p) {
  const raw =
    p?.repeticiones ??
    p?.lecturas ??
    p?.lecturas_mm ??
    p?.mediciones ??
    p?.r ??
    [];
  const a = Array.isArray(raw) ? raw : [];
  // Normaliza tamaño 5 (R1..R5) sin romper si vienen menos
  return [a[0], a[1], a[2], a[3], a[4]].map(toNum);
}

// convierte mm a µm (1 mm = 1000 µm)
const mmToUm = (vMm) => (vMm === null || vMm === undefined ? null : Number(vMm) * 1000);

// Criterio ILAC-G8 (guard banding)
function decisionILAC(errorUm, UUm, TUm) {
  if (!isFiniteNum(errorUm) || !isFiniteNum(UUm) || !isFiniteNum(TUm)) return "—";
  const E = Math.abs(Number(errorUm));
  const U = Number(UUm);
  const T = Number(TUm);

  if (E + U <= T) return "APTO";
  if (E - U > T) return "NO APTO";
  return "INDETERMINADO";
}

function decisionBadgeColor(dec) {
  if (dec === "APTO") return "#1f8f4a";
  if (dec === "NO APTO") return "#b22b2b";
  if (dec === "INDETERMINADO") return "#9a6b00";
  return "#666666";
}

// ==========================================
// Limpieza DEFINITIVA para guardar en Supabase (evita stack/size)
// - No guardar firma_base64
// - No guardar blobs, ni duplicados enormes
// ==========================================
function limpiarCertJSONParaBD(certJSON, { pdf_url, verificacion_url, numero }) {
  // Copia mínima útil para trazabilidad en BD
  const out = {
    meta: {
      numero,
      pdf_url,
      verificacion_url,
      generado_en: new Date().toISOString(),
      norma: "ISO/IEC 17025 · ILAC-G8",
      version: "pro-1.0"
    },
    instrumento: certJSON.instrumento || {},
    condiciones: certJSON.condiciones || {},
    resumen_global: certJSON.resumen_global || "",
    patrones: Array.isArray(certJSON.patrones) ? certJSON.patrones : [],
    firma: {
      nombre: certJSON.firma?.nombre || "",
      proxima_calibracion: certJSON.firma?.proxima_calibracion || ""
      // ⛔ firma_base64 fuera
    },
    // Guardamos puntos ya “resueltos” sin lecturas para no inflar:
    bloques: (certJSON.bloques || []).map((b) => ({
      tipo: b.tipo,
      lado: b.lado,
      patron: {
        codigo: b.patron?.codigo,
        descripcion: b.patron?.descripcion,
        id: b.patron?.id
      },
      puntos: (b.puntos || []).map((p) => ({
        nominal: p.nominal ?? p.valor_nominal ?? null,
        correccion_patron: p.correccion_patron ?? null,
        media: p.media ?? null,
        sigma: p.sigma ?? null,
        error_um: p.error_um ?? null,
        U_um: p.U_um ?? null,
        T_um: p.T_um ?? null,
        decision: p.decision ?? p.resultado ?? null
      }))
    }))
  };

  return out;
}

// ==========================================
// PDF - utilidades de layout pro
// ==========================================
function makePDF() {
  return new PDFDocument({
    size: "A4",
    margin: 40,
    autoFirstPage: true,
    compress: true
  });
}

function drawHeaderFooter(doc, { numero, hoyISO }) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const mT = doc.page.margins.top;
  const mB = doc.page.margins.bottom;

  const azul = "#0B4EA2";
  const gris = "#444444";
  const naranja = "#F28C1A";

  // Header line
  doc.save();
  doc.strokeColor(naranja).lineWidth(1);
  doc.moveTo(mL, 26).lineTo(pageW - mR, 26).stroke();

  // Logo left
  if (TMP_LOGO_PNG_BASE64) {
    try {
      const buf = Buffer.from(TMP_LOGO_PNG_BASE64, "base64");
      doc.image(buf, mL, 34, { width: 52 });
    } catch (_) {
      // fallback simple
      doc.fillColor(azul).font("Helvetica-Bold").fontSize(14).text("TMP", mL, 38);
    }
  } else {
    doc.fillColor(azul).font("Helvetica-Bold").fontSize(14).text("TMP", mL, 38);
  }

  // Header info
  doc.fillColor(azul).font("Helvetica-Bold").fontSize(9);
  doc.text("CERTIFICADO DE CALIBRACIÓN", mL + 64, 34, { continued: false });

  doc.fillColor(gris).font("Helvetica").fontSize(8);
  doc.text(`Número: ${numero}`, mL + 64, 46);
  doc.text(`Fecha emisión: ${hoyISO}`, mL + 64, 56);

  // Footer
  const footerY = pageH - mB + 12;
  doc.strokeColor("#e6e6e6").lineWidth(1);
  doc.moveTo(mL, pageH - mB - 6).lineTo(pageW - mR, pageH - mB - 6).stroke();

  doc.fillColor("#666").font("Helvetica").fontSize(7);
  doc.text(`${LAB_NAME} · ${LAB_SCOPE}`, mL, footerY, { width: pageW - mL - mR - 90 });
  const page = doc.page.pageNumber;
  doc.text(`Página ${page}`, pageW - mR - 80, footerY, { width: 80, align: "right" });

  doc.restore();

  // reset cursor y for content safe area
  doc.y = Math.max(doc.y, 90);
}

function ensureSpace(doc, needed = 80) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function sectionTitle(doc, n, title) {
  const azul = "#0B4EA2";
  const gris = "#333";

  ensureSpace(doc, 40);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.roundedRect(x, doc.y, w, 18, 4).fillColor(azul).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);
  doc.text(`${n}. ${title}`, x + 8, doc.y + 5, { width: w - 16 });
  doc.restore();

  doc.moveDown(1.2);
  doc.fillColor(gris).font("Helvetica").fontSize(9);
}

function keyValueBlock(doc, rows, { cols = [120, 360] } = {}) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const [kW, vW] = cols;
  const lineH = 14;

  rows.forEach(([k, v]) => {
    ensureSpace(doc, 18);
    doc.font("Helvetica-Bold").fillColor("#1d1d1d").fontSize(8.5);
    doc.text(String(k), x, doc.y, { width: kW, continued: false });
    doc.font("Helvetica").fillColor("#444").fontSize(8.5);
    doc.text(String(v ?? "—"), x + kW, doc.y - lineH + 2, { width: w - kW });
    doc.moveDown(0.4);
  });

  doc.moveDown(0.4);
}

function drawTable(doc, headers, rows, colWidths, options = {}) {
  const azul = "#0B4EA2";
  const gris = "#444444";
  const zebra = "#F4F7FB";
  const border = "#D9E2EF";

  const x = doc.page.margins.left;
  const w = colWidths.reduce((s, v) => s + v, 0);
  const rowH = options.rowHeight ?? 16;
  const headH = options.headerHeight ?? 18;
  const fontSize = options.fontSize ?? 8;

  // Header
  ensureSpace(doc, headH + rowH);

  doc.save();
  doc.roundedRect(x, doc.y, w, headH, 4).fillColor(azul).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fontSize);

  let cx = x;
  headers.forEach((h, i) => {
    doc.text(String(h), cx + 4, doc.y + 5, { width: colWidths[i] - 8, align: "center" });
    cx += colWidths[i];
  });
  doc.restore();

  doc.y += headH;

  // Rows
  rows.forEach((r, idx) => {
    ensureSpace(doc, rowH + 6);

    if (idx % 2 === 0) {
      doc.save();
      doc.rect(x, doc.y, w, rowH).fillColor(zebra).fill();
      doc.restore();
    }

    // Borders
    doc.save();
    doc.strokeColor(border).lineWidth(0.7);
    doc.rect(x, doc.y, w, rowH).stroke();
    doc.restore();

    doc.font("Helvetica").fillColor(gris).fontSize(fontSize);

    let cx2 = x;
    r.forEach((cell, i) => {
      doc.text(String(cell ?? ""), cx2 + 4, doc.y + 4, {
        width: colWidths[i] - 8,
        align: options.align?.[i] ?? "center"
      });
      cx2 += colWidths[i];
    });

    doc.y += rowH;
  });

  doc.moveDown(0.8);
}

// ==========================================
// Normalizar puntos (para que SIEMPRE haya datos)
// - R1..R5 desde cualquier campo
// - media/sigma si faltan, se calculan
// - error/U/T/decision si faltan, se calculan con fallback
// ==========================================
function normalizeCertData(certJSON) {
  const cfg = certJSON.config || {};
  // fallback si el frontend no envía config:
  const tolMm = toNum(cfg.tol_global_mm ?? cfg.tol_mm ?? null);
  const uBaseMm = toNum(cfg.u_base_mm ?? cfg.u_mm ?? null);

  const bloques = Array.isArray(certJSON.bloques) ? certJSON.bloques : [];

  let globalStats = {
    totalPuntos: 0,
    maxAbsE: 0,
    maxAbsEplusU: 0,
    decisionGlobal: "APTO"
  };

  const normBloques = bloques.map((b) => {
    const puntos = Array.isArray(b.puntos) ? b.puntos : [];

    const normPuntos = puntos.map((p) => {
      const nominal = toNum(p.nominal ?? p.valor_nominal ?? p.nominal_mm ?? null);

      const r = pickLecturas(p); // [R1..R5] numeritos o null
      const m = toNum(p.media) ?? mean(r);
      const s = toNum(p.sigma) ?? toNum(p.desviacion) ?? stdevSample(r);

      // Error µm: si viene, lo usamos; si no, calculamos (media - nominal)*1000
      const errorUm =
        toNum(p.error_um) ??
        toNum(p.error) ??
        (m !== null && nominal !== null ? (m - nominal) * 1000 : null);

      // U µm: si viene, lo usamos; si no, u_base_mm*1000
      const UUm =
        toNum(p.U_um) ??
        toNum(p.U_total_um) ??
        toNum(p.U_total) ??
        (uBaseMm !== null ? uBaseMm * 1000 : null);

      // T µm: si viene, lo usamos; si no, tol_mm*1000
      const TUm =
        toNum(p.T_um) ??
        toNum(p.tolerancia_um) ??
        toNum(p.tolerancia) ??
        (tolMm !== null ? tolMm * 1000 : null);

      const decision = (p.decision || p.resultado) ?? decisionILAC(errorUm, UUm, TUm);

      // global stats
      if (isFiniteNum(errorUm)) {
        const absE = Math.abs(Number(errorUm));
        globalStats.maxAbsE = Math.max(globalStats.maxAbsE, absE);
        if (isFiniteNum(UUm)) globalStats.maxAbsEplusU = Math.max(globalStats.maxAbsEplusU, absE + Number(UUm));
      }
      globalStats.totalPuntos += 1;

      if (decision === "NO APTO") globalStats.decisionGlobal = "NO APTO";
      else if (decision === "INDETERMINADO" && globalStats.decisionGlobal !== "NO APTO") globalStats.decisionGlobal = "INDETERMINADO";

      return {
        ...p,
        nominal,
        R: r,
        media: m,
        sigma: s,
        error_um: errorUm,
        U_um: UUm,
        T_um: TUm,
        decision
      };
    });

    return { ...b, puntos: normPuntos };
  });

  return { ...certJSON, bloques: normBloques, _globalStats: globalStats };
}

// ==========================================
// Generar PDF PRO (portada + secciones + anexos)
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = makePDF();
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const hoyISO = new Date().toISOString().slice(0, 10);

  // Normaliza data (R1..R5, etc.)
  const cert = normalizeCertData(certJSON);

  const azul = "#0B4EA2";
  const naranja = "#F28C1A";
  const gris = "#444444";

  const urlVerif = cert.qr?.url_verificacion || "";

  // QR
  let qrBuffer = null;
  if (urlVerif) {
    try {
      qrBuffer = await QRCode.toBuffer(urlVerif, { errorCorrectionLevel: "M" });
    } catch (_) {
      qrBuffer = null;
    }
  }

  // Cabecera/Pie en cada página
  const paintHF = () => drawHeaderFooter(doc, { numero, hoyISO });
  paintHF();
  doc.on("pageAdded", () => {
    paintHF();
  });

  // ===== PORTADA PRO =====
  // Bloque título grande
  ensureSpace(doc, 120);

  doc.fillColor(azul).font("Helvetica-Bold").fontSize(18);
  doc.text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });
  doc.moveDown(0.2);
  doc.fillColor(gris).font("Helvetica").fontSize(10);
  doc.text(`Número: ${numero}`, { align: "center" });
  doc.text(`Fecha de emisión: ${hoyISO}`, { align: "center" });

  // Caja datos lab + QR
  doc.moveDown(1);
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.roundedRect(x, doc.y, w, 86, 6).fillColor("#F4F7FB").fill();
  doc.restore();

  doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(10);
  doc.text(LAB_NAME, x + 12, doc.y + 10);
  doc.fillColor(gris).font("Helvetica").fontSize(8.5);
  doc.text(`Dirección: ${LAB_ADDR}`, x + 12, doc.y + 26);
  doc.text(`Contacto: ${LAB_CONTACT}`, x + 12, doc.y + 40);
  doc.text(`Alcance: ${LAB_SCOPE}`, x + 12, doc.y + 54, { width: w - 120 });

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, x + w - 92, doc.y + 12, { width: 72, height: 72 });
      doc.fillColor("#666").fontSize(7);
      doc.text("Verificación", x + w - 92, doc.y + 86, { width: 72, align: "center" });
    } catch (_) {}
  }

  doc.y += 98;

  // Nota legal compacta
  doc.fillColor("#666").font("Helvetica-Oblique").fontSize(7.2);
  doc.text(
    "Este certificado se emite bajo buenas prácticas metrológicas, conforme a ISO/IEC 17025 y regla de decisión ILAC-G8. " +
      "La reproducción parcial requiere autorización del laboratorio.",
    { align: "justify" }
  );

  // ===== 1. Datos del instrumento =====
  sectionTitle(doc, 1, "Datos del instrumento");
  const ins = cert.instrumento || {};
  keyValueBlock(doc, [
    ["Código", ins.codigo || "—"],
    ["Descripción", ins.descripcion || "—"],
    ["Fabricante / Tipo", ins.fabricante_tipo || "—"],
    ["Rango", ins.rango || "—"],
    ["Unidad base", ins.unidad_base || "—"],
  ]);

  // ===== 2. Condiciones ambientales =====
  sectionTitle(doc, 2, "Condiciones ambientales durante la calibración");
  const cond = cert.condiciones || {};
  keyValueBlock(doc, [
    ["Temperatura (°C)", cond.temperatura ?? "—"],
    ["Humedad relativa (%)", cond.humedad ?? "—"],
    ["Fecha de calibración", cond.fecha_calibracion ?? "—"],
  ]);
  if (cond.observaciones) {
    ensureSpace(doc, 40);
    doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(8.5).text("Observaciones:");
    doc.fillColor(gris).font("Helvetica").fontSize(8.5).text(String(cond.observaciones), { align: "justify" });
    doc.moveDown(0.6);
  }

  // ===== 3. Trazabilidad y patrones =====
  sectionTitle(doc, 3, "Trazabilidad metrológica y patrones utilizados");
  doc.fillColor(gris).font("Helvetica").fontSize(9).text(
    "La trazabilidad metrológica se garantiza mediante el uso de patrones materializados controlados en el sistema del laboratorio. " +
      "Las correcciones indicadas proceden del certificado del patrón o, en su caso, de interpolación aplicada por el laboratorio. " +
      "La incertidumbre declarada corresponde a la incertidumbre expandida U(k=2) con nivel de confianza aproximado del 95%.",
    { align: "justify" }
  );
  doc.moveDown(0.6);

  const patrones = Array.isArray(cert.patrones) ? cert.patrones : [];
  if (patrones.length) {
    const headers = ["Código", "Descripción", "U(k=2)"];
    const colW = [90, 330, 90];
    const rows = patrones.map((p) => [
      p.codigo ?? p.id ?? "—",
      p.descripcion ?? "—",
      p.u_k2 ?? "—",
    ]);
    drawTable(doc, headers, rows, colW, { fontSize: 8, align: ["left", "left", "center"] });
  } else {
    doc.fillColor("#666").font("Helvetica-Oblique").fontSize(8).text("No se recibieron patrones en el JSON.");
    doc.moveDown(0.6);
  }

  // ===== 4. Método y regla de decisión =====
  sectionTitle(doc, 4, "Método de calibración y regla de decisión");
  doc.fillColor(gris).font("Helvetica").fontSize(9).text(
    "Para cada punto se registran lecturas repetidas (R1…R5) con el objetivo de estimar repetibilidad (σ) y obtener la media. " +
      "El error se expresa en µm y se evalúa con la incertidumbre expandida U(k=2). Se aplica la regla de decisión ILAC-G8: " +
      "|E| + U ≤ T → APTO; |E| − U > T → NO APTO; resto → INDETERMINADO.",
    { align: "justify" }
  );
  doc.moveDown(0.6);

  // ===== 5. Resultados (resumen global) =====
  sectionTitle(doc, 5, "Resultados de la calibración (resumen global)");
  const gs = cert._globalStats || {};
  const resumenTxt =
    cert.resumen_global ||
    `Puntos evaluados: ${gs.totalPuntos ?? "—"} · Máx |E| (µm): ${fmt(gs.maxAbsE, 1)} · Máx (|E|+U) (µm): ${fmt(gs.maxAbsEplusU, 1)} · Decisión global: ${gs.decisionGlobal || "—"}`;

  const decCol = decisionBadgeColor(gs.decisionGlobal);
  ensureSpace(doc, 60);

  doc.save();
  doc.roundedRect(doc.page.margins.left, doc.y, w, 54, 6).fillColor("#FFFFFF").strokeColor("#D9E2EF").lineWidth(1).stroke();
  doc.fillColor(gris).font("Helvetica").fontSize(8.8);
  doc.text(resumenTxt, doc.page.margins.left + 12, doc.y + 10, { width: w - 140, align: "justify" });

  // Badge decisión
  const badgeX = doc.page.margins.left + w - 110;
  const badgeY = doc.y + 16;
  doc.roundedRect(badgeX, badgeY, 98, 28, 8).fillColor(decCol).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text(gs.decisionGlobal || "—", badgeX, badgeY + 7, { width: 98, align: "center" });
  doc.restore();

  doc.y += 64;

  // ===== 6. Validación =====
  sectionTitle(doc, 6, "Validación del certificado");
  const firma = cert.firma || {};

  ensureSpace(doc, 90);
  const boxY = doc.y;
  doc.save();
  doc.roundedRect(x, boxY, w, 86, 6).strokeColor("#D9E2EF").lineWidth(1).stroke();
  doc.restore();

  doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(9);
  doc.text("Responsable", x + 12, boxY + 10);
  doc.fillColor(gris).font("Helvetica").fontSize(9);
  doc.text(firma.nombre || "—", x + 120, boxY + 10);

  doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(9);
  doc.text("Próxima calibración", x + 12, boxY + 30);
  doc.fillColor(gris).font("Helvetica").fontSize(9);
  doc.text(firma.proxima_calibracion || "—", x + 120, boxY + 30);

  // Firma manuscrita dentro del PDF (SI)
  if (firma.firma_base64) {
    try {
      const img = String(firma.firma_base64).replace(/^data:image\/png;base64,/, "");
      const buf = Buffer.from(img, "base64");
      doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(9);
      doc.text("Firma", x + 12, boxY + 52);

      doc.image(buf, x + 120, boxY + 48, { fit: [160, 36] });
    } catch (_) {
      doc.fillColor("#b22b2b").font("Helvetica").fontSize(8).text("(No se pudo insertar la firma)", x + 120, boxY + 52);
    }
  } else {
    doc.fillColor("#666").font("Helvetica-Oblique").fontSize(8).text("(Firma no incluida en el JSON)", x + 120, boxY + 52);
  }

  doc.y = boxY + 98;

  // ===== 7. Verificación =====
  sectionTitle(doc, 7, "Verificación del certificado");
  doc.fillColor(gris).font("Helvetica").fontSize(8.6);
  doc.text(
    urlVerif ? `Este certificado puede verificarse mediante el código QR o en: ${urlVerif}` : "URL de verificación no disponible.",
    { align: "justify" }
  );
  doc.moveDown(0.5);

  // ================================
  // ANEXO METROLÓGICO (TABLAS PRO)
  // ================================
  doc.addPage();
  paintHF();

  doc.fillColor(azul).font("Helvetica-Bold").fontSize(12);
  doc.text("ANEXO METROLÓGICO · RESULTADOS DETALLADOS", { align: "center" });
  doc.moveDown(0.4);
  doc.strokeColor(naranja).lineWidth(1);
  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).stroke();
  doc.moveDown(1);

  const bloques = Array.isArray(cert.bloques) ? cert.bloques : [];
  bloques.forEach((b, idxB) => {
    ensureSpace(doc, 90);

    const patronTxt = `${b.patron?.codigo || "—"} · ${b.patron?.descripcion || "—"}`;
    doc.fillColor("#1d1d1d").font("Helvetica-Bold").fontSize(10);
    doc.text(`Bloque ${idxB + 1} · ${b.tipo || "—"}`, { align: "left" });

    doc.fillColor(gris).font("Helvetica").fontSize(8.5);
    doc.text(`Patrón: ${patronTxt}`);
    doc.text(`Lado: ${b.lado || "—"}`);
    doc.moveDown(0.6);

    const puntos = Array.isArray(b.puntos) ? b.puntos : [];

    // ---- TABLA LECTURAS ----
    const headersL = ["Nominal (mm)", "R1", "R2", "R3", "R4", "R5", "Media", "σ"];
    const colL = [74, 50, 50, 50, 50, 50, 66, 50]; // total 440 aprox
    const rowsL = puntos.map((p) => {
      const R = p.R || pickLecturas(p);
      return [
        fmt(p.nominal, 3),
        fmt(R?.[0], 3),
        fmt(R?.[1], 3),
        fmt(R?.[2], 3),
        fmt(R?.[3], 3),
        fmt(R?.[4], 3),
        fmt(p.media, 3),
        fmt(p.sigma, 3),
      ];
    });

    doc.fillColor(azul).font("Helvetica-Bold").fontSize(9);
    doc.text("Tabla A · Lecturas y estadísticos", { align: "left" });
    doc.moveDown(0.2);
    drawTable(doc, headersL, rowsL, colL, { fontSize: 7.8 });

    // ---- TABLA RESULTADOS METROLÓGICOS ----
    const headersR = ["Nominal (mm)", "Corr (µm)", "Error (µm)", "U(k=2) (µm)", "T (µm)", "Decisión"];
    const colR = [86, 76, 76, 86, 66, 90];

    const rowsR = puntos.map((p) => {
      const corrUm =
        isFiniteNum(p.correccion_um)
          ? Number(p.correccion_um)
          : isFiniteNum(p.correccion_patron)
            ? Number(p.correccion_patron) * 1000
            : null;

      const dec = p.decision ?? decisionILAC(p.error_um, p.U_um, p.T_um);

      return [
        fmt(p.nominal, 3),
        fmt(corrUm, 1),
        fmt(p.error_um, 1),
        fmt(p.U_um, 1),
        fmt(p.T_um, 1),
        dec
      ];
    });

    doc.fillColor(azul).font("Helvetica-Bold").fontSize(9);
    doc.text("Tabla B · Resultados metrológicos (ILAC-G8)", { align: "left" });
    doc.moveDown(0.2);

    // tabla con color de decisión en la última columna (render simple: texto, y luego pintamos “chips” encima si cabe)
    drawTable(doc, headersR, rowsR, colR, { fontSize: 7.8 });

    // Nota por bloque
    doc.fillColor("#666").font("Helvetica-Oblique").fontSize(7.2);
    doc.text(
      "Nota: la decisión se ha evaluado con el criterio ILAC-G8 usando error E en µm, incertidumbre expandida U(k=2) y tolerancia T.",
      { align: "justify" }
    );
    doc.moveDown(1);
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://trazabilidad-tmp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const certJSON = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1) Número oficial
    const numero = await generarNumeroCertificado();

    // 2) URL verificación
    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3) Generar PDF PRO
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4) Subir PDF a Storage
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5) Decisión global (si viene en resumen, respétala; si no, la calculamos)
    const certNorm = normalizeCertData(certJSON);
    const resumenTxt = certJSON.resumen_global || "";
    let decisionGlobal = certNorm._globalStats?.decisionGlobal || "APTO";
    if (resumenTxt.includes("NO APTO")) decisionGlobal = "NO APTO";
    else if (resumenTxt.includes("INDETERMINADO")) decisionGlobal = "INDETERMINADO";

    // 6) Guardar en Supabase (JSON limpio, sin firma_base64)
    const datosParaBD = limpiarCertJSONParaBD(certJSON, {
      pdf_url: pdfURL,
      verificacion_url: verificacionURL,
      numero
    });

    const { error: insErr } = await supabase.from("certificados").insert({
      numero,
      datos: datosParaBD,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: decisionGlobal
    });

    if (insErr) throw insErr;

    // 7) Respuesta frontend
    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verificacionURL
      }
    });
  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
