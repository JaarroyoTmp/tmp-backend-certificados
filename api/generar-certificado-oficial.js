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

function fmtNum(v, dec = 3, fallback = "—") {
  const n = toNum(v);
  return n === null ? fallback : n.toFixed(dec);
}

function fmtNum1(v, fallback = "—") {
  return fmtNum(v, 1, fallback);
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

function inferirDecisionGlobal(cert) {
  if (cert?.decision_global) return safeText(cert.decision_global);

  if (cert?.resumen_global && typeof cert.resumen_global === "object" && cert.resumen_global.decision) {
    return safeText(cert.resumen_global.decision);
  }

  if (typeof cert?.resumen_global === "string") {
    const txt = cert.resumen_global.toUpperCase();
    if (txt.includes("NO APTO")) return "NO APTO";
    if (txt.includes("INDETERMINADO")) return "INDETERMINADO";
    if (txt.includes("APTO")) return "APTO";
  }

  const bloques = normalizarBloques(cert);
  const decisiones = bloques.map((b) => upper(b.decision));

  if (decisiones.includes("NO APTO")) return "NO APTO";
  if (decisiones.includes("INDETERMINADO")) return "INDETERMINADO";
  if (decisiones.includes("APTO")) return "APTO";

  return "—";
}

function normalizarPatrones(cert) {
  if (!Array.isArray(cert?.patrones)) return [];
  return cert.patrones.map((p, idx) => ({
    codigo: p?.codigo || p?.id || `PAT-${idx + 1}`,
    descripcion: p?.descripcion || "—",
    u_k2: p?.u_k2 ?? p?.U ?? null,
    nota: p?.nota || p?.observaciones || "—",
  }));
}

function normalizarBloques(cert) {
  if (!Array.isArray(cert?.bloques)) return [];

  return cert.bloques.map((b, idx) => {
    const puntos = Array.isArray(b?.puntos) ? b.puntos.map((p, pidx) => ({
      id: p?.id || `${idx + 1}-${pidx + 1}`,
      nominal: p?.nominal ?? p?.valor_nominal ?? null,
      correccion_patron: p?.correccion_patron ?? null,
      caracteristica: p?.caracteristica || "",
      repeticiones: Array.isArray(p?.repeticiones) ? p.repeticiones : [],
      media: p?.media ?? null,
      sigma: p?.sigma ?? p?.s ?? null,
      error: p?.error ?? null,
      U: p?.U ?? p?.u_total ?? p?.u ?? null,
      T: p?.T ?? p?.tol ?? p?.tolerancia ?? null,
      decision: p?.decision ?? null,
    })) : [];

    return {
      nombre: b?.tipo || b?.nombre || `Bloque ${idx + 1}`,
      lado: b?.lado || "—",
      patron_codigo: b?.patron?.codigo || b?.patron?.id || "—",
      patron_descripcion: b?.patron?.descripcion || "—",
      decision: b?.decision || null,
      maxAbsE: b?.max_abs_error_um ?? b?.maxAbsError ?? null,
      maxAbsEplusU: b?.max_abs_error_plus_u_um ?? b?.maxAbsErrorPlusU ?? null,
      tol: b?.tolerancia_um ?? b?.tol ?? null,
      puntos,
    };
  });
}

function construirTextoResumen(cert, bloques, decisionGlobal) {
  if (typeof cert?.resumen_global === "string" && cert.resumen_global.trim()) {
    return cert.resumen_global.trim();
  }

  const totalPuntos = bloques.reduce((acc, b) => acc + b.puntos.length, 0);

  let maxE = null;
  let maxEplusU = null;
  let tol = null;

  bloques.forEach((b) => {
    const e = toNum(b.maxAbsE);
    const eu = toNum(b.maxAbsEplusU);
    const t = toNum(b.tol);

    if (e !== null) maxE = maxE === null ? e : Math.max(maxE, e);
    if (eu !== null) maxEplusU = maxEplusU === null ? eu : Math.max(maxEplusU, eu);
    if (t !== null) tol = tol === null ? t : Math.max(tol, t);
  });

  return [
    `Número de bloques: ${bloques.length || 0}`,
    `Número total de puntos evaluados: ${totalPuntos || 0}`,
    `Máx |E| (µm): ${fmtNum1(maxE)}`,
    `Máx (|E| + U) (µm): ${fmtNum1(maxEplusU)}`,
    `Tolerancia global (µm): ${fmtNum1(tol)}`,
    `Decisión global según ILAC-G8: ${safeText(decisionGlobal)}`
  ].join("\n");
}

function construirTextoTrazabilidad(cert, patrones) {
  if (typeof cert?.trazabilidad === "string" && cert.trazabilidad.trim()) {
    return cert.trazabilidad.trim();
  }

  if (!patrones.length) {
    return "La trazabilidad metrológica se declara mediante patrones controlados por el laboratorio. En este registro no se ha recibido detalle estructurado suficiente de los patrones, por lo que la evidencia completa debe verificarse en el sistema interno y en el PDF oficial archivado.";
  }

  const lista = patrones
    .map((p) => `${safeText(p.codigo)} · ${safeText(p.descripcion)}`)
    .join("; ");

  return `La trazabilidad metrológica se apoya en los siguientes patrones declarados en el registro: ${lista}. La situación de calibración, vigencia documental y control de estos patrones debe verificarse en el sistema metrológico del laboratorio.`;
}

function construirExplicacionDecision(cert, decision, bloques) {
  const d = upper(decision);

  let txt = `La decisión global registrada para este certificado es: ${safeText(decision)}.\n\n`;

  if (d === "APTO") {
    txt += "Esto indica que, con la información registrada, los resultados obtenidos son compatibles con el criterio de aceptación declarado por el laboratorio.\n";
    txt += "En términos metrológicos, la conformidad es coherente cuando los errores observados y la incertidumbre expandida permanecen dentro de la tolerancia aplicable.\n\n";
  } else if (d === "NO APTO") {
    txt += "Esto indica que, con la información registrada, al menos uno de los resultados no es compatible con el criterio de aceptación declarado.\n";
    txt += "En términos metrológicos, la no conformidad es coherente cuando el error observado, considerando la incertidumbre y la regla de decisión aplicada, supera el margen permitido.\n\n";
  } else if (d === "INDETERMINADO") {
    txt += "Esto indica que la decisión no es plenamente concluyente con la información disponible.\n";
    txt += "En este tipo de situación, el resultado se sitúa cerca del límite de aceptación y la incertidumbre influye de forma crítica en la evaluación.\n\n";
  } else {
    txt += "No se ha podido determinar una decisión global estructurada suficientemente clara a partir de los datos recibidos.\n\n";
  }

  if (bloques.length) {
    txt += `El certificado contiene ${bloques.length} bloque(s) de resultados para apoyar la interpretación técnica.`;
  } else {
    txt += "No se han encontrado bloques estructurados de resultados; la explicación se basa únicamente en el resumen global disponible.";
  }

  return txt;
}

// ======================================================
// DIBUJO PDF
// ======================================================
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
    .text(text, x, y);
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
      .text(`${label}`, x, cy, { width: labelWidth });

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
        .text(safeText(cols[i]), cx + 5, cy + 6, {
          width: w - 10,
          height: rowHeight - 10,
        });

      cx += w;
    }
    cy += rowHeight;
  };

  if (header) drawRow(header, true);
  rows.forEach((r) => drawRow(r, false));

  doc.y = cy + 4;
  return cy;
}

