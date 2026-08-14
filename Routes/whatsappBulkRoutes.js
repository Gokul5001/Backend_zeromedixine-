// routes/whatsappBulkRoutes.js
const express = require("express");
const router  = express.Router();
const { sendTemplateMessage } = require("../utils/superfonenew.js");
const WhatsAppBulkLog = require("../Models/WhatsAppBulkLog");

// ─────────────────────────────────────────────────────────────
//  APPROVED TEMPLATES REGISTRY
// ─────────────────────────────────────────────────────────────
const APPROVED_TEMPLATES = [
  {
    id: "welcome_greetings",
    name: "welcome_greetings",
    label: "Welcome Greetings",
    language: "en",
    category: "MARKETING",
    paramLabels: [],
    hasImageHeader: true,
    previewText: "...",
  },
];

// ─────────────────────────────────────────────
//  GET /api/whatsapp-bulk/templates
// ─────────────────────────────────────────────
router.get("/templates", (req, res) => {
  res.json({ templates: APPROVED_TEMPLATES });
});

// ─────────────────────────────────────────────
//  GET /api/whatsapp-bulk/history
//  Returns past campaigns, newest first
//  Query params: ?page=1&limit=20
// ─────────────────────────────────────────────
router.get("/history", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      WhatsAppBulkLog.find()
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WhatsAppBulkLog.countDocuments(),
    ]);

    res.json({ logs, total, page, limit });
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/whatsapp-bulk/send
// ─────────────────────────────────────────────
router.post("/send", async (req, res) => {
  try {
    const {
      contacts,
      templateName,
      language,
      imageUrl,
      paramOverrides = [],
    } = req.body;

    // ── Validation ──
    if (!Array.isArray(contacts) || contacts.length === 0)
      return res.status(400).json({ error: "contacts array is required." });
    if (contacts.length > 10)
      return res.status(400).json({ error: "Maximum 10 contacts per batch." });
    if (!templateName)
      return res.status(400).json({ error: "templateName is required." });

    const templateMeta = APPROVED_TEMPLATES.find((t) => t.name === templateName);
    if (!templateMeta)
      return res.status(400).json({ error: `Template "${templateName}" not found.` });
    if (templateMeta.hasImageHeader && !imageUrl)
      return res.status(400).json({ error: "imageUrl is required for this template." });

    const lang = language || templateMeta.language || "en";

    // ── Send to each contact ──
    const raw = await Promise.allSettled(
      contacts.map(async (contact, idx) => {
        if (!contact.phone)
          throw new Error(`Contact at index ${idx} has no phone number.`);

          const contactParams =
          Array.isArray(paramOverrides[idx]) && paramOverrides[idx].length > 0
            ? paramOverrides[idx]
            : templateMeta.paramLabels.length === 0
              ? []                                          // ← no body vars
              : [contact.name || "Ma'am/Sir", contact.pain || "pain"];

        const result = await sendTemplateMessage({
          to: contact.phone,
          templateName,
          language: lang,
          params: contactParams,
          ...(templateMeta.hasImageHeader ? { headerImage: imageUrl } : {}),
        });

        return {
          index: idx,
          name:  contact.name  || contact.phone,
          phone: contact.phone,
          pain:  contact.pain  || "",
          status: "sent",
          response: result,
        };
      })
    );

    // ── Shape response ──
    const formatted = raw.map((r, idx) => {
      if (r.status === "fulfilled") return r.value;
      return {
        index:  idx,
        name:   contacts[idx]?.name  || contacts[idx]?.phone || `Contact ${idx + 1}`,
        phone:  contacts[idx]?.phone,
        pain:   contacts[idx]?.pain  || "",
        status: "failed",
        error:  r.reason?.message || String(r.reason),
      };
    });

    const sentCount   = formatted.filter((r) => r.status === "sent").length;
    const failedCount = formatted.filter((r) => r.status === "failed").length;

    // ── Persist to MongoDB ──
    await WhatsAppBulkLog.create({
      templateName,
      templateLabel: templateMeta.label,
      language: lang,
      imageUrl: imageUrl || null,
      totalContacts: contacts.length,
      sentCount,
      failedCount,
      sentAt: new Date(),
      contacts: formatted.map(({ name, phone, pain, status, error }) => ({
        name, phone, pain, status, error: error || null,
      })),
    });

    console.log(`Bulk WA — template: ${templateName}, sent: ${sentCount}, failed: ${failedCount}`);

    res.json({
      message: `Bulk send complete. ${sentCount} sent, ${failedCount} failed.`,
      sentCount,
      failedCount,
      results: formatted,
    });
  } catch (err) {
    console.error("Bulk WA send error:", err);
    res.status(500).json({ error: "Server error during bulk send." });
  }
});

module.exports = router;