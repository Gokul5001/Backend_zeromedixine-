const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  package_name: String,
  sessions_count: Number,
  price_inr: Number,
  price_usd: Number,
  price_abroad_inr: Number,
  includes_free_diet_months: Number,
  notes: String,
  duration_weeks: Number,
  concern: String,
  active: Boolean
}, {
  timestamps: true,
  collection: "Sessions" // explicitly specify collection name
});

module.exports = mongoose.model("Session", sessionSchema);