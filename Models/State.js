const mongoose = require("mongoose");

const stateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    districts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "District"
      }
    ]
  },
  { collection: "States", timestamps: true }
);

module.exports =
  mongoose.models.State || mongoose.model("State", stateSchema);
