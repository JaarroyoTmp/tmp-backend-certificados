import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    // Lanzar navegador (configurado para Vercel)
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Cargar el HTML que viene desde el frontend
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Generar el PDF
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    // Enviar el PDF como respuesta
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename || "certificado.pdf"}"`
    );

    return res.status(200).send(pdf);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.toString() });
  }
}
