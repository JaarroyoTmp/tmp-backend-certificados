export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
  runtime: "nodejs",
};

// ======================================================
// DEPENDENCIAS
// ======================================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ======================================================
// SUPABASE
// ======================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ======================================================
// GENERAR NÚMERO OFICIAL
// CC-YYYY-XXXX
// ======================================================
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

  const next = (Math.max(0, ...nums) + 1)
    .toString()
    .padStart(4, "0");

  return `CC-${year}-${next}`;
}

// ======================================================
// LIMPIAR JSON PARA BD (sin firma_base64)
// ======================================================
function limpiarParaBD(certJSON) {
  const limpio = JSON.parse(JSON.stringify(certJSON));
  if (limpio?.firma?.firma_base64) {
    delete limpio.firma.firma_base64;
  }
  return limpio;
}

// ======================================================
// SUBIR PDF A SUPABASE
// ======================================================
async function subirPDF(buffer, fileName) {
  const { error } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw error;

  return supabase.storage
    .from("certificados")
    .getPublicUrl(fileName).data.publicUrl;
}

// ======================================================
// UTILS
// ======================================================
function safeText(v, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

function fmtNum(v, dec = 1, fallback = "—") {
  const n = toNum(v);
  return n === null ? fallback : n.toFixed(dec);
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(+d)) return safeText(v);
  return d.toISOString().slice(0, 10);
}

function upper(v) {
  return safeText(v, "").toUpperCase().trim();
}

function decisionColor(decision) {
  const d = upper(decision);
  if (d === "APTO") return "#15803d";
  if (d === "NO APTO") return "#b91c1c";
  if (d === "INDETERMINADO") return "#b45309";
  return "#334155";
}

function normalizarBloquesDesdeCert(cert) {
  const out = [];

  if (Array.isArray(cert?.bloques)) {
    cert.bloques.forEach((b, idx) => {
      out.push({
        nombre: b?.tipo || b?.nombre || `Bloque ${idx + 1}`,
        puntos: Array.isArray(b?.puntos) ? b.puntos.length : null,
        decision: b?.decision || null,
        maxAbsE: b?.max_abs_error_um ?? b?.maxAbsError ?? null,
        maxAbsEplusU: b?.max_abs_error_plus_u_um ?? b?.maxAbsErrorPlusU ?? null,
        tol: b?.tolerancia_um ?? b?.tol ?? null,
      });
    });
  }

  if (!out.length && cert?.resumen_global && typeof cert.resumen_global === "object") {
    const rg = cert.resumen_global;
    if (Array.isArray(rg.bloques)) {
      rg.bloques.forEach((b, idx) => {
        out.push({
          nombre: b?.nombre || b?.tipo || `Bloque ${idx + 1}`,
          puntos: b?.puntos ?? null,
          decision: b?.decision || null,
          maxAbsE: b?.max_abs_error_um ?? b?.maxAbsError ?? null,
          maxAbsEplusU: b?.max_abs_error_plus_u_um ?? b?.maxAbsErrorPlusU ?? null,
          tol: b?.tolerancia_um ?? b?.tol ?? null,
        });
      });
    }
  }

  return out;
}

function inferirDecisionGlobal(cert) {
  if (cert?.decision_global) return safeText(cert.decision_global);
  if (cert?.resumen_global && typeof cert.resumen_global === "string") {
    const txt = cert.resumen_global.toUpperCase();
    if (txt.includes("NO APTO")) return "NO APTO";
    if (txt.includes("INDETERMINADO")) return "INDETERMINADO";
    if (txt.includes("APTO")) return "APTO";
  }

  const bloques = normalizarBloquesDesdeCert(cert);
  const decisiones = bloques.map((b) => upper(b.decision));

  if (decisiones.includes("NO APTO")) return "NO APTO";
  if (decisiones.includes("INDETERMINADO")) return "INDETERMINADO";
  if (decisiones.includes("APTO")) return "APTO";

  return "—";
}

