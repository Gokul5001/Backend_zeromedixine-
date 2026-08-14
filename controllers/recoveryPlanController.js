// controllers/recoveryPlanController.js

const Assessment = require("../Models/Assessment");
const Exercise = require("../Models/Exercise");
const ProtocolRule = require("../Models/ProtocolRule");
const RecoveryPlan = require("../Models/RecoveryPlan");
const { personalizePlan } = require("../services/recoveryPlanService");

/**
 * Pulls the exercises a patient is NOT eligible for based on simple,
 * physio-authored contraindication strings on each exercise. Kept
 * deliberately dumb and explainable — this is a safety filter, not ML.
 */
function isContraindicated(exercise, intake) {
  const flags = exercise.contraindications || [];
  return flags.some((flag) => {
    const f = flag.toLowerCase();
    if (f.includes("pain >") ) {
      const threshold = parseInt(f.split("pain >")[1], 10);
      if (!Number.isNaN(threshold) && intake.painScore > threshold) return true;
    }
    if (f.includes("numbness") && intake.numbness) return true;
    if (f.includes("swelling") && intake.swelling) return true;
    return false;
  });
}

// POST /api/recovery-plan/generate
async function generatePlan(req, res) {
  try {
    const { assessmentId } = req.body;
    if (!assessmentId) return res.status(400).json({ error: "assessmentId is required" });

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });

    // Same guardrail as the rest of the pipeline: red-flag cases skip
    // auto-generation entirely and go straight to a physio.
    if (assessment.redFlag) {
      return res.status(409).json({
        error: "This assessment was flagged red-flag. A physio must build this plan manually.",
      });
    }

    const rules = await ProtocolRule.find({
      conditionType: assessment.intake.condition,
      severityLevels: assessment.severity,
      painRangeMin: { $lte: assessment.intake.painScore },
      painRangeMax: { $gte: assessment.intake.painScore },
      ageRangeMin: { $lte: assessment.intake.age },
      ageRangeMax: { $gte: assessment.intake.age },
      active: true,
    });

    if (rules.length === 0) {
      return res.status(422).json({
        error: "No matching protocol rule for this condition/pain/age combination. A physio must build this plan manually.",
      });
    }

    if (rules.some((r) => r.requiresManualPlan)) {
      return res.status(409).json({
        error: "This condition profile requires a physio-built plan (flagged in protocol rules).",
      });
    }

    const exerciseIds = [...new Set(rules.flatMap((r) => r.recommendedExerciseIds.map(String)))];
    const allCandidates = await Exercise.find({ _id: { $in: exerciseIds }, active: true });

    const eligible = allCandidates.filter((ex) => !isContraindicated(ex, assessment.intake));

    if (eligible.length === 0) {
      return res.status(422).json({
        error: "All candidate exercises were contraindicated for this patient. A physio must build this plan manually.",
      });
    }

    const { parsed, rawText } = await personalizePlan(assessment, eligible);

    // Never trust Gemini's numbers blindly — validate against the source of truth.
    const eligibleById = new Map(eligible.map((ex) => [ex._id.toString(), ex]));
    const exercises = parsed
      .filter((p) => eligibleById.has(p.exerciseId))
      .map((p) => {
        const source = eligibleById.get(p.exerciseId);
        const clampedReps = Math.min(Math.max(p.reps ?? source.defaultReps, source.minReps), source.maxReps);
        const clampedSets = Math.min(Math.max(p.sets ?? source.defaultSets, 1), source.defaultSets + 1);
        return {
          exerciseId: source._id,
          name: source.name,
          sets: clampedSets,
          reps: clampedReps,
          order: p.order ?? 0,
          instructions: p.instructions || "",
          precautions: source.precautions || "",
          progressionLevel: ["starting", "progressing", "advanced"].includes(p.progressionLevel)
            ? p.progressionLevel
            : "starting",
        };
      })
      .sort((a, b) => a.order - b.order);

    if (exercises.length === 0) {
      return res.status(502).json({ error: "Personalization step returned no valid exercises. Please retry." });
    }

    const plan = await RecoveryPlan.create({
      patientId: assessment.patientId || null,
      generatedFrom: assessment._id,
      exercises,
      approvedByPhysio: false,
      status: "pending_review",
      rawModelResponse: rawText,
    });

    return res.json(plan);
  } catch (err) {
    console.error("generatePlan error:", err);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: "Plan personalization returned an unreadable response. Please try again." });
    }
    return res.status(500).json({ error: "Something went wrong generating the recovery plan." });
  }
}

// GET /api/recovery-plan/:id
async function getPlan(req, res) {
  try {
    const plan = await RecoveryPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ error: "Recovery plan not found" });
    return res.json(plan);
  } catch (err) {
    console.error("getPlan error:", err);
    return res.status(500).json({ error: "Could not load recovery plan" });
  }
}

// GET /api/recovery-plan/by-assessment/:assessmentId
async function getPlanByAssessment(req, res) {
  try {
    const plan = await RecoveryPlan.findOne({ generatedFrom: req.params.assessmentId }).sort({ createdAt: -1 });
    if (!plan) return res.status(404).json({ error: "No recovery plan found for this assessment" });
    return res.json(plan);
  } catch (err) {
    console.error("getPlanByAssessment error:", err);
    return res.status(500).json({ error: "Could not load recovery plan" });
  }
}

// GET /api/recovery-plan/pending-review  (physio queue)
async function listPendingReview(req, res) {
  try {
    const plans = await RecoveryPlan.find({ status: "pending_review" }).sort({ createdAt: 1 });
    return res.json(plans);
  } catch (err) {
    console.error("listPendingReview error:", err);
    return res.status(500).json({ error: "Could not load pending plans" });
  }
}

// PATCH /api/recovery-plan/:id/approve
// Physio can edit exercises before approving — the request body may include
// an updated `exercises` array; if omitted, the AI-drafted plan is approved as-is.
async function approvePlan(req, res) {
  try {
    const { physioId, physioNotes, exercises } = req.body;
    if (!physioId) return res.status(400).json({ error: "physioId is required" });

    const update = {
      approvedByPhysio: true,
      approvedBy: physioId,
      approvedAt: new Date(),
      status: "approved",
      physioNotes: physioNotes || "",
    };
    if (Array.isArray(exercises) && exercises.length > 0) {
      update.exercises = exercises;
    }

    const plan = await RecoveryPlan.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!plan) return res.status(404).json({ error: "Recovery plan not found" });
    return res.json(plan);
  } catch (err) {
    console.error("approvePlan error:", err);
    return res.status(500).json({ error: "Could not approve recovery plan" });
  }
}

// PATCH /api/recovery-plan/:id/discard  (physio rejects the AI draft entirely)
async function discardPlan(req, res) {
  try {
    const plan = await RecoveryPlan.findByIdAndUpdate(
      req.params.id,
      { status: "discarded" },
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: "Recovery plan not found" });
    return res.json(plan);
  } catch (err) {
    console.error("discardPlan error:", err);
    return res.status(500).json({ error: "Could not discard recovery plan" });
  }
}

module.exports = {
  generatePlan,
  getPlan,
  getPlanByAssessment,
  listPendingReview,
  approvePlan,
  discardPlan,
};