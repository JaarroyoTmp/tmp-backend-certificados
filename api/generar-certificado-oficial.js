// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import { Readable } from "stream";

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
      upsert: true
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

  const nums = data.map(r => {
    const m = r.numero.match(/CC-\d+-(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });

  const next = (Math.max(0, ...nums) + 1).toString().padStart(4, "0");

  return `CC-${year}-${next}`;
}

// ==========================================
// Generar PDF oficial de calibración
// ==========================================
function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];

  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => {});

  // === Encabezado ===
  doc.fontSize(18).text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Número: ${numero}`);
  doc.text(`Fecha de emisión: ${new Date().toISOString().substring(0,10)}`);

  doc.moveDown();
  doc.fontSize(14).text("1. Instrumento");
  doc.fontSize(11);
  doc.text(`Código: ${certJSON.instrumento.codigo}`);
  doc.text(`Descripción: ${certJSON.instrumento.descripcion}`);
  doc.text(`Fabricante / Tipo: ${certJSON.instrumento.fabricante_tipo}`);
  doc.text(`Rango: ${certJSON.instrumento.rango}`);
  doc.text(`Unidad base: ${certJSON.instrumento.unidad_base}`);

  // === Condiciones ambientales ===
  doc.moveDown();
  doc.fontSize(14).text("2. Condiciones ambientales");
  doc.fontSize(11);
  doc.text(`Temperatura: ${certJSON.condiciones.temperatura} °C`);
  doc.text(`Humedad: ${certJSON.condiciones.humedad} %`);
  doc.text(`Fecha calibración: ${certJSON.condiciones.fecha_calibracion}`);

  // === Bloques ===
  doc.moveDown();
  doc.fontSize(14).text("3. Resultados");
  certJSON.bloques.forEach(b => {
    doc.moveDown();
    doc.fontSize(12).text(`Bloque ${b.tipo} · ${b.patron.codigo} – ${b.patron.descripcion}`);
    doc.fontSize(10);

    b.puntos.forEach(p => {
      doc.text(
        `Nominal: ${p.nominal} mm | Media: ${p.media} | σ: ${p.sigma} | Corr: ${p.correccion_patron}`
      );
    });
  });

  // === Firma ===
  doc.moveDown();
  doc.fontSize(14).text("Firma y validación");
  doc.fontSize(11).text(`Operario: ${certJSON.firma.nombre}`);
  doc.text(`Próxima calibración: ${certJSON.firma.proxima_calibracion}`);

  // Firma imagen base64
  if (certJSON.firma.firma_base64) {
    const img = certJSON.firma.firma_base64.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(img, "base64");
    doc.image(buffer, { fit: [200,100] });
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
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON = JSON.parse(req.body);

    // 1) Crear número oficial
    const numero = await generarNumeroCertificado();

    // 2) Crear PDF oficial
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 3) Subir PDF
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 4) Registrar en Supabase el JSON completo
    await supabase.from("certificados").insert({
      numero,
      datos: certJSON,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: certJSON.resumen_global.includes("NO APTO")
        ? "NO APTO"
        : certJSON.resumen_global.includes("INDETERMINADO")
        ? "INDETERMINADO"
        : "APTO"
    });

    // 5) Respuesta al frontend
    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: `https://TU-DOMINIO/cert/${numero}`
      }
    });

  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
