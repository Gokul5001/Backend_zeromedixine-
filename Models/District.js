const mongoose = require("mongoose");

const districtSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    state: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true
    }
  },
  { collection: "district", timestamps: true }
);

module.exports =
  mongoose.models.District || mongoose.model("District", districtSchema);
