export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    const apiKey = process.env.PDFSHIFT_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing PDFShift API key" });
    }

    // Llamada a PDFShift (NO Puppeteer)
    const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
      },
      body: JSON.stringify({
        source: html,
        use_print: true,
        background: true,
      }),
    });

    if (!pdfRes.ok) {
      const errorText = await pdfRes.text();
      return res.status(500).json({ error: errorText });
    }

    // Recibir binario del PDF
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename || "certificado.pdf"}"`
    );

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("PDF ERROR:", error);
    return res.status(500).json({ error: error.toString() });
  }
}

