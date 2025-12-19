export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
  runtime: "nodejs",
};

export default async function handler(req, res) {
  console.log(">>> START generar-certificado-oficial", {
    method: req.method,
    contentType: req.headers["content-type"],
  });

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://trazabilidad-tmp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1️⃣ Generar número
    const numero = await generarNumeroCertificado();

    // 2️⃣ URL verificación
    const verificacionURL =
      `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;

    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3️⃣ Generar PDF
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4️⃣ Subir PDF
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5️⃣ Guardar en Supabase
    await supabase.from("certificados").insert({
      numero,
      datos: limpiarParaBD(certJSON),
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: "APTO",
    });

    // ✅ 6️⃣ RESPUESTA CORRECTA (ESTE ES EL PUNTO CLAVE)
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
