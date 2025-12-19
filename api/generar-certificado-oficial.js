export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
  runtime: "nodejs",
};

// ==========================================
// API: generar-certificado-oficial (BASE)
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

// ==== CONFIG SUPABASE ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ==========================================
// Utilidad para subir PDF
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
// Número certificado CC-AAAA-XXXX
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
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (v, d = 3) =>
  Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—";

function pickLecturas(p) {
  const r =
    p?.lecturas ??
    p?.lecturas_mm ??
    p?.mediciones ??
    p?.repeticiones ??
    [];
  return [toNum(r[0]), toNum(r[1]), toNum(r[2]), toNum(r[3]), toNum(r[4])];
}

function limpiarParaBD(certJSON) {
  const out = JSON.parse(JSON.stringify(certJSON));
  if (out?.firma?.firma_base64) delete out.firma.firma_base64;
  return out;
}

function cargarLogoLocal() {
  try {
    const p = path.join(process.cwd(), "api", "logo-paramio.png");
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  } catch {
    return null;
  }
}

// ==========================================
// PDF (se mantiene tu función tal cual)
// ==========================================
// ⬇️ NO la repito aquí para no duplicar,
// es EXACTAMENTE la que ya has pegado arriba
// ==========================================


// ==========================================
// MAIN HANDLER (ÚNICO)
// ==========================================
export default async function handler(req, res) {
  console.log(">>> START generar-certificado-oficial", req.method);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://trazabilidad-tmp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  try {
    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const numero = await generarNumeroCertificado();

    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = { url_verificacion: verificacionURL };

    if (certJSON?.firma?.firma_base64?.length > 600000) {
      certJSON.firma.firma_base64 = null;
    }

    const pdfBuffer = await generarPDF(certJSON, numero);
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    const resumenTxt = certJSON.resumen_global || "";
    let decisionGlobal = "APTO";
    if (resumenTxt.includes("NO APTO")) decisionGlobal = "NO APTO";
    else if (resumenTxt.includes("INDETERMINADO"))
      decisionGlobal = "INDETERMINADO";

    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: decisionGlobal,
    });

    console.log(">>> OK certificado emitido", numero);

    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verificacionURL,
      },
    });
  } catch (e) {
    console.error(">>> ERROR BACKEND:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

