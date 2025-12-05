export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html } = req.body;

    if (!html) {
      return res.status(400).json({ error: "HTML content is required" });
    }

    const apiKey = process.env.PDFSHIFT_API_KEY;

    const pdfResponse = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        source: html,
        landscape: false,
      }),
    });

    if (!pdfResponse.ok) {
      const errText = await pdfResponse.text();
      console.error("PDFShift v3 error:", errText);
      return res.status(500).json({ error: "Error generating PDF", details: errText });
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=certificado.pdf");
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error("Handler exception:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