function construirTextoResumen(cert) {
  if (typeof cert?.resumen_global === "string" && cert.resumen_global.trim()) {
    return cert.resumen_global.trim();
  }

  if (cert?.resumen_global && typeof cert.resumen_global === "object") {
    const rg = cert.resumen_global;
    const partes = [];

    if (rg.numero_bloques !== undefined) {
      partes.push(`Número de bloques: ${safeText(rg.numero_bloques)}`);
    }
    if (rg.total_puntos !== undefined) {
      partes.push(`Número total de puntos evaluados: ${safeText(rg.total_puntos)}`);
    }
    if (rg.maxAbsError !== undefined || rg.max_abs_error_um !== undefined) {
      partes.push(`Máx |E| (µm): ${fmtNum(rg.maxAbsError ?? rg.max_abs_error_um, 1)}`);
    }
    if (rg.maxAbsErrorPlusU !== undefined || rg.max_abs_error_plus_u_um !== undefined) {
      partes.push(`Máx (|E| + U) (µm): ${fmtNum(rg.maxAbsErrorPlusU ?? rg.max_abs_error_plus_u_um, 1)}`);
    }
    if (rg.tolerancia !== undefined || rg.tolerancia_um !== undefined) {
      partes.push(`Tolerancia global (µm): ${fmtNum(rg.tolerancia ?? rg.tolerancia_um, 1)}`);
    }
    if (rg.decision) {
      partes.push(`Decisión global según ILAC-G8: ${safeText(rg.decision)}`);
    }

    if (partes.length) return partes.join("\n");
  }

  return "No se ha recibido un resumen global estructurado para este certificado.";
}

function construirExplicacionDecision(cert, decision) {
  const d = upper(decision);
  const bloques = normalizarBloquesDesdeCert(cert);

  let txt = "";

  txt += `La decisión global registrada para este certificado es: ${safeText(decision)}.\n\n`;

  if (d === "APTO") {
    txt += "Interpretación: el resultado es favorable. Esto es coherente cuando los errores observados y la incertidumbre expandida se mantienen dentro del criterio de aceptación aplicado por el laboratorio.\n\n";
  } else if (d === "NO APTO") {
    txt += "Interpretación: el resultado es desfavorable. Esto es coherente cuando al menos uno de los resultados supera el criterio de aceptación y no puede sostenerse conformidad con la regla de decisión declarada.\n\n";
  } else if (d === "INDETERMINADO") {
    txt += "Interpretación: el resultado no es plenamente concluyente. Esto ocurre cuando la incertidumbre influye de forma crítica cerca del límite de tolerancia y la decisión no puede cerrarse de manera tajante.\n\n";
  } else {
    txt += "Interpretación: no hay una decisión global estructurada suficientemente clara en los datos recibidos.\n\n";
  }

  if (bloques.length) {
    txt += `Se han identificado ${bloques.length} bloque(s) o grupo(s) de resultados para apoyar la evaluación documental.`;
  } else {
    txt += "No se han identificado bloques estructurados de resultados; la explicación se basa en el resumen global disponible.";
  }

  return txt;
}

function construirTextoTrazabilidad(cert) {
  if (typeof cert?.trazabilidad === "string" && cert.trazabilidad.trim()) {
    return cert.trazabilidad.trim();
  }

  const patrones = Array.isArray(cert?.patrones) ? cert.patrones : [];
  if (!patrones.length) {
    return "La trazabilidad metrológica se declara mediante el uso de patrones controlados por el laboratorio. En este registro no se ha recibido un detalle estructurado de patrones, por lo que la evidencia completa debe comprobarse en el sistema y en el PDF oficial archivado.";
  }

  const lista = patrones
    .map((p) => `${safeText(p.codigo || p.id)} · ${safeText(p.descripcion)}`)
    .join("; ");

  return `La trazabilidad metrológica se apoya en los siguientes patrones declarados en el registro: ${lista}. La situación de calibración y control documental de estos patrones debe verificarse en el sistema metrológico del laboratorio.`;
}

