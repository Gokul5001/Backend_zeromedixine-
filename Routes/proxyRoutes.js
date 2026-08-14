// routes/proxyRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

router.get("/audio-proxy", async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "No id" });

  try {
    const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
    const response = await axios.get(driveUrl, {
      responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0" },
      maxRedirects: 5,
    });

    res.setHeader("Content-Type", response.headers["content-type"] || "audio/mpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // ← added

    
    response.data.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).json({ error: "Failed to fetch audio" });
  }
});

module.exports = router;