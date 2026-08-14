// services/recoveryPlanService.js
//
// This is deliberately a thin wrapper. The rules engine (protocolRules +
// exerciselibrary, queried in the controller) decides WHICH exercises are
// candidates. Gemini's only job is to personalize instructions/ordering
// within the sets/reps bounds already defined on each exercise — it must
// never add, remove, or substitute an exercise.
//
// Same provider and pattern as Stage 1's services/geminiAssessment.js —
// reuses the GEMINI_API_KEY you've already got set up.

const { GoogleGenAI } = require("@google/genai");

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in the environment.");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are a recovery-plan personalization assistant for Zeromedixine, a physiotherapy platform.

You will receive a patient's Stage 1 triage assessment and a fixed list of candidate exercises that a rules engine has already selected as clinically appropriate. Your ONLY job is to:
1. Choose a sensible order for the exercises (easiest / lowest-irritability first).
2. Write a short, encouraging, plain-language instruction line per exercise (1-2 sentences).
3. Optionally nudge sets/reps slightly, but you MUST stay within the minReps/maxReps bounds provided for each exercise, and you must never change defaultSets by more than +/-1.

You must NEVER:
- Add an exercise that isn't in the candidate list
- Remove a required precaution or contraindication
- Suggest medication, diagnosis, or anything outside exercise instruction
- Change reps outside the given minReps/maxReps bounds

Return ONLY a JSON array (no markdown fences, no preamble) with exactly one entry per candidate exercise, each shaped as:
{
  "exerciseId": string,   // must match the id given in the input
  "order": number,
  "sets": number,
  "reps": number,
  "instructions": string,
  "progressionLevel": "starting" | "progressing" | "advanced"
}`;

function extractJson(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse Gemini response as JSON: ${err.message}\nRaw text: ${cleaned}`);
  }
}

/**
 * @param {Object} assessment - the Stage 1 assessment document
 * @param {Array}  candidateExercises - Exercise docs already filtered by the rules engine
 * @returns {{ parsed: Array, rawText: string }}
 */
async function personalizePlan(assessment, candidateExercises) {
  if (!candidateExercises || candidateExercises.length === 0) {
    throw new Error("personalizePlan requires at least one candidate exercise.");
  }

  const payload = {
    assessment: {
      condition: assessment.intake?.condition,
      painScore: assessment.intake?.painScore,
      age: assessment.intake?.age,
      severity: assessment.severity,
      conditionCategory: assessment.conditionCategory,
      previousInjury: assessment.intake?.previousInjury,
    },
    candidateExercises: candidateExercises.map((ex) => ({
      exerciseId: ex._id.toString(),
      name: ex.name,
      difficultyLevel: ex.difficultyLevel,
      defaultSets: ex.defaultSets,
      defaultReps: ex.defaultReps,
      minReps: ex.minReps,
      maxReps: ex.maxReps,
      precautions: ex.precautions,
    })),
  };

  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-flash-lite-latest", // same model Stage 1 uses
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(payload) }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
      },
    });
  } catch (err) {
    throw new Error(`Gemini API call failed: ${err.message}`);
  }

  const rawText = response.text;
  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = extractJson(rawText);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected Gemini to return a JSON array of personalized exercises.");
  }

  return { parsed, rawText };
}

module.exports = { personalizePlan };