function drawBox(doc, x, y, w, h, opts = {}) {
  const {
    fillColor = null,
    strokeColor = "#d1d5db",
    lineWidth = 1,
    radius = 6,
  } = opts;

  doc.save();
  doc.lineWidth(lineWidth);
  doc.strokeColor(strokeColor);

  if (fillColor) {
    doc.fillColor(fillColor);
    doc.roundedRect(x, y, w, h, radius).fillAndStroke();
  } else {
    doc.roundedRect(x, y, w, h, radius).stroke();
  }
  doc.restore();
}

function writeBoxTitle(doc, x, y, text) {
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#0f172a")
    .text(text, x, y, { width: 500 });
}

function ensurePageSpace(doc, needed = 120) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottomLimit) {
    doc.addPage();
  }
}

function drawKeyValueLines(doc, items, opts = {}) {
  const {
    x = 40,
    y = doc.y,
    labelWidth = 150,
    valueWidth = 320,
    lineGap = 16,
    fontSize = 9,
  } = opts;

  let cy = y;

  items.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#0f172a")
      .text(`${label}`, x, cy, { width: labelWidth, continued: false });

    doc.font("Helvetica").fontSize(fontSize).fillColor("#111827")
      .text(`${safeText(value)}`, x + labelWidth, cy, { width: valueWidth });

    cy += lineGap;
  });

  doc.y = cy;
  return cy;
}

function drawSimpleTable(doc, rows, opts = {}) {
  const {
    x = 40,
    y = doc.y,
    widths = [180, 320],
    rowHeight = 22,
    header = null,
    fontSize = 8.5,
  } = opts;

  let cy = y;
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  const drawRow = (cols, isHeader = false) => {
    ensurePageSpace(doc, rowHeight + 20);

    let cx = x;
    for (let i = 0; i < cols.length; i++) {
      const w = widths[i] || 100;
      drawBox(doc, cx, cy, w, rowHeight, {
        fillColor: isHeader ? "#e5e7eb" : "#ffffff",
        strokeColor: "#cbd5e1",
        lineWidth: 0.7,
        radius: 0,
      });

      doc
        .font(isHeader ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fontSize)
        .fillColor("#111827")
        .text(safeText(cols[i]), cx + 6, cy + 6, {
          width: w - 12,
          height: rowHeight - 10,
        });

      cx += w;
    }
    cy += rowHeight;
  };

  if (header) drawRow(header, true);
  rows.forEach((r) => drawRow(r, false));

  doc.y = cy + 4;
  return { x, y, width: totalWidth, bottom: cy };
}

