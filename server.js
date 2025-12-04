import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("TMP Backend for Certificates · OK");
});

// GENERATE CERTIFICATE PDF
app.post("/generar-certificado", async (req, res) => {
  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    res.json({
      ok: true,
      pdf: null,
      message: "PDF generation will be added later"
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Backend running on port", port));
