// Models/ProtocolRule.js
// Collection: protocolrules
// This is the rules-engine half of Stage 2. Given a condition + pain + age,
// this table decides WHICH exercises are eligible candidates. The LLM never
// touches this table — it only reorders/rephrases what comes out of it.

const mongoose = require("mongoose");

const ProtocolRuleSchema = new mongoose.Schema(
  {
    conditionType: {
      type: String,
      required: true,
      enum: ["neck", "back", "knee", "shoulder", "hip", "other"],
    },
    severityLevels: {
      // which Stage 1 severities this rule applies to
      type: [String],
      enum: ["mild", "moderate", "severe"],
      default: ["mild", "moderate"],
    },
    painRangeMin: { type: Number, default: 0 },
    painRangeMax: { type: Number, default: 10 },
    ageRangeMin: { type: Number, default: 1 },
    ageRangeMax: { type: Number, default: 120 },

    recommendedExerciseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Exercise" }],

    // Human-readable description of when a patient should progress —
    // Stage 3/5 will eventually automate checking this, Stage 2 just stores it.
    progressionTrigger: { type: String, default: "" },

    // Safety valve: some conditions should never get an auto-generated plan
    // even without a red flag (e.g. severe + certain conditions) — physio must
    // build the plan manually. Defaults to false (auto-generation allowed).
    requiresManualPlan: { type: Boolean, default: false },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProtocolRule", ProtocolRuleSchema, "protocolrules");
