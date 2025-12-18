// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ==== CONFIG SUPABASE ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY; // service role
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ==========================================
// Utilidad para subir PDF a Supabase Storage
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
// Generar número oficial de certificado
// CC-2025-0001, CC-2025-0002…
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
// Helpers
// ==========================================
const safeStr = (v) => (v === null || v === undefined ? "" : String(v));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v, dec = 3) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(dec);
};

const fmtInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : "—";
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const parseBase64Png = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return null;
  try {
    return Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
};

function pickLecturas(p) {
  // Acepta TODOS los formatos posibles, incluyendo tu JSON actual
  const a =
    p?.lecturas ||
    p?.lecturas_mm ||
    p?.mediciones ||
    p?.repeticiones || // <-- TU JSON
    p?.repeticiones_mm ||
    [];
  if (!Array.isArray(a)) return [];
  return a.map((x) => {
    const n = Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  });
}

function pickNominalMm(p) {
  const candidates = [
    p?.nominal,
    p?.valor_nominal,
    p?.nominal_mm,
    p?.nominal_patron,
  ];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

function pickSigmaMm(p) {
  const candidates = [p?.sigma, p?.s, p?.desviacion, p?.std];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

function pickMediaMm(p) {
  const candidates = [p?.media, p?.mean, p?.media_mm];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  // si no hay media, la calculamos de lecturas válidas
  const lect = pickLecturas(p).filter((x) => typeof x === "number");
  if (!lect.length) return null;
  return lect.reduce((a, b) => a + b, 0) / lect.length;
}

function pickErrorUm(p) {
  const candidates = [p?.error_um, p?.error, p?.E_um, p?.E];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

function pickUUm(p) {
  const candidates = [
    p?.U_um,
    p?.U_total_um,
    p?.U_total,
    p?.u_um,
    p?.u_total_um,
  ];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

function pickTUm(p) {
  const candidates = [p?.T_um, p?.tolerancia_um, p?.tolerancia, p?.T];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

function decisionILAC_G8(errorUm, UUm, TUm) {
  if (
    typeof errorUm !== "number" ||
    typeof UUm !== "number" ||
    typeof TUm !== "number"
  ) {
    return null;
  }
  const absE = Math.abs(errorUm);
  if (absE + UUm <= TUm) return "APTO";
  if (absE - UUm > TUm) return "NO APTO";
  return "INDETERMINADO";
}

function pickDecision(p) {
  const d = safeStr(p?.decision || p?.resultado || p?.conformidad).trim();
  if (d) return d.toUpperCase();
  const e = pickErrorUm(p);
  const U = pickUUm(p);
  const T = pickTUm(p);
  return decisionILAC_G8(e, U, T);
}

// ==========================================
// Generar PDF oficial (MUCHO más limpio y robusto)
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    info: {
      Title: `Certificado ${numero}`,
      Author: "TMP Calibration System",
      Subject: "Certificado de calibración",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  // ======= Estética (laboratorio) =======
  const C = {
    azul: "#0B4EA2",
    azulOscuro: "#083B78",
    naranja: "#F28C1A",
    grisFondo: "#F4F7FB",
    grisLinea: "#D9E2EF",
    grisTexto: "#2C2C2C",
    grisSec: "#5A6A7A",
    ok: "#1E9E5B",
    bad: "#C0392B",
    warn: "#B07D00",
  };

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const mT = doc.page.margins.top;
  const mB = doc.page.margins.bottom;
  const contentW = pageW - mL - mR;

  // ======= QR =======
  const hoyISO = new Date().toISOString().slice(0, 10);
  const urlVerif = certJSON?.qr?.url_verificacion || "";
  let qrBuffer = null;
  if (urlVerif) {
    try {
      qrBuffer = await QRCode.toBuffer(urlVerif, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 6,
      });
    } catch (e) {
      console.error("Error generando QR:", e);
    }
  }

  // ======= Logo/sello opcional (si algún día lo metéis en JSON) =======
  // - certJSON.meta.logo_base64 (png dataURL)
  // - certJSON.instrumento.logo_base64 (png dataURL)
  const logoBuf =
    parseBase64Png(certJSON?.meta?.logo_base64) ||
    parseBase64Png(certJSON?.instrumento?.logo_base64) ||
    null;

  // ======= Header/Footer consistentes =======
  function header() {
    // banda superior
    const y = mT - 28;
    doc.save();
    doc
      .rect(0, 0, pageW, 76)
      .fillColor("#ffffff")
      .fill();

    doc
      .rect(0, 66, pageW, 3)
      .fillColor(C.naranja)
      .fill();

    // “marca”
    const logoX = mL;
    const logoY = 18;

    if (logoBuf) {
      try {
        doc.image(logoBuf, logoX, logoY, { width: 44, height: 44 });
      } catch {
        // si fallase, caemos al texto
        doc
          .font("Helvetica-Bold")
          .fillColor(C.azulOscuro)
          .fontSize(12)
          .text("TMP", logoX, logoY + 12);
      }
    } else {
      doc
        .roundedRect(logoX, logoY, 44, 44, 6)
        .fillColor(C.azul)
        .fill();
      doc
        .font("Helvetica-Bold")
        .fillColor("#ffffff")
        .fontSize(14)
        .text("TMP", logoX, logoY + 14, { width: 44, align: "center" });
    }

    // título
    doc
      .font("Helvetica-Bold")
      .fillColor(C.azulOscuro)
      .fontSize(16)
      .text("CERTIFICADO DE CALIBRACIÓN", logoX + 56, 20);

    doc
      .font("Helvetica")
      .fillColor(C.grisSec)
      .fontSize(9)
      .text(`Número: ${numero}`, logoX + 56, 42)
      .text(`Fecha de emisión: ${hoyISO}`, logoX + 56, 54);

    // QR top-right
    if (qrBuffer) {
      const s = 58;
      const x = pageW - mR - s;
      const yQr = 16;
      try {
        doc.image(qrBuffer, x, yQr, { width: s, height: s });
        doc
          .fontSize(7)
          .fillColor(C.grisSec)
          .text("Verificación", x, yQr + s + 2, {
            width: s,
            align: "center",
          });
      } catch {}
    }

    doc.restore();
    doc.y = 90;
  }

  function footer() {
    doc.save();
    const y = pageH - mB + 12;

    doc
      .moveTo(mL, y)
      .lineTo(pageW - mR, y)
      .lineWidth(1)
      .strokeColor(C.grisLinea)
      .stroke();

    const pageNum = doc.page?.number || 1;
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.grisSec)
      .text(
        `ISO/IEC 17025 · ILAC-G8 · TMP · Página ${pageNum}`,
        mL,
        y + 6,
        { width: contentW, align: "right" }
      );

    doc.restore();
  }

  // añade header/footer por página
  header();
  footer();
  doc.on("pageAdded", () => {
    header();
    footer();
  });

  function ensureSpace(h = 80) {
    const bottom = pageH - mB - 24;
    if (doc.y + h > bottom) doc.addPage();
  }

  function sectionTitle(n, text) {
    ensureSpace(40);
    const x = mL;
    const y = doc.y;

    doc
      .roundedRect(x, y, contentW, 18, 4)
      .fillColor(C.azul)
      .fill();

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#ffffff")
      .text(`${n}. ${text}`, x + 8, y + 4, {
        width: contentW - 16,
      });

    doc.moveDown(1.4);
    doc.fillColor(C.grisTexto).font("Helvetica").fontSize(9);
  }

  // ========= Tabla bonita (centrada y legible) =========
  function drawTable({
    title,
    headers,
    rows,
    colWidths,
    fontSize = 7.8,
    headerFontSize = 8,
    rowH = 14,
    headerH = 16,
    zebra = true,
  }) {
    if (!rows?.length) return;

    ensureSpace(60);
    if (title) {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(C.azulOscuro)
        .text(title, mL, doc.y, { width: contentW });
      doc.moveDown(0.3);
    }

    const tableW = colWidths.reduce((a, b) => a + b, 0);
    const x = mL + (contentW - tableW) / 2;
    let y = doc.y;

    // header background
    doc
      .roundedRect(x - 2, y - 2, tableW + 4, headerH + 4, 4)
      .fillColor(C.azul)
      .fill();

    // headers
    doc
      .font("Helvetica-Bold")
      .fillColor("#ffffff")
      .fontSize(headerFontSize);

    let cx = x;
    headers.forEach((h, i) => {
      doc.text(String(h), cx + 2, y + 2, {
        width: colWidths[i] - 4,
        align: "center",
      });
      cx += colWidths[i];
    });

    y += headerH + 6;

    // rows
    rows.forEach((r, idx) => {
      ensureSpace(rowH + 18);
      if (doc.y !== y) y = doc.y;

      if (zebra) {
        doc
          .rect(x - 2, y - 2, tableW + 4, rowH + 3)
          .fillColor(idx % 2 === 0 ? C.grisFondo : "#ffffff")
          .fill();
      }

      doc.font("Helvetica").fillColor(C.grisTexto).fontSize(fontSize);

      let cx2 = x;
      r.forEach((cell, ci) => {
        const align = ci === 0 ? "left" : "center";
        doc.text(cell === null || cell === undefined ? "" : String(cell), cx2 + 2, y, {
          width: colWidths[ci] - 4,
          align,
        });
        cx2 += colWidths[ci];
      });

      y += rowH;
      doc.y = y;
    });

    doc.moveDown(0.8);
  }

  // ==========================================
  // PORTADA / PÁGINA 1
  // ==========================================
  const ins = certJSON?.instrumento || {};
  const cond = certJSON?.condiciones || {};
  const firma = certJSON?.firma || {};
  const patrones = certJSON?.patrones || [];
  const resumenGlobalTxt =
    certJSON?.resumen_global ||
    "Se han evaluado los puntos definidos en el plan de calibración.";

  // 1. Instrumento
  sectionTitle(1, "Datos del instrumento");
  doc
    .fontSize(9)
    .fillColor(C.grisTexto)
    .text(`ID: ${safeStr(ins.id || "—")}`)
    .text(`Código: ${safeStr(ins.codigo || "—")}`)
    .text(`Descripción: ${safeStr(ins.descripcion || "—")}`)
    .text(`Fabricante / Tipo: ${safeStr(ins.fabricante_tipo || "—")}`)
    .text(`Rango: ${safeStr(ins.rango || "—")}`)
    .text(`Unidad base: ${safeStr(ins.unidad_base || "—")}`);

  // 2. Condiciones
  sectionTitle(2, "Condiciones ambientales durante la calibración");
  doc
    .fontSize(9)
    .text(`Temperatura: ${cond.temperatura ?? "—"} °C`)
    .text(`Humedad relativa: ${cond.humedad ?? "—"} %`)
    .text(`Fecha de calibración: ${cond.fecha_calibracion ?? "—"}`);

  if (safeStr(cond.observaciones).trim()) {
    doc.moveDown(0.3);
    doc.fillColor(C.grisSec).font("Helvetica-Oblique").fontSize(8);
    doc.text(`Observaciones: ${safeStr(cond.observaciones).trim()}`, {
      width: contentW,
      align: "justify",
    });
    doc.fillColor(C.grisTexto).font("Helvetica").fontSize(9);
  }

  // 3. Trazabilidad
  sectionTitle(3, "Trazabilidad metrológica y patrones utilizados");
  doc
    .fontSize(9)
    .fillColor(C.grisTexto)
    .text(
      "La trazabilidad metrológica se garantiza mediante el uso de patrones materializados con trazabilidad al SI " +
        "siguiendo buenas prácticas metrológicas y guías ISO/IEC 17025."
    );

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fillColor(C.azulOscuro).text("Patrones empleados:");
  doc.font("Helvetica").fillColor(C.grisTexto);

  if (patrones.length) {
    patrones.forEach((p) => {
      doc
        .fontSize(9)
        .text(
          `• ${safeStr(p.codigo || p.id || "—")} — ${safeStr(p.descripcion || "—")} ` +
            `(U(k=2): ${p.u_k2 ?? "—"})`
        );
    });
  } else {
    doc.fontSize(9).fillColor(C.grisSec).text("— No informado —");
    doc.fillColor(C.grisTexto);
  }

  // 4. Resultados resumen
  sectionTitle(4, "Resultados de la calibración (resumen)");
  doc.fontSize(9).fillColor(C.grisTexto).text(resumenGlobalTxt, {
    width: contentW,
    align: "justify",
  });

  // 5. Validación
  sectionTitle(5, "Validación del certificado");
  ensureSpace(90);

  const boxX = mL;
  const boxW = contentW;
  const boxY = doc.y;
  const boxH = 78;

  // caja
  doc
    .roundedRect(boxX, boxY, boxW, boxH, 6)
    .strokeColor(C.grisLinea)
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C.grisTexto)
    .text(`Operario responsable: ${safeStr(firma.nombre || "—")}`, boxX + 10, boxY + 10)
    .text(`Próxima calibración: ${safeStr(firma.proxima_calibracion || "—")}`, boxX + 10, boxY + 26);

  // firma manuscrita
  const firmaBuf = parseBase64Png(firma.firma_base64);
  if (firmaBuf) {
    try {
      doc.image(firmaBuf, boxX + 10, boxY + 42, { fit: [160, 28] });
    } catch {
      doc
        .font("Helvetica-Oblique")
        .fontSize(8)
        .fillColor(C.bad)
        .text("(No se pudo insertar la firma)", boxX + 10, boxY + 48);
      doc.fillColor(C.grisTexto);
    }
  } else {
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor(C.grisSec)
      .text("(Firma no aportada)", boxX + 10, boxY + 48);
    doc.fillColor(C.grisTexto);
  }

  // sello a la derecha
  const selloR = 26;
  const selloCX = boxX + boxW - selloR - 12;
  const selloCY = boxY + boxH / 2;

  doc
    .circle(selloCX, selloCY, selloR)
    .lineWidth(1.5)
    .strokeColor(C.naranja)
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor(C.azulOscuro)
    .text("LABORATORIO\nTALLERES\nPARAMIO", selloCX - selloR + 4, selloCY - 14, {
      width: selloR * 2 - 8,
      align: "center",
      lineGap: 1,
    });

  doc.moveDown(6);

  // 6. Verificación
  sectionTitle(6, "Verificación del certificado");
  doc.fontSize(8).fillColor(C.grisTexto).text(
    urlVerif ? `Este certificado puede verificarse en: ${urlVerif}` : "URL de verificación no disponible.",
    { width: contentW }
  );

  doc.moveDown(0.8);
  doc
    .fontSize(6.8)
    .fillColor(C.grisSec)
    .text(
      "Este certificado ha sido emitido por el laboratorio interno de Talleres Mecánicos Paramio " +
        "siguiendo los principios ISO/IEC 17025 e ILAC-G8. La reproducción parcial no está permitida sin autorización.",
      { width: contentW, align: "justify" }
    );

  // ==========================================
  // ANEXO: RESULTADOS DETALLADOS
  // ==========================================
  const bloques = certJSON?.bloques || [];
  if (bloques.length) {
    doc.addPage();

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(C.azulOscuro)
      .text("ANEXO METROLÓGICO · RESULTADOS DETALLADOS", {
        align: "center",
      });

    doc.moveDown(0.4);
    doc
      .moveTo(mL, doc.y)
      .lineTo(pageW - mR, doc.y)
      .lineWidth(1)
      .strokeColor(C.naranja)
      .stroke();

    doc.moveDown(1);

    bloques.forEach((b, idxBloque) => {
      ensureSpace(120);

      // Encabezado del bloque (bonito)
      doc
        .roundedRect(mL, doc.y, contentW, 22, 6)
        .fillColor(C.grisFondo)
        .fill();

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(C.azulOscuro)
        .text(
          `Bloque ${idxBloque + 1} · ${safeStr(b.tipo || "—")} · Patrón ${safeStr(
            b?.patron?.codigo || b?.patron?.id || "—"
          )}`,
          mL + 10,
          doc.y + 6,
          { width: contentW - 20 }
        );

      doc.moveDown(2);

      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(C.grisTexto)
        .text(
          `Descripción patrón: ${safeStr(b?.patron?.descripcion || "—")}`,
          { width: contentW }
        )
        .text(`Lado GO/NO GO: ${safeStr(b.lado || "—")}`, { width: contentW });

      doc.moveDown(0.6);

      const puntos = Array.isArray(b.puntos) ? b.puntos : [];

      // ===== Tabla 1: Lecturas (R1..R5) =====
      const headersLect = ["Nominal (mm)", "R1", "R2", "R3", "R4", "R5", "Media", "σ"];
      const colLect = [78, 46, 46, 46, 46, 46, 64, 60];

      const rowsLect = puntos.map((p) => {
        const lect = pickLecturas(p);
        const media = pickMediaMm(p);
        const sigma = pickSigmaMm(p);

        const r = [0, 1, 2, 3, 4].map((i) => {
          const v = lect[i];
          return v === null || v === undefined ? "—" : fmt(v, 3);
        });

        return [
          pickNominalMm(p) === null ? "—" : fmt(pickNominalMm(p), 3),
          r[0],
          r[1],
          r[2],
          r[3],
          r[4],
          media === null ? "—" : fmt(media, 3),
          sigma === null ? "—" : fmt(sigma, 3),
        ];
      });

      drawTable({
        title: "Tabla 1 · Lecturas individuales y estadísticos",
        headers: headersLect,
        rows: rowsLect,
        colWidths: colLect,
        fontSize: 7.6,
        headerFontSize: 8,
        rowH: 14,
        headerH: 16,
      });

      // ===== Tabla 2: Resultados metrológicos =====
      const headersRes = ["Nominal (mm)", "Corr (µm)", "Error (µm)", "U(k=2) (µm)", "T (µm)", "Decisión"];
      const colRes = [92, 74, 74, 74, 68, 78];

      const rowsRes = puntos.map((p) => {
        const nominal = pickNominalMm(p);
        const corrUm =
          num(p?.correccion_um) ??
          (num(p?.correccion_patron) !== null ? num(p?.correccion_patron) * 1000 : null);

        const errUm = pickErrorUm(p);
        const UUm = pickUUm(p);
        const TUm = pickTUm(p);
        const dec = pickDecision(p);

        return [
          nominal === null ? "—" : fmt(nominal, 3),
          corrUm === null ? "—" : fmt(corrUm, 1),
          errUm === null ? "—" : fmt(errUm, 1),
          UUm === null ? "—" : fmt(UUm, 1),
          TUm === null ? "—" : fmt(TUm, 1),
          dec || "—",
        ];
      });

      drawTable({
        title: "Tabla 2 · Resultados metrológicos por punto (ILAC-G8)",
        headers: headersRes,
        rows: rowsRes,
        colWidths: colRes,
        fontSize: 7.6,
        headerFontSize: 8,
        rowH: 14,
        headerH: 16,
      });

      // nota bloque
      ensureSpace(50);
      doc
        .font("Helvetica-Oblique")
        .fontSize(7.2)
        .fillColor(C.grisSec)
        .text(
          "Nota: los errores y la decisión de conformidad se evalúan según ILAC-G8 considerando U(k=2) y la tolerancia especificada.",
          { width: contentW, align: "justify" }
        );

      doc.moveDown(1.2);
      doc.fillColor(C.grisTexto).font("Helvetica");
    });
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  // ====== CORS ======
  res.setHeader("Access-Control-Allow-Origin", "https://trazabilidad-tmp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const certJSON = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1) Número oficial
    const numero = await generarNumeroCertificado();

    // 2) URL de verificación
    const verificacionURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3) Generar PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4) Subir PDF a Storage
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5) Decisión global desde resumen (fallback simple)
    const resumenTxt = safeStr(certJSON.resumen_global || "");
    let decisionGlobal = "APTO";
    if (resumenTxt.includes("NO APTO")) decisionGlobal = "NO APTO";
    else if (resumenTxt.includes("INDETERMINADO")) decisionGlobal = "INDETERMINADO";

    // 6) Registrar en Supabase
    await supabase.from("certificados").insert({
      numero,
      datos: certJSON,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: decisionGlobal,
    });

    // 7) Respuesta al frontend
    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verificacionURL,
      },
    });
  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
