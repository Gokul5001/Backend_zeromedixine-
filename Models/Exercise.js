// Models/Exercise.js
// Collection: exerciselibrary
// This is your protocol database — physio-authored, not AI-generated.
// The LLM in Stage 2 is only allowed to personalize phrasing/sequencing
// of exercises pulled from here; it never invents or selects exercises itself.

const mongoose = require("mongoose");

const ExerciseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Matches Stage 1's intake.condition enum so recoveryPlan generation
    // can query directly off the assessment: neck | back | knee | shoulder | hip | other
    targetCondition: {
      type: String,
      required: true,
      enum: ["neck", "back", "knee", "shoulder", "hip", "other"],
    },
    targetJoint: { type: String }, // e.g. "lumbar spine", "patellofemoral"
    difficultyLevel: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    description: { type: String, default: "" },
    videoUrl: { type: String, default: "" },

    // Defaults — Gemini may adjust these slightly per patient in Stage 2,
    // but only within the min/max bounds set here.
    defaultSets: { type: Number, default: 3 },
    defaultReps: { type: Number, default: 10 },
    minReps: { type: Number, default: 5 },
    maxReps: { type: Number, default: 20 },

    precautions: { type: String, default: "" },
    // Plain-language rules checked in code before an exercise is ever
    // offered as a candidate — e.g. "avoid if painScore > 7", "avoid if numbness".
    contraindications: [{ type: String }],

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Exercise", ExerciseSchema, "exerciselibrary");