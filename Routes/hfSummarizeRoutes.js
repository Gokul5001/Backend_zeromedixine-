const express = require("express");
const axios = require("axios");

const router = express.Router();

const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/Falconsai/text_summarization";

/**
 * POST /api/ai/summarize
 * body: { text: "long text here" }
 */
router.post("/summarize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required"
      });
    }

    const response = await axios.post(
      HF_MODEL_URL,
      {
        inputs: text,
        parameters: {
          max_length: 80,
          min_length: 30,
          do_sample: false
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    // HuggingFace returns array
    const summary = response.data?.[0]?.summary_text;

    res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error(
      "HF Summarize Error:",
      error?.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      error: "Failed to summarize text"
    });
  }
});

module.exports = router;
