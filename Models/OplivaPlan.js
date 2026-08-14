const mongoose = require("mongoose");

const oplivaPlanSchema = new mongoose.Schema(
  {
    plan_name: { type: String, required: true },
    price_inr: { type: Number, required: true },
    price_usd: { type: Number, required: true },

    description: { type: String },

    features: [{ type: String }],

    is_active: { type: Boolean, default: true }
  },
  {
    collection: "Opliva_plans",
    timestamps: true
  }
);

module.exports =
  mongoose.models.OplivaPlan ||
  mongoose.model("OplivaPlan", oplivaPlanSchema);