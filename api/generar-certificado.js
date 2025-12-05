export default async function handler(req, res) {
  // 1) Aceptar solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    // 2) Leer API key del entorno
    const apiKey = process.env.PDFSHIFT_API_KEY;

    // Para depuración: se verá en Runtime Logs de Vercel
    console.log("API KEY RECIBIDA EN SERVIDOR:", JSON.stringify(apiKey); // DEBUG

    if (!apiKey) {
      return res.status(500).json({ error: "Missing PDFShift API key" });
    }

    // 3) Petición a PDFShift (autenticación correcta con X-API-Key)
    const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        source: html,    // Enviamos HTML directamente
        use_print: true,
        background: true,
      }),
    });

    const buffer = await pdfRes.arrayBuffer();

    // Para ver si PDFShift devuelve un error en texto
    if (!pdfRes.ok) {
      const textError = Buffer.from(buffer).toString();
      console.error("PDFSHIFT ERROR:", textError);

      return res.status(500).json({ error: textError });
    }

    // 4) Responder el PDF al navegador
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename || "certificado.pdf"}"`
    );

    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error("PDF ERROR:", error);
    return res.status(500).json({ error: error.toString() });
  }
}
