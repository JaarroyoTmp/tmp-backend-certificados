export default async function handler(req, res) {
  console.log(">> API llamada");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { html, filename } = req.body;

    console.log(">> HTML recibido:", html ? "OK" : "VACÍO");

    const apiKey = process.env.PDFSHIFT_API_KEY;

    console.log(">> API KEY CARGADA:", apiKey ? "OK" : "NO ENCONTRADA");

    if (!apiKey) {
      return res.status(500).json({ error: "Missing PDFShift API key" });
    }

    const pdfResponse = await fetch("https://api.pdfshift.io/v2/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey, // ← ESTA ES LA FORMA CORRECTA
      },
      body: JSON.stringify({
        source: html,
        use_print: true,
        background: true,
      }),
    });

    console.log(">> Respuesta PDFSHIFT Status:", pdfRes.status);

    const buffer = await pdfRes.arrayBuffer();

    if (!pdfRes.ok) {
      const errText = Buffer.from(buffer).toString();
      console.log(">> Error PDFShift:", errText);
      return res.status(500).json({ error: errText });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename || "certificado.pdf"}"`
    );

    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error("🔥 Error en servidor:", error);
    return res.status(500).json({ error: error.toString() });
  }
}

