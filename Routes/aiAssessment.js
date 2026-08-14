// ============================================================
// routes/aiAssessment.js
// Pain Chat Assistant backend.
// Mounted in server.js as: app.use("/api/assessment", aiAssessmentRoutes);
//
// EVERY route here requires a logged-in patient (verifyPatientToken,
// same middleware used by /api/patient-auth). If there's no valid
// patientToken, the frontend should redirect to /patient/login before
// ever calling these endpoints.
// ============================================================

const express = require("express");
const router = express.Router();

const Assessment = require("../Models/Assessment");
const { verifyPatientToken } = require("./patientAuth");
const { generateAssessment } = require("../services/geminiAssessment");

const VALID_CONDITIONS = ["back", "neck", "shoulder", "hip", "knee", "other"];
const VALID_DURATIONS = ["<1w", "1-2w", "2-4w", "1-3m", "3m+"];

function validateIntake(intake) {
  if (!intake || typeof intake !== "object") return "Intake data is required";
  if (!VALID_CONDITIONS.includes(intake.condition)) return "Invalid condition";
  if (
    typeof intake.painScore !== "number" ||
    intake.painScore < 0 ||
    intake.painScore > 10
  )
    return "painScore must be a number between 0 and 10";
  if (!VALID_DURATIONS.includes(intake.durationBucket))
    return "Invalid durationBucket";
  if (typeof intake.age !== "number" || intake.age < 0 || intake.age > 120)
    return "Invalid age";
  if (typeof intake.previousInjury !== "boolean")
    return "previousInjury must be true/false";
  if (typeof intake.numbness !== "boolean")
    return "numbness must be true/false";
  if (typeof intake.swelling !== "boolean")
    return "swelling must be true/false";
  return null;
}

// ─────────────────────────────────────────
// POST /api/assessment/submit
// Body: { sessionId, intake: {...}, conversation: [{sender, text}] }
// Requires: logged-in patient
// ─────────────────────────────────────────
router.post("/submit", verifyPatientToken, async (req, res) => {
  try {
    const { sessionId, intake, conversation } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "sessionId is required" });
    }

    const validationError = validateIntake(intake);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    // ── Call Gemini for the triage assessment ──
    const { parsed, rawText, model } = await generateAssessment(intake);

    // ── Persist ──
    const assessment = await Assessment.create({
      patientId: req.patient.id,
      patientPhone: req.patient.phone,
      sessionId,
      intake: {
        condition: intake.condition,
        painScore: intake.painScore,
        durationBucket: intake.durationBucket,
        age: intake.age,
        previousInjury: intake.previousInjury,
        numbness: intake.numbness,
        swelling: intake.swelling,
        freeTextNote: intake.freeTextNote || "",
      },
      conversation: Array.isArray(conversation) ? conversation : [],
      conditionCategory: parsed.conditionCategory,
      severity: parsed.severity,
      description: parsed.description,
      redFlag: parsed.redFlag,
      redFlagReason: parsed.redFlagReason,
      summaryForPhysio: parsed.summaryForPhysio,
      patientSummary: parsed.patientSummary,
      recommendedSpecialist: parsed.recommendedSpecialist,
      nextQuestions: parsed.nextQuestions,
      modelUsed: model,
      rawModelResponse: rawText,
      status: "complete",
    });

    console.log(
      `✅ Assessment ${assessment._id} complete for patient ${req.patient.patient_id} | ${parsed.conditionCategory} (${parsed.severity})`
    );

    return res.json({ success: true, assessment });
  } catch (err) {
    console.error("Assessment submit error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to generate assessment" });
  }
});

// ─────────────────────────────────────────
// GET /api/assessment/history
// Returns the logged-in patient's past assessments, most recent first.
// Used to show "previous chat" history in the UI.
// ─────────────────────────────────────────
router.get("/history", verifyPatientToken, async (req, res) => {
  try {
    const assessments = await Assessment.find({ patientId: req.patient.id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, assessments });
  } catch (err) {
    console.error("Assessment history error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
});

// ─────────────────────────────────────────
// GET /api/assessment/:id
// Fetch a single past assessment (e.g. to replay its chat transcript).
// Ownership-checked against the logged-in patient.
// ─────────────────────────────────────────
router.get("/:id", verifyPatientToken, async (req, res) => {
  try {
    const assessment = await Assessment.findOne({
      _id: req.params.id,
      patientId: req.patient.id,
    }).lean();

    if (!assessment) {
      return res.status(404).json({ success: false, error: "Assessment not found" });
    }

    return res.json({ success: true, assessment });
  } catch (err) {
    console.error("Assessment fetch error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to fetch assessment" });
  }
});

module.exports = router;