// routes/recoveryPlan.js

const express = require("express");
const router = express.Router();
const {
  generatePlan,
  getPlan,
  getPlanByAssessment,
  listPendingReview,
  approvePlan,
  discardPlan,
} = require("../controllers/recoveryPlanController");

// generatePlan and getPlan are safe to leave open the way Stage 1's /start is —
// generation is keyed off an assessmentId, not patient identity.
// approvePlan / discardPlan / listPendingReview should sit behind your physio
// auth middleware before production — only a logged-in physio should approve plans.
router.post("/generate", generatePlan);
router.get("/pending-review", listPendingReview); // put before "/:id" so it isn't shadowed
router.get("/by-assessment/:assessmentId", getPlanByAssessment);
router.get("/:id", getPlan);
router.patch("/:id/approve", approvePlan); // TODO: add physio JWT middleware
router.patch("/:id/discard", discardPlan); // TODO: add physio JWT middleware

module.exports = router;

// In your main app.js / server.js:
// const recoveryPlanRoutes = require("./routes/recoveryPlan");
// app.use("/api/recovery-plan", recoveryPlanRoutes);
