// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode"; // 🟢 NUEVO: librería para generar QR

// ==== CONFIG ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY; // clave service role
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
// Generar PDF oficial de calibración (plantilla profesional)
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: `Certificado ${numero}`,
      Author: "TMP Calibration System",
      Subject: "Certificado de calibración",
    },
  });

  const chunks = [];
  doc.on("data", chunks.push.bind(chunks));

  const hoyISO = new Date().toISOString().substring(0, 10);

  // URL de verificación (ya viene en certJSON.qr.url_verificacion)
  const urlVerif = certJSON.qr?.url_verificacion || "";

  // ================================
  // GENERAR QR (si hay URL de verificación)
  // ================================
  let qrBuffer = null;
  if (urlVerif) {
    try {
      qrBuffer = await QRCode.toBuffer(urlVerif, {
        errorCorrectionLevel: "M",
      });
    } catch (e) {
      console.error("Error generando QR:", e);
    }
  }

  // ========== ENCABEZADO ==========
  doc.fontSize(20).text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Número: ${numero}`, { align: "center" });
  doc.text(`Fecha de emisión: ${hoyISO}`, { align: "center" });
  doc.moveDown(1);

  // QR en la esquina superior derecha
  if (qrBuffer) {
    try {
      // Ajusta posiciones si quieres mover el QR
      doc.image(qrBuffer, 430, 40, { fit: [120, 120] });
      doc.fontSize(8).text(
        "Verificación online",
        430,
        165,
        { width: 120, align: "center" }
      );
    } catch (e) {
      console.error("No se pudo dibujar el QR en el PDF:", e);
    }
  }

  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();

  // ==========================================
  // 1 · DATOS DEL INSTRUMENTO
  // ==========================================
  doc.moveDown(1);
  doc.fontSize(14).text("1. Datos del instrumento", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);

  const ins = certJSON.instrumento || {};
  doc.text(`Código: ${ins.codigo || "-"}`);
  doc.text(`Descripción: ${ins.descripcion || "-"}`);
  doc.text(`Fabricante / Tipo: ${ins.fabricante_tipo || "-"}`);
  doc.text(`Rango: ${ins.rango || "-"}`);
  doc.text(`Unidad base: ${ins.unidad_base || "-"}`);
  doc.moveDown(1);

  // ==========================================
  // 2 · CONDICIONES AMBIENTALES
  // ==========================================
  doc.fontSize(14).text("2. Condiciones ambientales", { underline: true });
  doc.moveDown(0.5);

  const cond = certJSON.condiciones || {};
  doc.fontSize(11).text(`Temperatura: ${cond.temperatura ?? "-"} °C`);
  doc.text(`Humedad relativa: ${cond.humedad ?? "-"} %`);
  doc.text(`Fecha de calibración: ${cond.fecha_calibracion ?? "-"}`);
  if (cond.observaciones) {
    doc.moveDown(0.3);
    doc.text(`Observaciones: ${cond.observaciones}`);
  }
  doc.moveDown(1);

  // ==========================================
  // 3 · TRAZABILIDAD METROLÓGICA
  // ==========================================
  doc.fontSize(14).text("3. Trazabilidad metrológica", { underline: true });
  doc.moveDown(0.5);

  doc.fontSize(11).text(
    "La trazabilidad metrológica se garantiza mediante el uso de patrones materializados " +
      "calibrados por laboratorios acreditados o con trazabilidad al SI, de acuerdo con ISO/IEC 17025."
  );

  doc.moveDown(0.5);
  doc.fontSize(12).text("Patrones utilizados:");
  doc.moveDown(0.3);

  (certJSON.patrones || []).forEach((p) => {
    doc.fontSize(11).text(
      `• ${p.codigo || "-"} — ${p.descripcion || "-"} (U(k=2): ${p.u_k2 ?? "-"})`
    );
  });

  doc.moveDown(1);

  // ==========================================
  // 4 · RESULTADOS DE CALIBRACIÓN
  // ==========================================
  doc.fontSize(14).text("4. Resultados de calibración", { underline: true });
  doc.moveDown(0.5);

  const bloques = certJSON.bloques || [];
  bloques.forEach((b, idx) => {
    // Nueva página si estamos muy abajo
    if (doc.y > 720) doc.addPage();

    doc.fontSize(12).text(`Bloque ${idx + 1} — Tipo: ${b.tipo || "-"}`);
    doc.fontSize(11).text(
      `Patrón: ${(b.patron && b.patron.codigo) || "-"} — ${(b.patron && b.patron.descripcion) || "-"}`
    );
    doc.text(`Lado GO/NO GO: ${b.lado || "-"}`);
    doc.moveDown(0.3);

    doc.fontSize(10).text("Nominal   Media   σ   Corr   Característica");
    doc.moveDown(0.2);

    (b.puntos || []).forEach((p) => {
      doc.text(
        `${p.nominal ?? "-"}   ${p.media ?? "-"}   ${p.sigma ?? "-"}   ${
          p.correccion_patron ?? "-"
        }   ${p.caracteristica || "-"}`
      );
    });

    doc.moveDown(0.8);
  });

  // ==========================================
  // 5 · RESUMEN GLOBAL
  // ==========================================
  doc.addPage();
  doc.fontSize(14).text("5. Resumen global de la calibración", { underline: true });
  doc.moveDown(0.8);

  doc.fontSize(11).text(certJSON.resumen_global || "(Sin resumen global)");
  doc.moveDown(2);

  // ==========================================
  // 6 · FIRMA Y VALIDACIÓN
  // ==========================================
  doc.fontSize(14).text("6. Validación del certificado", { underline: true });
  doc.moveDown(1);

  const firma = certJSON.firma || {};
  doc.fontSize(11).text(`Operario responsable: ${firma.nombre || "-"}`);
  doc.text(`Próxima calibración: ${firma.proxima_calibracion || "-"}`);
  doc.moveDown(0.5);

  if (firma.firma_base64) {
    try {
      const img = firma.firma_base64.replace(/^data:image\/png;base64,/, "");
      const buf = Buffer.from(img, "base64");
      doc.image(buf, { fit: [160, 60] });
    } catch (e) {
      doc.fontSize(10).text("(No se pudo insertar la firma manuscrita)");
    }
  } else {
    doc.fontSize(10).text("(Firma manuscrita no disponible)");
  }

  doc.moveDown(2);

  // ==========================================
  // 7 · VERIFICACIÓN DEL CERTIFICADO
  // ==========================================
  doc.fontSize(12).text("Verificación del certificado", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text(
    urlVerif
      ? `Puede verificar la validez de este certificado en: ${urlVerif}`
      : "URL de verificación no disponible."
  );

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1) Crear número oficial
    const numero = await generarNumeroCertificado();

    // 2) Crear URL de verificación y meterla en el JSON
    // ⬇️ CAMBIA "https://TU-DOMINIO" por tu dominio real (por ejemplo, el de Vercel)
    const verificacionURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3) Crear PDF oficial con la plantilla profesional (ya con QR)
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4) Subir PDF
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5) Determinar decisión global a partir del resumen
    const resumenTxt = certJSON.resumen_global || "";
    let decisionGlobal = "APTO";
    if (resumenTxt.includes("NO APTO")) decisionGlobal = "NO APTO";
    else if (resumenTxt.includes("INDETERMINADO"))
      decisionGlobal = "INDETERMINADO";

    // 6) Registrar en Supabase el JSON completo
    await supabase.from("certificados").insert({
      numero,
      datos: certJSON, // JSON completo, con qr.url_verificacion incluido
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