function drawWrappedParagraph(doc, text, opts = {}) {
  const {
    x = 40,
    y = doc.y,
    width = 515,
    fontSize = 9,
    lineGap = 3,
    align = "justify",
  } = opts;

  doc
    .font("Helvetica")
    .fontSize(fontSize)
    .fillColor("#111827")
    .text(safeText(text), x, y, {
      width,
      lineGap,
      align,
    });

  return doc.y;
}

function renderBloqueDetalle(doc, bloque, left, contentWidth) {
  const top = doc.y;

  drawBox(doc, left, top, contentWidth, 42, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, top + 12, `Bloque: ${safeText(bloque.nombre)}`);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(
      `Lado: ${safeText(bloque.lado)} · Patrón: ${safeText(bloque.patron_codigo)} · ${safeText(bloque.patron_descripcion)}`,
      left + 220,
      top + 13,
      {
        width: contentWidth - 232,
        align: "left",
      }
    );

  doc.y = top + 52;

  if (bloque.puntos.length) {
    drawSimpleTable(
      doc,
      bloque.puntos.map((p) => [
        safeText(p.nominal),
        p.repeticiones.length ? p.repeticiones.map((r) => fmtNum(r, 3)).join(" / ") : "—",
        fmtNum(p.media, 3),
        fmtNum(p.sigma, 3),
        fmtNum1(p.error),
        fmtNum1(p.U),
        fmtNum1(p.T),
        safeText(p.decision),
      ]),
      {
        x: left,
        y: doc.y,
        widths: [55, 150, 55, 50, 50, 50, 50, 55],
        rowHeight: 24,
        header: ["Nominal", "Lecturas", "Media", "σ", "Error", "U", "T", "Decisión"],
        fontSize: 7.6,
      }
    );
  } else {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text("No se han recibido puntos detallados para este bloque.", left, doc.y, {
        width: contentWidth,
      });

    doc.y += 18;
  }

  const resumenLinea = [
    `Máx |E|: ${fmtNum1(bloque.maxAbsE)}`,
    `Máx (|E| + U): ${fmtNum1(bloque.maxAbsEplusU)}`,
    `Tolerancia: ${fmtNum1(bloque.tol)}`,
    `Decisión: ${safeText(bloque.decision)}`
  ].join(" · ");

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#334155")
    .text(resumenLinea, left, doc.y + 2, {
      width: contentWidth,
    });

  doc.y += 18;
}

