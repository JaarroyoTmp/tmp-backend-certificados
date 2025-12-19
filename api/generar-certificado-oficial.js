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

  const nums = (data || []).map(r => {
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
// GENERAR PDF (SIN NORMALIZACIONES INTERNAS)
// ======================================================
async function generarPDF(cert, numero) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", c => chunks.push(c));

  const fecha = new Date().toISOString().slice(0, 10);
  const urlVerif = cert.qr?.url_verificacion || "";

  // --------- CABECERA ----------
  doc.fontSize(16).font("Helvetica-Bold")
    .text("CERTIFICADO DE CALIBRACIÓN", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica")
    .text(`Número: ${numero}`, { align: "center" })
    .text(`Fecha de emisión: ${fecha}`, { align: "center" });

  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();

  // --------- QR ----------
  if (urlVerif) {
    const qr = await QRCode.toBuffer(urlVerif);
    doc.image(qr, 460, 80, { width: 80 });
    doc.fontSize(7).text("Verificación online", 460, 165, {
      width: 80,
      align: "center",
    });
  }

  // --------- DATOS INSTRUMENTO ----------
  doc.moveDown(2);
  doc.font("Helvetica-Bold").fontSize(11)
    .text("1. Datos del instrumento");
  doc.font("Helvetica").fontSize(9);

  const i = cert.instrumento || {};
  doc.text(`Código: ${i.codigo || "-"}`);
  doc.text(`Descripción: ${i.descripcion || "-"}`);
  doc.text(`Fabricante / Tipo: ${i.fabricante_tipo || "-"}`);
  doc.text(`Rango: ${i.rango || "-"}`);
  doc.text(`Unidad base: ${i.unidad_base || "-"}`);

  // --------- CONDICIONES ----------
  doc.moveDown();
  doc.font("Helvetica-Bold").text("2. Condiciones ambientales");
  doc.font("Helvetica");

  const c = cert.condiciones || {};
  doc.text(`Temperatura: ${c.temperatura ?? "—"} °C`);
  doc.text(`Humedad: ${c.humedad ?? "—"} %`);
  doc.text(`Fecha calibración: ${c.fecha_calibracion ?? "—"}`);

  // --------- RESULTADOS ----------
  doc.moveDown();
  doc.font("Helvetica-Bold").text("3. Resultados");
  doc.font("Helvetica");
  doc.text(cert.resumen_global || "—");

  // --------- FIRMA ----------
  doc.moveDown();
  doc.font("Helvetica-Bold").text("4. Validación");
  doc.font("Helvetica");

  const f = cert.firma || {};
  doc.text(`Operario: ${f.nombre || "—"}`);
  doc.text(`Próxima calibración: ${f.proxima_calibracion || "—"}`);

  if (f.firma_base64) {
    try {
      const img = f.firma_base64.replace(/^data:image\/png;base64,/, "");
      doc.image(Buffer.from(img, "base64"), {
        fit: [120, 40],
      });
    } catch {}
  }

  // --------- PIE ----------
  doc.moveDown();
  doc.fontSize(7).fillColor("#666")
    .text(
      "Emitido conforme a ISO/IEC 17025 e ILAC-G8. Reproducción parcial no permitida.",
      { align: "justify" }
    );

  doc.end();
  return new Promise(r => doc.on("end", () => r(Buffer.concat(chunks))));
}

// ======================================================
// HANDLER PRINCIPAL (ESTABLE)
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

    // 1️⃣ Número
    const numero = await generarNumeroCertificado();

    // 2️⃣ Verificación
    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;

    certJSON.qr = { url_verificacion: verificacionURL };

    // 3️⃣ PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4️⃣ Subir
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5️⃣ Guardar
    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: "APTO",
    });

    // 6️⃣ RESPUESTA
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
