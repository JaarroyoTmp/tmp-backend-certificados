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
// HELPERS
// ==========================================
const fmt = (v, d = 3) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
};

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function pickLecturas(p) {
  return (
    p.lecturas ||
    p.repeticiones ||
    p.mediciones ||
    []
  ).map(v => num(v)).filter(v => v !== null);
}

function decisionILAC(error, U, T) {
  if (error === null || U === null || T === null) return "—";
  if (Math.abs(error) + U <= T) return "APTO";
  if (Math.abs(error) - U > T) return "NO APTO";
  return "INDETERMINADO";
}

// ==========================================
// LIMPIAR JSON (CRÍTICO – evita stack overflow)
// ==========================================
function limpiarCertJSON(certJSON) {
  return {
    instrumento: certJSON.instrumento,
    condiciones: certJSON.condiciones,
    resumen_global: certJSON.resumen_global,
    patrones: certJSON.patrones,
    firma: {
      nombre: certJSON.firma?.nombre,
      proxima_calibracion: certJSON.firma?.proxima_calibracion
      // ⛔ NO firma_base64
    },
    bloques: (certJSON.bloques || []).map(b => ({
      tipo: b.tipo,
      lado: b.lado,
      patron: {
        codigo: b.patron?.codigo,
        descripcion: b.patron?.descripcion
      },
      puntos: (b.puntos || []).map(p => ({
        nominal: p.nominal,
        media: p.media,
        sigma: p.sigma,
        error_um: p.error_um,
        U_um: p.U_um,
        T_um: p.T_um,
        decision: p.decision
      }))
    }))
  };
}

// ==========================================
// GENERAR PDF OFICIAL
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", c => chunks.push(c));

  const azul = "#0B4EA2";
  const naranja = "#F28C1A";
  const gris = "#444";

  const hoy = new Date().toISOString().slice(0, 10);
  const urlVerif = certJSON.qr?.url_verificacion || "";

  // QR
  let qrBuf = null;
  if (urlVerif) qrBuf = await QRCode.toBuffer(urlVerif);

  // ===== PORTADA =====
  doc.font("Helvetica-Bold").fontSize(16).fillColor(azul);
  doc.text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });

  doc.moveDown(0.2);
  doc.fontSize(10).font("Helvetica").fillColor(gris);
  doc.text(`Número: ${numero}`, { align: "center" });
  doc.text(`Fecha de emisión: ${hoy}`, { align: "center" });

  if (qrBuf) doc.image(qrBuf, 460, 50, { width: 80 });

  doc.moveDown(1);

  // ===== DATOS INSTRUMENTO =====
  const i = certJSON.instrumento || {};
  doc.font("Helvetica-Bold").fontSize(11).fillColor(azul);
  doc.text("1. Datos del instrumento");

  doc.font("Helvetica").fontSize(9).fillColor(gris);
  doc.text(`Código: ${i.codigo || "—"}`);
  doc.text(`Descripción: ${i.descripcion || "—"}`);
  doc.text(`Fabricante / Tipo: ${i.fabricante_tipo || "—"}`);
  doc.text(`Rango: ${i.rango || "—"}`);
  doc.text(`Unidad base: ${i.unidad_base || "—"}`);

  // ===== CONDICIONES =====
  const c = certJSON.condiciones || {};
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fillColor(azul);
  doc.text("2. Condiciones ambientales");

  doc.font("Helvetica").fontSize(9).fillColor(gris);
  doc.text(`Temperatura: ${c.temperatura ?? "—"} °C`);
  doc.text(`Humedad: ${c.humedad ?? "—"} %`);
  doc.text(`Fecha de calibración: ${c.fecha_calibracion ?? "—"}`);

  // ===== ANEXO =====
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(azul);
  doc.text("ANEXO METROLÓGICO · RESULTADOS DETALLADOS", { align: "center" });

  doc.moveDown(0.8);

  (certJSON.bloques || []).forEach((b, idx) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(azul);
    doc.text(`Bloque ${idx + 1} · ${b.tipo || ""}`);

    (b.puntos || []).forEach(p => {
      const lect = pickLecturas(p);
      const media = num(p.media);
      const sigma = num(p.sigma);
      const error = num(p.error_um);
      const U = num(p.U_um);
      const T = num(p.T_um);
      const dec = p.decision || decisionILAC(error, U, T);

      doc.font("Helvetica").fontSize(8).fillColor(gris);
      doc.text(
        `Nominal ${fmt(p.nominal)} | ` +
        `R: ${lect.map(v => fmt(v)).join(", ")} | ` +
        `Media=${fmt(media)} σ=${fmt(sigma)} | ` +
        `E=${fmt(error,1)} U=${fmt(U,1)} T=${fmt(T,1)} → ${dec}`
      );
    });

    doc.moveDown(0.6);
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
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const certJSON = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const numero = await generarNumeroCertificado();
    const verifURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = { url_verificacion: verifURL };

    const pdfBuffer = await generarPDF(certJSON, numero);
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    const certJSON_limpio = limpiarCertJSON(certJSON);

    await supabase.from("certificados").insert({
      numero,
      datos: certJSON_limpio,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: "APTO"
    });

    return res.json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verifURL
      }
    });

  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
