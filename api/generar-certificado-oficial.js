// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

// ==== CONFIG ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// Ruta del logo Paramio
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

  const { data: publicURL } = supabase.storage
    .from("certificados")
    .getPublicUrl(fileName);

  return publicURL.publicUrl;
}

// ==========================================
// GENERAR NÚMERO CC-2025-0012
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
    margin: 40,
    info: {
      Title: `Certificado ${numero}`,
      Author: "Talleres Mecánicos Paramio",
      Subject: "Certificado de calibración",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const hoy = new Date().toISOString().substring(0, 10);

  // COLORES CORPORATIVOS
  const C_AZUL = "#00457A";
  const C_NARANJA = "#E86A1F";
  const C_GRIS = "#F5F3F0";
  const C_TEXTO = "#333333";

  // QR
  let qrBuffer = null;
  if (certJSON.qr?.url_verificacion) {
    const qrDataURL = await QRCode.toDataURL(certJSON.qr.url_verificacion);
    qrBuffer = Buffer.from(qrDataURL.split(",")[1], "base64");
  }

  // ===========================
  // CABECERA CON LOGO
  // ===========================
  try {
    doc.image(LOGO_PATH, 40, 40, { width: 120 });
  } catch (e) {
    console.warn("⚠️ No pude cargar el logo:", e);
  }

  doc
    .fillColor(C_AZUL)
    .fontSize(20)
    .text("CERTIFICADO DE CALIBRACIÓN", 180, 45, { align: "right" })
    .fontSize(11)
    .fillColor(C_TEXTO)
    .text(`Número: ${numero}`, { align: "right" })
    .text(`Fecha de emisión: ${hoy}`, { align: "right" });

  doc
    .moveTo(40, 100)
    .lineTo(555, 100)
    .lineWidth(2)
    .strokeColor(C_NARANJA)
    .stroke();

  // QR esquina superior derecha
  if (qrBuffer) {
    doc.image(qrBuffer, 435, 115, { width: 110 });
    doc
      .fontSize(8)
      .fillColor("#555")
      .text("Verificación online", 435, 230, { width: 110, align: "center" });
  }

  doc.moveDown(3);

  // ===========================
  // 1. DATOS DEL INSTRUMENTO
  // ===========================
  const ins = certJSON.instrumento;

  doc.fillColor(C_AZUL).fontSize(14).text("1. Datos del instrumento", { underline: true });
  doc.moveDown(0.5);

  doc.fillColor(C_TEXTO).fontSize(10);
  doc.text(`Código: ${ins.codigo}`);
  doc.text(`Descripción: ${ins.descripcion}`);
  doc.text(`Fabricante / Tipo: ${ins.fabricante_tipo}`);
  doc.text(`Rango: ${ins.rango}`);
  doc.text(`Unidad base: ${ins.unidad_base}`);

  doc.moveDown(1);

  // ===========================
  // 2. CONDICIONES AMBIENTALES
  // ===========================
  const cond = certJSON.condiciones;

  doc.fillColor(C_AZUL).fontSize(14).text("2. Condiciones ambientales", { underline: true });
  doc.moveDown(0.4);

  const yBox = doc.y;

  doc
    .roundedRect(40, yBox - 4, 515, 40, 6)
    .fillAndStroke(C_GRIS, "#CCCCCC");

  doc
    .fillColor(C_TEXTO)
    .fontSize(10)
    .text(`Temperatura: ${cond.temperatura} °C`, 48, yBox, { width: 170 })
    .text(`Humedad relativa: ${cond.humedad} %`, 230, yBox, { width: 150 })
    .text(`Fecha calibración: ${cond.fecha_calibracion}`, 400, yBox, { width: 140 });

  doc.y = yBox + 50;

  if (cond.observaciones) {
    doc.fontSize(9).text(`Observaciones: ${cond.observaciones}`);
  }

  doc.moveDown(1);

  // ===========================
  // 3. TRAZABILIDAD Y PATRONES
  // ===========================
  doc.fillColor(C_AZUL).fontSize(14).text("3. Trazabilidad metrológica", { underline: true });
  doc.moveDown(0.5);

  doc
    .fontSize(10)
    .fillColor(C_TEXTO)
    .text(
      "La trazabilidad se garantiza mediante el uso de patrones materializados con calibración vigente " +
        "y trazabilidad al Sistema Internacional de Unidades (SI)."
    );

  doc.moveDown(0.3).fontSize(10).text("Patrones utilizados:");
  certJSON.patrones.forEach((p) => {
    doc.fontSize(9).text(`• ${p.codigo} — ${p.descripcion}   (U(k=2): ${p.u_k2})`);
  });

  doc.moveDown(1);

  // ===========================
  // 4. RESULTADOS
  // ===========================
  doc.fillColor(C_AZUL).fontSize(14).text("4. Resultados de calibración", { underline: true });
  doc.moveDown(0.4);

  certJSON.bloques.forEach((b, idx) => {
    if (doc.y > 700) doc.addPage();

    doc.fontSize(11).fillColor(C_AZUL);
    doc.text(`Bloque ${idx + 1} — Tipo: ${b.tipo}`);
    doc.fontSize(9).fillColor(C_TEXTO);
    doc.text(`Patrón: ${b.patron.codigo} — ${b.patron.descripcion}`);
    doc.text(`Lado GO/NO GO: ${b.lado}`);
    doc.moveDown(0.3);

    doc.fontSize(8).fillColor(C_AZUL).text("Nominal | Media | σ | Corr. | Característica");
    doc.fillColor(C_TEXTO);

    b.puntos.forEach((p) => {
      doc.text(
        `${p.nominal} | ${p.media} | ${p.sigma} | ${p.correccion_patron} | ${p.caracteristica}`
      );
    });

    doc.moveDown(0.6);
  });

  // ===========================
  // 5. RESUMEN GLOBAL
  // ===========================
  doc.addPage();
  doc.fillColor(C_AZUL).fontSize(14).text("5. Resumen global", { underline: true });
  doc.moveDown(0.5);
  doc.fillColor(C_TEXTO).fontSize(10).text(certJSON.resumen_global);

  doc.moveDown(1);

  // ===========================
  // 6. FIRMA Y SELLO TMP
  // ===========================
  const firma = certJSON.firma;

  doc.fillColor(C_AZUL).fontSize(14).text("6. Validación del certificado", { underline: true });
  doc.moveDown(0.5);

  doc.fillColor(C_TEXTO).fontSize(10);
  doc.text(`Operario responsable: ${firma.nombre}`);
  doc.text(`Próxima calibración: ${firma.proxima_calibracion}`);
  doc.moveDown(0.5);

  // Firma manuscrita
  if (firma.firma_base64) {
    const img = firma.firma_base64.split(",")[1];
    const buf = Buffer.from(img, "base64");
    doc.image(buf, { fit: [160, 60] });
  }

  // SELLO INTERNO TMP
  const sx = 430;
  const sy = 650;

  doc.save();
  doc.circle(sx + 50, sy + 30, 45).lineWidth(2).strokeColor(C_NARANJA).stroke();
  doc.restore();

  doc
    .fontSize(8)
    .fillColor(C_AZUL)
    .text("VALIDACIÓN", sx + 5, sy + 10, { width: 90, align: "center" })
    .text("INTERNA TMP", sx + 5, sy + 22, { width: 90, align: "center" })
    .fontSize(7)
    .fillColor(C_TEXTO)
    .text(`Calibración ${hoy}`, sx + 5, sy + 36, { width: 90, align: "center" });

  // ===========================
  // PIE LEGAL
  // ===========================
  doc
    .moveTo(40, 800)
    .lineTo(555, 800)
    .strokeColor("#CCCCCC")
    .stroke();

  doc
    .fontSize(7)
    .fillColor("#555")
    .text(
      "Este certificado es emitido por el laboratorio interno de Talleres Mecánicos Paramio. " +
        "Su emisión sigue los principios de ISO/IEC 17025 e ILAC-G8. No implica acreditación externa.",
      40,
      805,
      { width: 515, align: "justify" }
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
    if (req.method !== "POST")
      return res.status(405).json({ error: "Método no permitido" });

    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1 — Número oficial
    const numero = await generarNumeroCertificado();

    // 2 — URL de verificación
    const verificacionURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = { url_verificacion: verificacionURL };

    // 3 — Crear PDF profesional
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
