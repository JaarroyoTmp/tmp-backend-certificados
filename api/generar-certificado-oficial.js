import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

// ================== CONFIG VERCEL ==================
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
  runtime: "nodejs",
};

// ================== SUPABASE ==================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("Faltan variables de entorno SUPABASE");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ================== HELPERS ==================
function limpiarParaBD(certJSON) {
  const copia = JSON.parse(JSON.stringify(certJSON));
  if (copia?.firma?.firma_base64) delete copia.firma.firma_base64;
  return copia;
}

// ================== NUMERO CERTIFICADO ==================
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

// ================== PDF MINIMO (PRUEBA) ==================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];

  doc.on("data", (c) => chunks.push(c));

  doc.fontSize(18).text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Número: ${numero}`);
  doc.text(`Instrumento: ${certJSON.instrumento?.descripcion || "-"}`);
  doc.text(`Operario: ${certJSON.firma?.nombre || "-"}`);

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ================== SUBIR PDF ==================
async function subirPDF(buffer, fileName) {
  const { error } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase
    .storage
    .from("certificados")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// ================== HANDLER ==================
export default async function handler(req, res) {
  console.log(">>> START generar-certificado-oficial", req.method);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://trazabilidad-tmp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1️⃣ Número
    const numero = await generarNumeroCertificado();

    // 2️⃣ URL verificación
    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;

    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3️⃣ PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4️⃣ Subir
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5️⃣ Guardar BD
    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: "APTO",
    });

    // 6️⃣ RESPUESTA (CLAVE PARA TU HTML)
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
    return res.status(500).json({
      ok: false,
      error: e.message || "Error interno",
    });
  }
}
