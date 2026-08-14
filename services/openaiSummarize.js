// services/openaiSummarize.js
//
// Rewrites a doctor's raw text — chief complaints or session notes,
// often voice-transcribed via the browser's Web Speech API — into a
// concise, professional clinical note. Used by
// POST /api/doctor-panel/summarize-text, which powers the "Summarize"
// button on PostSessionEnquiryModal.jsx.

const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set in the environment.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // cheap/fast; swap for "gpt-4o" if you want higher quality

const SYSTEM_PROMPT = `
You rewrite a physiotherapist's raw notes (often dictated via voice-to-text,
so they may contain filler words, run-on phrasing, or minor transcription
errors) into a concise, professional clinical note.

Rules:
- Preserve all factual/clinical content — do not add, infer, or remove any
  medical detail that wasn't in the original text.
- Do not add a diagnosis or clinical conclusion that wasn't already stated.
- Fix grammar, remove filler words ("um", "so yeah", "like I said"), and
  tighten the phrasing into clear clinical language.
- Keep it to roughly the same length as the input — this is a rewrite, not
  an expansion or a new summary of unrelated context.
- Respond with ONLY the rewritten text. No preamble, no quotation marks, no
  markdown.
`;

/**
 * @param {string} rawText - the doctor's raw/dictated text
 * @param {string} [fieldContext] - short label, e.g. "chief complaints" or
 *   "additional notes", used only to help the model calibrate register
 * @returns {Promise<string>} the rewritten, professional text
 */
async function summarizeProfessional(rawText, fieldContext) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Field: ${fieldContext || "clinical note"}\n\nRaw text:\n${rawText}`,
      },
    ],
  });

  const summary = (response.choices?.[0]?.message?.content || "").trim();
  if (!summary) throw new Error("OpenAI returned an empty summary");
  return summary;
}

module.exports = { summarizeProfessional };