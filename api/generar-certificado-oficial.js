// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ==== CONFIG SUPABASE ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ==========================================
// Subir PDF a Supabase Storage
// ==========================================
async function subirPDF(buffer, fileName) {
  const { error } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("certificados")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// ==========================================
// Numeración oficial CC-AAAA-XXXX
// ==========================================
async function generarNumeroCertificado() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("certificados")
    .select("numero")
    .like("numero", `CC-${year}-%`);

  if (error) throw error;

  const nums = (data || []).map(r => {
    const m = r.numero?.match(/CC-\d+-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });

  const next = (Math.max(0, ...nums) + 1)
    .toString()
    .padStart(4, "0");

  return `CC-${year}-${next}`;
}

// ==========================================
// Helpers
// ==========================================
const fmt = (v, d = 3) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
};

// ==========================================
// GENERAR PDF OFICIAL
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", c => chunks.push(c));

  const hoy = new Date().toISOString().slice(0, 10);
  const urlVerif = certJSON.qr?.url_verificacion || "";

  const azul = "#005a9c";
  const naranja = "#f28c1a";
  const gris = "#444";

  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;

  // QR
  let qrBuf = null;
  if (urlVerif) {
    try {
      qrBuf = await QRCode.toBuffer(urlVerif);
    } catch {}
  }

  // ==============================
  // CABECERA
  // ==============================
  doc.font("Helvetica-Bold").fontSize(16).fillColor(azul);
  doc.text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });

  doc.moveDown(0.2);
  doc.fontSize(10).font("Helvetica").fillColor(gris);
  doc.text(`Número: ${numero}`, { align: "center" });
  doc.text(`Fecha de emisión: ${hoy}`, { align: "center" });

  doc.moveDown(0.3);
  doc
    .moveTo(x0, doc.y)
    .lineTo(x0 + ancho, doc.y)
    .strokeColor(naranja)
    .stroke();

  if (qrBuf) {
    doc.image(
      qrBuf,
      doc.page.width - 120,
      doc.page.margins.top,
      { width: 80 }
    );
  }

  // ==============================
  // 1. Instrumento
  // ==============================
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(azul);
  doc.text("1. Datos del instrumento");

  const i = certJSON.instrumento || {};
  doc.font("Helvetica").fontSize(9).fillColor(gris);
  doc.text(`Código: ${i.codigo || "—"}`);
  doc.text(`Descripción: ${i.descripcion || "—"}`);
  doc.text(`Fabricante / Tipo: ${i.fabricante_tipo || "—"}`);
  doc.text(`Rango: ${i.rango || "—"}`);
  doc.text(`Unidad base: ${i.unidad_base || "—"}`);

  // ==============================
  // 2. Condiciones ambientales
  // ==============================
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fillColor(azul);
  doc.text("2. Condiciones ambientales");

  const c = certJSON.condiciones || {};
  doc.font("Helvetica").fontSize(9).fillColor(gris);
  doc.text(`Temperatura: ${c.temperatura ?? "—"} °C`);
  doc.text(`Humedad: ${c.humedad ?? "—"} %`);
  doc.text(`Fecha de calibración: ${c.fecha_calibracion ?? "—"}`);
  if (c.observaciones) doc.text(`Observaciones: ${c.observaciones}`);

  // ==============================
  // 3. Resultados detallados
  // ==============================
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(azul);
  doc.text("ANEXO METROLÓGICO · RESULTADOS DETALLADOS", {
    align: "center",
  });

  doc.moveDown(0.5);

  (certJSON.bloques || []).forEach((b, idx) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(azul);
    doc.text(
      `Bloque ${idx + 1} · ${b.tipo} · Patrón ${b.patron?.codigo || "—"}`
    );

    doc.font("Helvetica").fontSize(8).fillColor(gris);
    doc.text(`Lado: ${b.lado || "—"}`);
    doc.moveDown(0.3);

    // TABLA LECTURAS
    doc.font("Helvetica-Bold").text("Lecturas y estadísticos");
    doc.font("Helvetica");

    (b.puntos || []).forEach(p => {
      const r = p.lecturas || [];
      doc.text(
        `Nominal ${fmt(p.nominal, 3)} mm · ` +
          `R1=${fmt(r[0])} R2=${fmt(r[1])} R3=${fmt(r[2])} ` +
          `R4=${fmt(r[3])} R5=${fmt(r[4])} · ` +
          `Media=${fmt(p.media)} σ=${fmt(p.sigma)}`
      );
    });

    doc.moveDown(0.3);

    // TABLA RESULTADOS
    doc.font("Helvetica-Bold").text("Resultados metrológicos");
    doc.font("Helvetica");

    (b.puntos || []).forEach(p => {
      doc.text(
        `Nominal ${fmt(p.nominal)} mm · ` +
          `Error=${fmt(p.error_um, 1)} µm · ` +
          `U=${fmt(p.U_um, 1)} µm · ` +
          `T=${fmt(p.T_um, 1)} µm · ` +
          `Decisión=${p.decision || "—"}`
      );
    });

    doc.moveDown(0.8);
  });

  doc.end();
  return new Promise(res => doc.on("end", () => res(Buffer.concat(chunks))));
}

// ==========================================
// HANDLER
// ==========================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  try {
    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const numero = await generarNumeroCertificado();
    const verifURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = { url_verificacion: verifURL };

    const pdfBuffer = await generarPDF(certJSON, numero);
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    const resumen = certJSON.resumen_global || "";
    let decision = "APTO";
    if (resumen.includes("NO APTO")) decision = "NO APTO";
    else if (resumen.includes("INDETERMINADO")) decision = "INDETERMINADO";

    await supabase.from("certificados").insert({
      numero,
      datos: certJSON,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: decision,
    });

    return res.json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verifURL,
      },
    });
  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
