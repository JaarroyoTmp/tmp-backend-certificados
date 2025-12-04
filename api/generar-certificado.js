export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    return res.status(200).json({
      ok: true,
      message: "PDF generation will be implemented",
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.toString() });
  }
}