// ======================================================
// GENERAR PDF
// ======================================================
async function generarPDF(cert, numero) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    bufferPages: true,
    info: {
      Title: `Certificado de Calibración ${numero}`,
      Author: "TMP",
      Subject: "Certificado de calibración",
      Keywords: "calibracion, certificado, TMP, ISO17025, ILAC-G8",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const fecha = new Date().toISOString().slice(0, 10);
  const urlVerif = cert.qr?.url_verificacion || "";
  const decision = inferirDecisionGlobal(cert);
  const decisionClr = decisionColor(decision);

  const i = cert.instrumento || {};
  const c = cert.condiciones || {};
  const f = cert.firma || {};
  const bloques = normalizarBloquesDesdeCert(cert);
  const resumenTexto = construirTextoResumen(cert);
  const explicacionDecision = construirExplicacionDecision(cert, decision);
  const trazabilidadTexto = construirTextoTrazabilidad(cert);

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageWidth - doc.page.margins.right;
  const contentWidth = right - left;

  // ======================================================
  // CABECERA
  // ======================================================
  drawBox(doc, left, 36, contentWidth, 92, {
    fillColor: "#f8fafc",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 10,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor("#0f172a")
    .text("CERTIFICADO DE CALIBRACIÓN", left, 52, {
      width: contentWidth,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#334155")
    .text(`Número: ${numero}`, left, 80, {
      width: contentWidth,
      align: "center",
    })
    .text(`Fecha de emisión: ${fecha}`, left, 94, {
      width: contentWidth,
      align: "center",
    });

  if (urlVerif) {
    try {
      const qr = await QRCode.toBuffer(urlVerif, { margin: 1, width: 160 });
      doc.image(qr, right - 92, 48, { width: 72 });
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#475569")
        .text("Verificación online", right - 96, 123, {
          width: 80,
          align: "center",
        });
    } catch (e) {
      console.warn("QR no generado:", e.message);
    }
  }

  // Cinta de estado
  drawBox(doc, left, 138, contentWidth, 28, {
    fillColor: "#f8fafc",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0f172a")
    .text("Regla de decisión:", left + 12, 147, { continued: true })
    .font("Helvetica")
    .text(` ${safeText(cert.regla_decision, "ILAC-G8")}`, { continued: false });

  doc
    .font("Helvetica-Bold")
    .fillColor(decisionClr)
    .text(`Decisión global: ${safeText(decision)}`, left + 320, 147, {
      width: 180,
      align: "right",
    });

  doc.y = 182;

  // ======================================================
  // 1. DATOS DEL INSTRUMENTO
  // ======================================================
  ensurePageSpace(doc, 140);
  drawBox(doc, left, doc.y, contentWidth, 130, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "1. Datos del instrumento");

  drawKeyValueLines(doc, [
    ["Código", i.codigo],
    ["Descripción", i.descripcion],
    ["Fabricante / Tipo", i.fabricante_tipo || i.fabricanteTipo],
    ["Rango", i.rango],
    ["Unidad base", i.unidad_base || i.unidad],
    ["Última calibración", i.fecha_calibracion || i.fecha_ultima_cal],
    ["Próxima calibración", i.fecha_proxima_calibracion || f.proxima_calibracion],
  ], {
    x: left + 12,
    y: doc.y + 16,
    labelWidth: 140,
    valueWidth: 350,
    lineGap: 15,
    fontSize: 9,
  });

  doc.y = doc.y + 12;

  // ======================================================
  // 2. CONDICIONES
  // ======================================================
  ensurePageSpace(doc, 95);
  drawBox(doc, left, doc.y, contentWidth, 88, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "2. Condiciones ambientales");

  drawKeyValueLines(doc, [
    ["Temperatura", `${safeText(c.temperatura)} °C`],
    ["Humedad", `${safeText(c.humedad)} %`],
    ["Fecha calibración", fmtDate(c.fecha_calibracion)],
    ["Observaciones", c.observaciones || c.obs || "Sin observaciones relevantes"],
  ], {
    x: left + 12,
    y: doc.y + 16,
    labelWidth: 140,
    valueWidth: 350,
    lineGap: 15,
    fontSize: 9,
  });

  doc.y = doc.y + 12;

  // ======================================================
  // 3. RESUMEN GLOBAL
  // ======================================================
  ensurePageSpace(doc, 120);
  const resumenHeight = 110;
  drawBox(doc, left, doc.y, contentWidth, resumenHeight, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "3. Resumen global de resultados");

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#111827")
    .text(resumenTexto, left + 12, doc.y + 30, {
      width: contentWidth - 24,
      lineGap: 3,
      align: "left",
    });

  doc.y = doc.y + resumenHeight + 8;

  // ======================================================
  // 4. TABLA DE BLOQUES
  // ======================================================
  if (bloques.length) {
    ensurePageSpace(doc, 120);

    drawBox(doc, left, doc.y, contentWidth, 34, {
      fillColor: "#ffffff",
      strokeColor: "#cbd5e1",
      lineWidth: 1,
      radius: 8,
    });

    writeBoxTitle(doc, left + 12, doc.y + 11, "4. Resultados por bloque / magnitud");

    doc.y += 42;

    drawSimpleTable(
      doc,
      bloques.map((b) => [
        safeText(b.nombre),
        b.puntos === null ? "—" : String(b.puntos),
        fmtNum(b.maxAbsE, 1),
        fmtNum(b.maxAbsEplusU, 1),
        fmtNum(b.tol, 1),
        safeText(b.decision || "—"),
      ]),
      {
        x: left,
        y: doc.y,
        widths: [150, 55, 80, 90, 75, 85],
        rowHeight: 24,
        header: ["Bloque", "Puntos", "Máx |E|", "Máx (|E|+U)", "Tol.", "Decisión"],
        fontSize: 8.5,
      }
    );
  }

  // ======================================================
  // 5. TRAZABILIDAD
  // ======================================================
  ensurePageSpace(doc, 120);
  drawBox(doc, left, doc.y, contentWidth, 100, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "5. Trazabilidad metrológica");

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#111827")
    .text(trazabilidadTexto, left + 12, doc.y + 30, {
      width: contentWidth - 24,
      lineGap: 3,
      align: "justify",
    });

  doc.y = doc.y + 108;

  // ======================================================
  // 6. EXPLICACIÓN DE LA DECISIÓN
  // ======================================================
  ensurePageSpace(doc, 140);
  drawBox(doc, left, doc.y, contentWidth, 128, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "6. Explicación técnica del resultado");

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#111827")
    .text(explicacionDecision, left + 12, doc.y + 30, {
      width: contentWidth - 24,
      lineGap: 3,
      align: "justify",
    });

  doc.y = doc.y + 136;

  // ======================================================
  // 7. VALIDACIÓN Y FIRMA
  // ======================================================
  ensurePageSpace(doc, 120);
  drawBox(doc, left, doc.y, contentWidth, 120, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "7. Validación");

  drawKeyValueLines(doc, [
    ["Operario", f.nombre],
    ["Próxima calibración", f.proxima_calibracion],
  ], {
    x: left + 12,
    y: doc.y + 18,
    labelWidth: 140,
    valueWidth: 250,
    lineGap: 16,
    fontSize: 9,
  });

  if (f.firma_base64) {
    try {
      const img = f.firma_base64.replace(/^data:image\/png;base64,/, "");
      doc.image(Buffer.from(img, "base64"), right - 170, doc.y - 48, {
        fit: [140, 48],
        align: "center",
      });

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#475569")
        .text("Firma registrada", right - 170, doc.y + 6, {
          width: 140,
          align: "center",
        });
    } catch (e) {
      console.warn("Firma no insertada:", e.message);
    }
  }

  doc.y = doc.y + 44;

  // ======================================================
  // PIE
  // ======================================================
  const bottomY = doc.page.height - 60;
  doc
    .moveTo(left, bottomY)
    .lineTo(right, bottomY)
    .strokeColor("#cbd5e1")
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#64748b")
    .text(
      "Emitido conforme al sistema documental del laboratorio TMP. La interpretación del resultado se basa en la información recibida, la regla de decisión declarada y la trazabilidad registrada. Reproducción parcial no permitida.",
      left,
      bottomY + 8,
      {
        width: contentWidth,
        align: "justify",
      }
    );

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

// ======================================================
// HANDLER PRINCIPAL
// ======================================================
export default async function handler(req, res) {
  console.log(">>> generar-certificado-oficial", req.method);

  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://trazabilidad-tmp.vercel.app"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    // 1) Número oficial
    const numero = await generarNumeroCertificado();

    // 2) URL de verificación
    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;

    certJSON.qr = { url_verificacion: verificacionURL };

    // 3) Generar PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4) Subir a Storage
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5) Guardar registro
    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: safeText(certJSON?.regla_decision, "ILAC-G8"),
      decision_global: inferirDecisionGlobal(certJSON),
    });

    // 6) Respuesta
    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verificacionURL,
      },
    });
  } catch (e) {
    console.error("ERROR BACKEND:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Error interno",
    });
  }
}
