// ─────────────────────────────────────────────────────────────────────────────
//  FILE 2:  routes/whatsappScheduleRoutes.js
//  Mount in app.js:  app.use("/api/whatsapp-bulk", require("./routes/whatsappScheduleRoutes"));
//  (same prefix as bulk routes, or merge into whatsappBulkRoutes.js)
// ─────────────────────────────────────────────────────────────────────────────

const express  = require("express");
const router   = express.Router();
const { sendTemplateMessage } = require("../utils/superfonenew.js");
const WhatsAppScheduleLog = require("../Models/WhatsAppScheduleLog");

const BATCH_SIZE        = 5;
const BATCH_INTERVAL_MS = 10_000; // 10 seconds

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── POST /api/whatsapp-bulk/schedule ─────────────────────────────────────────
//  Body: { contacts, templateName, language?, imageUrl?, scheduledAt }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/schedule", async (req, res) => {
  try {
    const { contacts, templateName, language, imageUrl, scheduledAt } = req.body;

    // Validation
    if (!Array.isArray(contacts) || contacts.length === 0)
      return res.status(400).json({ error: "contacts array is required." });
    if (!templateName)
      return res.status(400).json({ error: "templateName is required." });
    if (!scheduledAt)
      return res.status(400).json({ error: "scheduledAt is required." });

    const fireAt = new Date(scheduledAt);
    if (isNaN(fireAt) || fireAt <= new Date())
      return res.status(400).json({ error: "scheduledAt must be a valid future date." });

    const doc = await WhatsAppScheduleLog.create({
      templateName,
      language: language || "en",
      imageUrl:  imageUrl || null,
      totalContacts: contacts.length,
      contacts: contacts.map((c) => ({
        name:  c.name  || "Ma'am/Sir",
        phone: c.phone,
        pain:  c.pain  || "",
        status: "pending",
      })),
      scheduledAt: fireAt,
      status: "pending",
    });

    console.log(`[Schedule] Created job ${doc._id} — ${contacts.length} contacts at ${fireAt.toISOString()}`);

    res.json({
      message: `Scheduled ${contacts.length} contacts for ${fireAt.toISOString()}`,
      scheduleId: doc._id,
    });
  } catch (err) {
    console.error("[Schedule] Create error:", err);
    res.status(500).json({ error: "Failed to create schedule." });
  }
});

// ── GET /api/whatsapp-bulk/schedules ─────────────────────────────────────────
//  Query: ?page=1&limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get("/schedules", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const [schedules, total] = await Promise.all([
      WhatsAppScheduleLog.find()
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WhatsAppScheduleLog.countDocuments(),
    ]);

    res.json({ schedules, total, page, limit });
  } catch (err) {
    console.error("[Schedule] List error:", err);
    res.status(500).json({ error: "Failed to fetch schedules." });
  }
});

// ── POST /api/whatsapp-bulk/schedules/:id/cancel ──────────────────────────────
router.post("/schedules/:id/cancel", async (req, res) => {
  try {
    const doc = await WhatsAppScheduleLog.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Schedule not found." });
    if (doc.status !== "pending")
      return res.status(400).json({ error: `Cannot cancel a job with status "${doc.status}".` });

    doc.status = "cancelled";
    await doc.save();
    res.json({ message: "Schedule cancelled." });
  } catch (err) {
    console.error("[Schedule] Cancel error:", err);
    res.status(500).json({ error: "Failed to cancel schedule." });
  }
});

module.exports = router;

