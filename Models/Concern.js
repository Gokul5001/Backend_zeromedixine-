const mongoose = require("mongoose");

const concernSchema = new mongoose.Schema(
  {
    concern: { type: String, required: true },
  },
  { collection: "Concern" }
);

// ✅ Prevent OverwriteModelError
module.exports = mongoose.models.Concern || mongoose.model("Concern", concernSchema);
