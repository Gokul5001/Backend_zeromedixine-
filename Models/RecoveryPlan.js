// Models/RecoveryPlan.js
// Collection: recoveryplans
// Stage 2 writes here. Every later stage that needs "what is this patient
// supposed to be doing" reads from the most recent approved plan.

const mongoose = require("mongoose");

const PlanExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: mongoose.Schema.Types.ObjectId, ref: "Exercise", required: true },
    name: { type: String, required: true }, // denormalized for fast dashboard reads
    sets: { type: Number, required: true },
    reps: { type: Number, required: true },
    order: { type: Number, default: 0 },
    // Gemini's personalized phrasing — cues, sequencing notes. Never used to
    // change WHICH exercise this is or its safety-relevant precautions below.
    instructions: { type: String, default: "" },
    precautions: { type: String, default: "" },
    progressionLevel: { type: String, default: "starting" },
  },
  { _id: false }
);

const RecoveryPlanSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    conditionId: { type: mongoose.Schema.Types.ObjectId, ref: "Condition", default: null },

    // Traceability back to Stage 1 — required so Stage 7's dashboard can
    // reconstruct the full patient journey in one query.
    generatedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true },

    exercises: [PlanExerciseSchema],

    // Safeguard from the build guide: false until a physio reviews it.
    // The patient-facing app must never render a plan where this is false.
    approvedByPhysio: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Physio", default: null },
    approvedAt: { type: Date, default: null },
    physioNotes: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending_review", "approved", "active", "completed", "discarded"],
      default: "pending_review",
    },

    modelUsed: { type: String, default: "gemini-2.5-flash" },
    rawModelResponse: { type: String }, // audit trail, same pattern as Stage 1
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecoveryPlan", RecoveryPlanSchema, "recoveryplans");