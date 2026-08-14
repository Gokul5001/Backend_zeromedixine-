const express = require("express");
const OpenAI = require("openai");

const router = express.Router();

// Create OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * POST /api/ai/summarize
 * body: { text: "long text here" }
 */
router.post("/summarize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini", // cheaper + fast (recommended)
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes text clearly." },
        { role: "user", content: text }
      ],
      temperature: 0.3
    });

    const summary = response.choices[0].message.content;

    res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error("AI Summarize Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to summarize text"
    });
  }
});

module.exports = router;
