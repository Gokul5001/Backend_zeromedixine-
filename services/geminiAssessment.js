// ============================================================
// services/openaiAssessment.js
// Calls OpenAI to turn a structured pain intake into a
// triage assessment: condition category, severity, plain-language
// description, red-flag check, and a specialist recommendation.
// ============================================================

const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set in the environment.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-4o-mini"; // swap for "gpt-4o" for higher-quality triage reasoning

const SYSTEM_PROMPT = `
You are Zero AI, a musculoskeletal pain triage assistant for a physiotherapy
platform called ZeroMedicine. A patient has just answered a short structured
intake (area of pain, pain score, duration, age, previous injury, numbness,
swelling).

Your job:
1. Classify the likely condition category in plain, non-alarming language
   (e.g. "Mechanical back pain", "Possible rotator cuff strain",
   "Early-stage knee osteoarthritis pattern"). This is a triage suggestion,
   NOT a diagnosis — never claim certainty.
2. Rate severity as exactly one of: "mild", "moderate", "severe".
   - "severe" should be used when pain score is high (8-10), when there is
     numbness/tingling combined with high pain, or when swelling is present
     alongside significant pain — these combinations warrant faster review.
3. Flag redFlag = true only for combinations that could indicate something
   needing urgent in-person medical attention (e.g. significant numbness with
   high pain, sudden severe swelling, or very high pain with red-flag
   duration/age patterns). Keep this conservative but not alarmist.
4. Write a short, warm, plain-language "patientSummary" (2-3 sentences) that
   explains what this pattern usually suggests and reassures the patient that
   a physiotherapist will confirm this with a proper assessment. Never use
   definitive diagnostic language like "you have X" — use "this pattern is
   often associated with X".
5. Write a slightly more clinical "summaryForPhysio" (2-4 sentences) using the
   intake data, suitable for a treating physiotherapist to skim before a
   session.
6. Suggest "recommendedSpecialist" — a short specialist/physio type label,
   e.g. "Orthopedic Physiotherapist", "Sports Injury Physiotherapist",
   "Spine Physiotherapist", "General Physiotherapist".
7. Optionally include up to 3 "nextQuestions" a physiotherapist might want to
   ask at the first session.

Always respond with ONLY the JSON object matching the given schema. Do not
include markdown fences, commentary, or any text outside the JSON.
`;

// OpenAI structured outputs (strict mode) require every property to be
// listed in "required" and additionalProperties: false at every object level.
const RESPONSE_SCHEMA = {
  name: "triage_assessment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      conditionCategory: { type: "string" },
      severity: { type: "string", enum: ["mild", "moderate", "severe"] },
      description: { type: "string" },
      redFlag: { type: "boolean" },
      redFlagReason: { type: "string" },
      summaryForPhysio: { type: "string" },
      patientSummary: { type: "string" },
      recommendedSpecialist: { type: "string" },
      nextQuestions: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "conditionCategory",
      "severity",
      "description",
      "redFlag",
      "redFlagReason",
      "summaryForPhysio",
      "patientSummary",
      "recommendedSpecialist",
      "nextQuestions",
    ],
    additionalProperties: false,
  },
};

const DURATION_LABELS = {
  "<1w": "less than a week",
  "1-2w": "1 to 2 weeks",
  "2-4w": "2 to 4 weeks",
  "1-3m": "1 to 3 months",
  "3m+": "more than 3 months",
};

/**
 * Calls OpenAI with the patient's structured intake and returns a parsed
 * triage assessment plus the raw JSON string (for the audit trail).
 *
 * @param {Object} intake - { condition, painScore, durationBucket, age,
 *                            previousInjury, numbness, swelling, freeTextNote }
 * @returns {Promise<{ parsed: Object, rawText: string, model: string }>}
 */
async function generateAssessment(intake) {
  const userPayload = {
    areaOfPain: intake.condition,
    painScoreOutOf10: intake.painScore,
    duration: DURATION_LABELS[intake.durationBucket] || intake.durationBucket,
    age: intake.age,
    previousInjuryToThisArea: intake.previousInjury,
    numbnessOrTingling: intake.numbness,
    visibleSwelling: intake.swelling,
    additionalNote: intake.freeTextNote || "",
  };

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Patient intake data:\n${JSON.stringify(userPayload, null, 2)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RESPONSE_SCHEMA,
    },
  });

  const rawText = response.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    console.error("OpenAI returned non-JSON response:", rawText);
    throw new Error("Failed to parse OpenAI assessment response");
  }

  // Guard rails in case the model omits an optional field
  if (!Array.isArray(parsed.nextQuestions)) parsed.nextQuestions = [];
  if (typeof parsed.redFlag !== "boolean") parsed.redFlag = false;
  if (!parsed.redFlagReason) parsed.redFlagReason = "";

  return { parsed, rawText, model: MODEL };
}

module.exports = { generateAssessment };  