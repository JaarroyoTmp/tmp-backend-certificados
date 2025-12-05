import pdfcrowd from "pdfcrowd";

export const config = {
  api: {
    bodyParser: true, // <- habilita JSON en Vercel
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // AHORA req.body estará parseado correctamente
    const { html } = req.body;

    if (!html) {
      return res.status(400).json({ error: "HTML content is required", body: req.body });
    }

    const username = process.env.PDFCROWD_USERNAME;
    const apiKey = process.env.PDFCROWD_API_KEY;

    const client = new pdfcrowd.HtmlToPdfClient(username, apiKey);

    const pdfBuffer = await client.convertString(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=certificado.pdf");
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    res.status(500).json({
      error: "Error generating PDF",
      details: err.toString()
    });
  }
}