// ======================================================
// GENERAR PDF COMPLETO
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
  const patrones = normalizarPatrones(cert);
  const bloques = normalizarBloques(cert);

  const resumenTexto = construirTextoResumen(cert, bloques, decision);
  const explicacionDecision = construirExplicacionDecision(cert, decision, bloques);
  const trazabilidadTexto = construirTextoTrazabilidad(cert, patrones);

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageWidth - doc.page.margins.right;
  const contentWidth = right - left;

  // ======================================================
  // CABECERA
  // ======================================================
  drawBox(doc, left, 36, contentWidth, 96, {
    fillColor: "#f8fafc",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 10,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor("#0f172a")
    .text("CERTIFICADO DE CALIBRACIÓN", left, 50, {
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
      doc.image(qr, right - 90, 50, { width: 68 });
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#475569")
        .text("Verificación online", right - 94, 121, {
          width: 78,
          align: "center",
        });
    } catch (e) {
      console.warn("QR no generado:", e.message);
    }
  }

  drawBox(doc, left, 140, contentWidth, 28, {
    fillColor: "#f8fafc",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0f172a")
    .text("Regla de decisión:", left + 12, 149, { continued: true })
    .font("Helvetica")
    .text(` ${safeText(cert.regla_decision, "ILAC-G8")}`, { continued: false });

  doc
    .font("Helvetica-Bold")
    .fillColor(decisionClr)
    .text(`Decisión global: ${safeText(decision)}`, left + 320, 149, {
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

  doc.y += 12;

  // ======================================================
  // 2. CONDICIONES
  // ======================================================
  ensurePageSpace(doc, 100);
  drawBox(doc, left, doc.y, contentWidth, 92, {
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

  doc.y += 10;

  // ======================================================
  // 3. PATRONES
  // ======================================================
  ensurePageSpace(doc, 120);
  const patronesHeight = patrones.length ? 40 + 24 * Math.min(patrones.length, 6) : 78;
  drawBox(doc, left, doc.y, contentWidth, patronesHeight, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "3. Patrones utilizados");

  if (patrones.length) {
    drawSimpleTable(
      doc,
      patrones.map((p) => [
        safeText(p.codigo),
        safeText(p.descripcion),
        fmtNum(p.u_k2, 3),
        safeText(p.nota),
      ]),
      {
        x: left + 12,
        y: doc.y + 10,
        widths: [80, 220, 70, 133],
        rowHeight: 22,
        header: ["Código", "Descripción", "U(k=2)", "Observaciones"],
        fontSize: 8,
      }
    );
  } else {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text("No se han recibido patrones estructurados en el JSON del certificado.", left + 12, doc.y + 18, {
        width: contentWidth - 24,
      });

    doc.y += 36;
  }

  doc.y += 8;

  // ======================================================
  // 4. RESUMEN GLOBAL
  // ======================================================
  ensurePageSpace(doc, 120);
  drawBox(doc, left, doc.y, contentWidth, 112, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "4. Resumen global de resultados");

  drawWrappedParagraph(doc, resumenTexto, {
    x: left + 12,
    y: doc.y + 30,
    width: contentWidth - 24,
    fontSize: 9,
    lineGap: 3,
    align: "left",
  });

  doc.y += 10;

  // ======================================================
  // 5. RESULTADOS POR BLOQUE
  // ======================================================
  if (bloques.length) {
    ensurePageSpace(doc, 80);

    drawBox(doc, left, doc.y, contentWidth, 36, {
      fillColor: "#ffffff",
      strokeColor: "#cbd5e1",
      lineWidth: 1,
      radius: 8,
    });

    writeBoxTitle(doc, left + 12, doc.y + 12, "5. Resultados obtenidos por bloque y punto");
    doc.y += 46;

    bloques.forEach((bloque, idx) => {
      ensurePageSpace(doc, 160);
      renderBloqueDetalle(doc, bloque, left, contentWidth);

      if (idx < bloques.length - 1) {
        doc.y += 10;
      }
    });
  }

  // ======================================================
  // 6. TRAZABILIDAD
  // ======================================================
  ensurePageSpace(doc, 120);
  drawBox(doc, left, doc.y, contentWidth, 106, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "6. Trazabilidad metrológica");

  drawWrappedParagraph(doc, trazabilidadTexto, {
    x: left + 12,
    y: doc.y + 30,
    width: contentWidth - 24,
    fontSize: 9,
    lineGap: 3,
    align: "justify",
  });

  doc.y += 12;

  // ======================================================
  // 7. EXPLICACIÓN TÉCNICA
  // ======================================================
  ensurePageSpace(doc, 140);
  drawBox(doc, left, doc.y, contentWidth, 126, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "7. Explicación técnica de la decisión");

  drawWrappedParagraph(doc, explicacionDecision, {
    x: left + 12,
    y: doc.y + 30,
    width: contentWidth - 24,
    fontSize: 9,
    lineGap: 3,
    align: "justify",
  });

  doc.y += 12;

  // ======================================================
  // 8. VALIDACIÓN
  // ======================================================
  ensurePageSpace(doc, 120);
  drawBox(doc, left, doc.y, contentWidth, 120, {
    fillColor: "#ffffff",
    strokeColor: "#cbd5e1",
    lineWidth: 1,
    radius: 8,
  });

  writeBoxTitle(doc, left + 12, doc.y + 12, "8. Validación");

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

  doc.y += 44;

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

    const numero = await generarNumeroCertificado();

    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;

    certJSON.qr = { url_verificacion: verificacionURL };

    const pdfBuffer = await generarPDF(certJSON, numero);
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: safeText(certJSON?.regla_decision, "ILAC-G8"),
      decision_global: inferirDecisionGlobal(certJSON),
    });

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
