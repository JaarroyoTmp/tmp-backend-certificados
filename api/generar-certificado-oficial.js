// ==========================================
// API: generar-certificado-oficial (Versión profesional TMP)
// ==========================================

import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

// ==== CONFIG =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// Ruta del logo (debe existir en /api/)
const LOGO_PATH = path.join(process.cwd(), "api", "logo-paramio.png");

// ==========================================
// SUBIR PDF A SUPABASE
// ==========================================
async function subirPDF(buffer, fileName) {
  const { error: uploadError } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from("certificados")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// ==========================================
// GENERAR NÚMERO CC-2025-XXXX
// ==========================================
async function generarNumeroCertificado() {
  const year = new Date().getFullYear();

  const { data } = await supabase
    .from("certificados")
    .select("numero")
    .like("numero", `CC-${year}-%`);

  const nums = (data || []).map((r) => {
    const m = r.numero?.match(/CC-\d+-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });

  const next = (Math.max(0, ...nums) + 1).toString().padStart(4, "0");
  return `CC-${year}-${next}`;
}

// ==========================================
// GENERAR PDF PROFESIONAL TMP–PARAMIO
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Certificado ${numero}`,
      Author: "Talleres Mecánicos Paramio",
      Subject: "Certificado de calibración",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  // Colores corporativos
  const C_AZUL = "#00518c";
  const C_NARANJA = "#f27a24";
  const C_GRIS_FONDO = "#f7f5f2";
  const C_GRIS_BORDE = "#d7d1c8";
  const C_TEXTO = "#333333";

  const PAGE_WIDTH = doc.page.width;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  const hoy = new Date().toISOString().substring(0, 10);

  // ===========================
  // QR
  // ===========================
  let qrBuffer = null;
  if (certJSON.qr?.url_verificacion) {
    const qrDataURL = await QRCode.toDataURL(certJSON.qr.url_verificacion, {
      errorCorrectionLevel: "M",
      margin: 1,
    });
    qrBuffer = Buffer.from(qrDataURL.split(",")[1], "base64");
  }

  // ===========================
  // CABECERA
  // ===========================
  const headerTop = 40;

  // LOGO
  try {
    doc.image(LOGO_PATH, MARGIN, headerTop, { width: 120 });
  } catch (e) {
    console.warn("⚠️ No pude cargar el logo:", e);
  }

  // TÍTULO
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(C_AZUL)
    .text("CERTIFICADO DE CALIBRACIÓN", MARGIN, headerTop, {
      width: CONTENT_WIDTH,
      align: "center",
    });

  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(C_TEXTO)
    .text(`Número: ${numero}`, { align: "center" })
    .text(`Fecha de emisión: ${hoy}`, { align: "center" });

  // QR ARRIBA DERECHA
  if (qrBuffer) {
    const qrSize = 90;
    doc.image(qrBuffer, PAGE_WIDTH - MARGIN - qrSize, headerTop, {
      width: qrSize,
      height: qrSize,
    });
    doc
      .fontSize(7)
      .fillColor("#555")
      .text("Verificación online", PAGE_WIDTH - MARGIN - qrSize, headerTop + qrSize + 2, {
        width: qrSize,
        align: "center",
      });
  }

  // LÍNEA DECORATIVA
  doc
    .moveTo(MARGIN, 140)
    .lineTo(PAGE_WIDTH - MARGIN, 140)
    .lineWidth(2)
    .strokeColor(C_NARANJA)
    .stroke();

  doc.moveDown(2);
  doc.y = 150;

  // Helpers
  function sectionTitle(texto) {
    const y = doc.y + 8;
    doc
      .roundedRect(MARGIN, y, CONTENT_WIDTH, 18, 4)
      .fillAndStroke(C_AZUL, C_AZUL);
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(texto, MARGIN + 8, y + 3);
    doc.y = y + 24;
    doc.moveDown(0.2);
  }

  function beginBox() {
    return doc.y;
  }

  function endBox(startY) {
    const endY = doc.y;
    doc
      .roundedRect(
        MARGIN - 3,
        startY - 4,
        CONTENT_WIDTH + 6,
        endY - startY + 8,
        6
      )
      .lineWidth(0.8)
      .strokeColor(C_GRIS_BORDE)
      .fillOpacity(0.03)
      .fillAndStroke(C_GRIS_FONDO, C_GRIS_BORDE);
    doc.y = endY;
    doc.fillOpacity(1);
  }

  // Extract JSON
  const ins = certJSON.instrumento || {};
  const cond = certJSON.condiciones || {};
  const resumen = certJSON.resumen_global || "";
  const firma = certJSON.firma || {};
  const patrones = certJSON.patrones || [];
  const bloques = certJSON.bloques || [];

  // ===========================  
  // 1 — DATOS DEL INSTRUMENTO
  // ===========================
  sectionTitle("1. Datos del instrumento");
  let box = beginBox();

  doc.font("Helvetica").fontSize(10).fillColor(C_TEXTO);
  doc.text(`Código: ${ins.codigo || "-"}`);
  doc.text(`Descripción: ${ins.descripcion || "-"}`);
  doc.text(`Fabricante / Tipo: ${ins.fabricante_tipo || "-"}`);
  doc.text(`Rango: ${ins.rango || "-"}`);
  doc.text(`Unidad base: ${ins.unidad_base || "-"}`);

  endBox(box);
  doc.moveDown(0.8);

  // ===========================
  // 2 — CONDICIONES AMBIENTALES
  // ===========================
  sectionTitle("2. Condiciones ambientales durante la calibración");
  box = beginBox();

  const colWidth = CONTENT_WIDTH / 3;
  const yRow = doc.y;

  doc.text(`Temperatura: ${cond.temperatura ?? "-"} °C`, MARGIN, yRow, { width: colWidth });
  doc.text(`Humedad relativa: ${cond.humedad ?? "-"} %`, MARGIN + colWidth, yRow, { width: colWidth });
  doc.text(`Fecha de calibración: ${cond.fecha_calibracion ?? "-"}`, MARGIN + colWidth * 2, yRow, { width: colWidth });

  doc.moveDown(1);

  if (cond.observaciones) {
    doc.fontSize(9).fillColor("#555").text(`Observaciones: ${cond.observaciones}`, {
      width: CONTENT_WIDTH,
    });
  }

  endBox(box);
  doc.moveDown(0.8);

  // ===========================
  // 3 — TRAZABILIDAD
  // ===========================
  sectionTitle("3. Trazabilidad metrológica y patrones utilizados");
  box = beginBox();

  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(C_TEXTO)
    .text(
      "La trazabilidad metrológica se garantiza mediante el uso de patrones calibrados " +
        "con trazabilidad al SI siguiendo buenas prácticas metrológicas y guías ISO/IEC 17025.",
      { width: CONTENT_WIDTH, align: "justify" }
    );

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").text("Patrones empleados:");
  doc.font("Helvetica").fontSize(9);

  if (!patrones.length) {
    doc.text("• No hay patrones informados.");
  } else {
    patrones.forEach((p) => {
      doc.text(`• ${p.codigo} — ${p.descripcion} (U(k=2): ${p.u_k2})`);
    });
  }

  endBox(box);
  doc.moveDown(0.8);

  // ===========================
  // 4 — RESULTADOS
  // ===========================
  sectionTitle("4. Resultados de la calibración (resumen)");
  box = beginBox();

  doc.font("Helvetica").fontSize(9.5).fillColor(C_TEXTO).text(
    "Se han evaluado los puntos definidos en el procedimiento de calibración. " +
      "El error se calcula como E = I − R y se aplica el criterio ILAC-G8 para determinar la conformidad.",
    { width: CONTENT_WIDTH, align: "justify" }
  );

  doc.moveDown(0.5);

  bloques.forEach((b, idx) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(C_AZUL)
      .text(`Bloque ${idx + 1}: ${b.tipo} — Patrón ${b.patron?.codigo}`, {
        width: CONTENT_WIDTH,
      });

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(C_TEXTO)
      .text(
        `Puntos evaluados: ${b.puntos?.length || 0} · Lado GO/NO GO: ${
          b.lado || "-"
        }`
      );

    doc.moveDown(0.25);
  });

  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9.5).fillColor(C_TEXTO).text(resumen, {
    width: CONTENT_WIDTH,
    align: "justify",
  });

  endBox(box);
  doc.moveDown(0.8);

  // ===========================
  // 5 — FIRMA Y SELLO
  // ===========================
  sectionTitle("5. Validación del certificado");
  box = beginBox();

  const half = CONTENT_WIDTH / 2;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(C_TEXTO)
    .text(`Operario responsable: ${firma.nombre}`, MARGIN, doc.y, { width: half })
    .moveDown(0.2)
    .text(`Próxima calibración: ${firma.proxima_calibracion}`, { width: half });

  doc.moveDown(1);

  // Firma manuscrita
  if (firma.firma_base64) {
    try {
      const img = firma.firma_base64.split(",")[1];
      const buf = Buffer.from(img, "base64");
      doc.image(buf, MARGIN, doc.y, { width: 120 });
      doc.fontSize(8).fillColor("#666").text("Firma manuscrita", MARGIN, doc.y + 45);
    } catch {
      doc.fontSize(8).fillColor("#555").text("(Firma no disponible)");
    }
  }

  // Sello
  const selloX = MARGIN + half + 80;
  const selloY = box + 20;

  doc.save();
  doc.circle(selloX + 35, selloY + 35, 32).lineWidth(1.5).strokeColor(C_NARANJA).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(C_AZUL)
    .text("LABORATORIO", selloX, selloY + 20, { width: 70, align: "center" })
    .text("TALLERES MECÁNICOS", selloX, selloY + 30, {
      width: 70,
      align: "center",
    })
    .text("PARAMIO", selloX, selloY + 40, { width: 70, align: "center" });
  doc.restore();

  endBox(box);
  doc.moveDown(0.8);

  // ===========================
  // 6 — VERIFICACIÓN
  // ===========================
  sectionTitle("6. Verificación del certificado");
  box = beginBox();

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C_TEXTO)
    .text(
      certJSON.qr?.url_verificacion
        ? `Este certificado puede verificarse en: ${certJSON.qr.url_verificacion}`
        : "No se ha definido una URL de verificación.",
      { width: CONTENT_WIDTH, align: "justify" }
    );

  endBox(box);

  // PIE LEGAL
  doc.moveDown(1);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .strokeColor(C_GRIS_BORDE)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#555")
    .moveDown(0.3)
    .text(
      "Este certificado ha sido emitido por el laboratorio interno de Talleres Mecánicos Paramio siguiendo principios ISO/IEC 17025 e ILAC-G8. La reproducción parcial no está permitida sin autorización.",
      { width: CONTENT_WIDTH, align: "justify" }
    );

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ==========================================
// HANDLER PRINCIPAL
// ==========================================
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1 — Número oficial
    const numero = await generarNumeroCertificado();

    // 2 — URL verificación
    const verificacionURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = { url_verificacion: verificacionURL };

    // 3 — Generar PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4 — Subir PDF
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5 — Decisión global
    let decisionGlobal = "APTO";
    if (certJSON.resumen_global.includes("NO APTO")) decisionGlobal = "NO APTO";
    if (certJSON.resumen_global.includes("INDETERMINADO"))
      decisionGlobal = "INDETERMINADO";

    // 6 — Guardar registro
    await supabase.from("certificados").insert({
      numero,
      datos: certJSON,
      certificado_pdf_url: pdfURL,
      decision_global: decisionGlobal,
      regla_decision: "ILAC-G8",
    });

    // 7 — Respuesta
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
