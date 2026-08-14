//controller/assessmentController.js

const Assessment = require("../Models/Assessment");
const { runAssessment } = require("../services/geminiAssessment");

const CONDITIONS = ["neck", "back", "knee", "shoulder", "hip", "other"];
const DURATIONS = ["<1w", "1-2w", "2-4w", "1-3m", "3m+"];

function validateIntake(intake) {
  if (!intake) return "Missing intake data";
  if (!CONDITIONS.includes(intake.condition)) return "Invalid condition";
  if (typeof intake.painScore !== "number" || intake.painScore < 0 || intake.painScore > 10)
    return "Invalid painScore";
  if (!DURATIONS.includes(intake.durationBucket)) return "Invalid durationBucket";
  if (typeof intake.age !== "number" || intake.age < 1 || intake.age > 120) return "Invalid age";
  if (typeof intake.previousInjury !== "boolean") return "Invalid previousInjury";
  if (typeof intake.numbness !== "boolean") return "Invalid numbness";
  if (typeof intake.swelling !== "boolean") return "Invalid swelling";
  return null;
}

// POST /api/assessment/start
async function startAssessment(req, res) {
  try {
    const { intake, sessionId, patientId } = req.body;

    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const validationError = validateIntake(intake);
    if (validationError) return res.status(400).json({ error: validationError });

    const { parsed, rawText } = await runAssessment(intake);

    const assessment = await Assessment.create({
      patientId: patientId || null,
      sessionId,
      intake,
      conditionCategory: parsed.conditionCategory,
      severity: parsed.severity,
      redFlag: parsed.redFlag,
      redFlagReason: parsed.redFlagReason || "",
      summaryForPhysio: parsed.summaryForPhysio,
      patientSummary: parsed.patientSummary || "",
      nextQuestions: parsed.nextQuestions || [],
      rawModelResponse: rawText,
      // No Stage 2 (recovery plan) step anymore — the assessment itself
      // is the end of the pipeline, so it's "complete" the moment Gemini
      // returns a result. Nothing is left pending physio review here.
      status: "complete",
    });

    return res.json({
      assessmentId: assessment._id,
      conditionCategory: assessment.conditionCategory,
      severity: assessment.severity,
      redFlag: assessment.redFlag,
      summaryForPhysio: assessment.summaryForPhysio,
      patientSummary: assessment.patientSummary,
      status: assessment.status,
    });
  } catch (err) {
    console.error("startAssessment error:", err);
    // If Gemini returned malformed JSON, don't silently fail the patient flow —
    // log it and surface a clear retry rather than a stack trace.
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: "Assessment engine returned an unreadable response. Please try again." });
    }
    return res.status(500).json({ error: "Something went wrong generating your assessment." });
  }
}

// GET /api/assessment/:id  (used by AssessmentSummary.jsx on refresh / booking handoff)
async function getAssessment(req, res) {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    return res.json(assessment);
  } catch (err) {
    console.error("getAssessment error:", err);
    return res.status(500).json({ error: "Could not load assessment" });
  }
}

// PATCH /api/assessment/:id/link-patient  (called once the anonymous user logs in / books)
async function linkPatient(req, res) {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    const assessment = await Assessment.findByIdAndUpdate(
      req.params.id,
      { patientId },
      { new: true }
    );
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    return res.json(assessment);
  } catch (err) {
    console.error("linkPatient error:", err);
    return res.status(500).json({ error: "Could not link assessment to patient" });
  }
}

module.exports = { startAssessment, getAssessment, linkPatient };