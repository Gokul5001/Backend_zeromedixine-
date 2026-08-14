// Routes/paymentRoutes.js
const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
// const { sendTemplateMessage } = require("../utils/aisensy"); // you already use this above
const { requireAuth, requireSelfOrAdmin } = require("../Middleware/authMiddleware");


const { sendTemplateMessage } = require("../utils/superfone");

const Payment = require("../Models/Payment");
const Appointment = require("../Models/Appointment");
// const { sendTemplateMessage } = require("../utils/aisensy"); // keep your util
// IMPORTANT: ensure env vars set: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, AISENSY_PATIENT_VIDEO_NAME, AISENSY_PATIENT_VIDEO_TEMPLATE, FRONTEND_URL

// helper: get trimmed env or null
function trimmedEnv(key) {
    const v = process.env[key];
    return (typeof v === "string" ? v.trim() : null) || null;
  }
  
  // ensure trimmed keys exist before creating the instance
  const RAZORPAY_KEY_ID_TRIM = trimmedEnv("RAZORPAY_KEY_ID");
  const RAZORPAY_KEY_SECRET_TRIM = trimmedEnv("RAZORPAY_KEY_SECRET");
  
  if (!RAZORPAY_KEY_ID_TRIM || !RAZORPAY_KEY_SECRET_TRIM) {
    console.error("⚠️ Razorpay keys missing or empty. Check .env (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  } 
  
  // create instance with trimmed keys
  const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID_TRIM || "",
    key_secret: RAZORPAY_KEY_SECRET_TRIM || ""
  });

// helper to normalize phone (very small normalization)
function normalizePhoneToRough(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 10 ? "91" + digits : digits;
}


router.post("/create-link", async (req, res) => {
  try {
    const {
      appointmentId,
      sessionId = null,
      amount,
      currency = "INR",
      description = "",
      customer = {},
      sendWhatsApp = true,
      assignedBy = null
    } = req.body || {};

    if (!appointmentId || (amount === undefined || amount === null)) {
      return res.status(400).json({ success: false, message: "appointmentId and amount are required" });
    }

    // validate appointment exists
    const appt = await Appointment.findById(appointmentId).lean();
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // --- Normalize amount to smallest currency unit robustly ---
    const currencyUpper = String(currency || "INR").toUpperCase();

    // currencies without minor units (add more if needed)
    const zeroDecimalCurrencies = new Set(["JPY"]);

    // Most currencies use 2 decimals -> multiplier 100
    const multiplier = zeroDecimalCurrencies.has(currencyUpper) ? 1 : 100;

    const rawAmount = Number(amount);
    if (Number.isNaN(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const amountSmallest = Math.round(rawAmount * multiplier);
    if (amountSmallest <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount after conversion to smallest unit" });
    }
    // --- end normalization ---

    // generate compact unique reference id (<= 40 chars)
    const shortSuffix = uuidv4().split("-")[0]; // 8 chars
    let referenceId = `${String(appointmentId)}-${shortSuffix}`;
    if (referenceId.length > 40) referenceId = referenceId.slice(0, 40);

    // create payment doc BEFORE calling Razorpay so we can store referenceId
    const p = new Payment({
      appointmentId: appointmentId,
      sessionId: sessionId,
      amount: amountSmallest,
      currency: currencyUpper,
      referenceId: referenceId,
      purpose: description || `Payment for session`,
      customer: {
        name: customer.name || appt.name || null,
        email: customer.email || appt.email || null,
        contact: customer.contact || appt.phone || null
      },
      status: "created",
      doctorAssigned: appt.doctorAssigned,
      raw: { createdBy: req.body.createdBy || "backend" }
    });

    await p.save();

    // Build Razorpay paymentLink payload using unique reference_id
    const payload = {
      amount: p.amount,
      currency: p.currency || "INR",
      accept_partial: false,
      reference_id: referenceId,
      description: description || `Payment for session`,
      customer: {
        name: p.customer.name || "",
        contact: (p.customer.contact || "").toString().replace(/\D/g, ""),
        email: p.customer.email || ""
      },
      notify: {
        sms: false,
        email: false
      },
      callback_url: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payments/callback` : "",
      callback_method: "get"
    };

    // Create the link on Razorpay
    let link;
    try {
      console.log("Creating Razorpay payment link, reference:", referenceId, "payload:", {
        amount: payload.amount,
        currency: payload.currency,
        customer: payload.customer
      });
      link = await razorpay.paymentLink.create(payload);
    } catch (err) {
      console.error("Razorpay create link ERROR (full):", err && err.error ? err.error : err);
      // attach error to payment doc for debugging
      p.raw = { ...(p.raw || {}), razorpay_error: err };
      await p.save().catch(() => {});
      return res.status(err.statusCode || 500).json({
        success: false,
        message: "Razorpay error while creating link",
        error: err.error || err
      });
    }

    // update payment doc with link info and save
    p.linkId = link.id;
    p.linkShortUrl = link.short_url || null;
    p.linkLongUrl = link.long_url || null;
    p.raw = { ...(p.raw || {}), razorpay_link: link };
    await p.save();

    // attach link metadata to appointment (optional convenience)
    try {
      await Appointment.updateOne(
        { _id: appointmentId },
        {
          $push: { payments: { paymentId: p._id, linkId: p.linkId, url: p.linkShortUrl || p.linkLongUrl, createdAt: new Date() } },
          $set: { paymentLink: { linkId: p.linkId, url: p.linkShortUrl || p.linkLongUrl, createdAt: new Date() } }
        }
      );
    } catch (e) {
      console.warn("Failed to attach payment link to appointment:", e?.message || e);
    }

    // Send WhatsApp via AiSensy (patient only) — best-effort
    // if (sendWhatsApp) {
    //   try {
    //     const rawPhone = p.customer.contact || appt.phone || null;
    //     const to = normalizePhoneToRough(rawPhone);
    //     if (to) {
    //       const patientName = String(p.customer.name || appt.name || "Patient");
    //       const patientLink = String(p.linkShortUrl || p.linkLongUrl || "");
    //       const doctorNameFormatted = assignedBy || appt.doctorAssignedUsername || "Doctor";
    //       const templateName = process.env.AISENSY_PAYMENT_TEMPLATE || "payment_getting";
    //       const campaignName = process.env.AISENSY_PAYMENT_CAMPAIGN || "";

    //       // For display in template convert smallest unit back to display amount
    //       const displayAmount = (multiplier === 1) ? String(p.amount) : ((p.amount || 0) / multiplier);
    //       const amountDisplay = p.currency === "INR" ? `₹${displayAmount}` : `${p.currency} ${displayAmount}`;

    //       const patientPayload = {
    //         to: to,
    //         campaignName: campaignName,
    //         templateName: templateName,
    //         // order of params must match your AiSensy template
    //         params: [patientName, (description || "session"), amountDisplay, patientLink, doctorNameFormatted]
    //       };

    //       console.log("Sending AiSensy PAYMENT WA payload:", patientPayload);
    //       await sendTemplateMessage(patientPayload);
    //       console.log("AiSensy payment link message sent to:", to);
    //     } else {
    //       console.warn("No valid patient phone to send WA for appointment:", appointmentId);
    //     }
    //   } catch (waErr) {
    //     console.error("AiSensy WA send error (payment link):", waErr?.response?.data || waErr.message || waErr);
    //   }
    // }

    // Send WhatsApp via Superfone (patient only)
if (sendWhatsApp) {
  try {
    const rawPhone = p.customer.contact || appt.phone || null;
    const to = rawPhone;

    if (to) {
      const patientName = String(p.customer.name || appt.name || "Patient");
      const patientLink = String(p.linkShortUrl || p.linkLongUrl || "");
      const doctorNameFormatted = assignedBy || appt.doctorAssignedUsername || "Doctor";

      const multiplier = p.currency === "JPY" ? 1 : 100;
      const displayAmount =
        multiplier === 1
          ? String(p.amount)
          : (p.amount / multiplier).toFixed(2);

          const amountDisplay =
          p.currency === "INR"
            ? `${displayAmount}`
            : `${p.currency} ${displayAmount}`;

      const templateName =
        process.env.SUPERFONE_PAYMENT_TEMPLATE || "payment_getting";

      const waPayload = {
        to,
        templateName,
        language: "en",
        params: [
          patientName,
          description || "session",
          amountDisplay,
          patientLink,
          doctorNameFormatted
        ]
      };

      console.log("📤 Sending Superfone PAYMENT WA:", waPayload);

      await sendTemplateMessage(waPayload);

      console.log("✅ Superfone payment link message sent to:", to);
    } else {
      console.warn("No valid phone number for WA:", appointmentId);
    }
  } catch (waErr) {
    console.error("❌ Superfone WA send error:", waErr.message || waErr);
  }
}
    // final response
    return res.json({
      success: true,
      message: "Payment link created with unique reference_id",
      payment: p,
      link: { id: link.id, short_url: link.short_url || null, long_url: link.long_url || null, reference_id: referenceId }
    });
  } catch (err) {
    console.error("Unhandled error in /api/payments/create-link (unique-ref):", err);
    return res.status(500).json({ success: false, message: "Server error creating payment link", error: err });
  }
});

// Razorpay webhook handler — set this URL in Razorpay dashboard and set RAZORPAY_WEBHOOK_SECRET
// Use express.raw so signature verification works correctly
router.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
    const bodyBuffer = req.body; // Buffer
    if (!signature || !secret) {
      console.warn("Missing signature or webhook secret");
      return res.status(400).send("missing signature/secret");
    }

    const expected = crypto.createHmac("sha256", secret).update(bodyBuffer).digest("hex");
    if (signature !== expected) {
      console.warn("Invalid Razorpay webhook signature");
      return res.status(400).send("invalid signature");
    }

    const payload = JSON.parse(bodyBuffer.toString());
    const event = payload.event;
    const data = payload.payload || {};

    // handle payment_link.paid and payment.captured
    if (event === "payment_link.paid" || event === "payment.captured") {
      const paymentEntity = data.payment ? data.payment.entity : null;
      const linkEntity = data.payment_link ? data.payment_link.entity : (data.payment_link_entity ? data.payment_link_entity : null);

      const linkId = (linkEntity && linkEntity.id) || (paymentEntity && paymentEntity.payment_link_id) || null;
      const razorpayPaymentId = paymentEntity ? paymentEntity.id : null;
      const referenceId = paymentEntity ? paymentEntity.reference_id : (linkEntity ? linkEntity.reference_id : null);

      let payDoc = null;

      if (linkId) {
        payDoc = await Payment.findOne({ linkId });
      }

      if (!payDoc && referenceId) {
        // reference_id was set to appointmentId when creating the link
        try {
          payDoc = await Payment.findOne({ appointmentId: referenceId }).sort({ createdAt: -1 });
        } catch (e) {
          console.warn("Error finding payment by reference:", e?.message || e);
        }
      }

      if (!payDoc) {
        console.warn("Webhook: no Payment doc found for", { linkId, referenceId, razorpayPaymentId });
      } else {
        payDoc.status = "paid";
        if (razorpayPaymentId) payDoc.razorpay_payment_id = razorpayPaymentId;
        if (paymentEntity && paymentEntity.order_id) payDoc.razorpay_order_id = paymentEntity.order_id;
        payDoc.raw = { ...(payDoc.raw || {}), webhook: payload };
        await payDoc.save();

        // Update Appointment: push payment into array (create if not present)
        try {
          await Appointment.updateOne(
            { _id: payDoc.appointmentId },
            {
              $set: { lastPaymentAt: new Date() },
              $push: {
                payments: {
                  paymentId: payDoc._id,
                  amount: payDoc.amount,
                  currency: payDoc.currency,
                  razorpayPaymentId: payDoc.razorpay_payment_id,
                  createdAt: new Date()
                }
              }
            }
          );
        } catch (e) {
          console.error("Error updating appointment with payment info:", e);
        }
      }
    } else if (event === "payment_link.expired" || event === "payment_link.cancelled") {
      const linkEntity = data.payment_link ? data.payment_link.entity : null;
      const linkId = linkEntity && linkEntity.id;
      if (linkId) {
        await Payment.updateMany({ linkId }, { $set: { status: "expired", raw: { webhook: payload } } });
      }
    }

    // ack
    res.json({ ok: true });
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(500).send("server error");
  }
});


// GET/POST to fetch payments by doctor (supports doctorId ObjectId or username text)
// POST /api/payments/doctor
// GET/POST to fetch payments by doctor (supports doctorId ObjectId or username text)
// POST /api/payments/doctor
router.post("/doctor", requireAuth, async (req, res) => {
  try {
    const { username, doctorId } = req.body || {};

    if (!["admin", "superadmin"].includes(req.user.role)) {
      const requestedId = doctorId ? String(doctorId) : null;
      const requestedUname = username ? String(username).toLowerCase() : null;
      const ownId = String(req.user.id);
      const ownUname = String(req.user.username || "").toLowerCase();
      if (requestedId !== ownId && requestedUname !== ownUname) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }


      const orConditions = [];
  
      // If doctorId looks like an ObjectId, match doctorAssigned by ObjectId equality
      if (doctorId && typeof doctorId === "string" && /^[0-9a-fA-F]{24}$/.test(doctorId.trim())) {
        try {
          orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(doctorId.trim()) });
        } catch (e) {
          console.warn("Provided doctorId looks like 24hex but failed conversion:", doctorId, e);
        }
      }
  
      // If username provided, match against doctorAssignedUsername (string field)
      if (username && String(username).trim()) {
        const esc = String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        orConditions.push({ doctorAssignedUsername: { $regex: new RegExp(`^${esc}$`, "i") } });
  
        // ALSO: if username itself is an ObjectId-like string, allow matching doctorAssigned (ObjectId)
        if (/^[0-9a-fA-F]{24}$/.test(String(username).trim())) {
          try {
            orConditions.push({ doctorAssigned: new mongoose.Types.ObjectId(String(username).trim()) });
          } catch (e) {
            console.warn("Failed to cast username-as-id to ObjectId:", username, e);
          }
        }
      }
  
      if (!orConditions.length) {
        console.log("No doctorId or username provided -> returning empty set");
        return res.json({ success: true, count: 0, payments: [] });
      }
  
      console.log("Payments $or query:", JSON.stringify(orConditions));
  
      // Build aggregation pipeline to also lookup session details from 'Sessions' collection
      const pipeline = [
        { $match: { $or: orConditions } },
        { $sort: { createdAt: -1 } },
        { $limit: 500 },
  
        // Attempt to convert sessionId string to ObjectId for lookup; if sessionId stored as string, lookup will still try match
        {
          $lookup: {
            from: "Sessions", // note: exact collection name (case-sensitive in some deployments)
            let: { sid: "$sessionId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      // match by ObjectId if possible
                      { $eq: ["$_id", { $cond: [{ $eq: [{ $type: "$$sid" }, "objectId"] }, "$$sid", { $toObjectId: "$$sid" }] }] },
                      // fallback: match by string equality on _id as string (covers cases _id stored as ObjectId but sessionId saved as string)
                      { $eq: [{ $toString: "$_id" }, "$$sid"] }
                    ]
                  }
                }
              },
              {
                $project: {
                  _id: 1,
                  concern: 1,
                  package_name: 1,
                  sessions_count: 1,
                  duration_weeks: 1
                }
              }
            ],
            as: "sessionDoc"
          }
        },
        // Unwrap sessionDoc array to single object (or null)
        {
          $addFields: {
            sessionDoc: { $arrayElemAt: ["$sessionDoc", 0] }
          }
        },
        // Project the desired output shape
        {
          $project: {
            _id: 1,
            appointmentId: 1,
            sessionId: 1,
            doctorAssigned: 1,
            doctorAssignedUsername: 1,
            customer: 1,
            amount: 1,
            currency: 1,
            status: 1,
            linkId: 1,
            linkShortUrl: { $ifNull: ["$linkShortUrl", "$linkLongUrl"] },
            createdAt: 1,
            paidAt: 1,
            razorpay_payment_id: 1,
            raw: 1,
            purpose: 1,      // ← add
            invoice: 1,      // ← add
            // embed session fields at top-level for convenience
            session: {
              $cond: [
                { $ifNull: ["$sessionDoc", false] },
                {
                  _id: "$sessionDoc._id",
                  concern: "$sessionDoc.concern",
                  package_name: "$sessionDoc.package_name",
                  sessions_count: "$sessionDoc.sessions_count",
                  duration_weeks: "$sessionDoc.duration_weeks"
                },
                null
              ]
            }
          }
        }
      ];
  
      // Run aggregation using the Payment model's collection
      const payments = await Payment.aggregate(pipeline).allowDiskUse(true);
  
      console.log(`Found ${payments.length} payments for doctor (username=${username}, doctorId=${doctorId})`);
  
      return res.json({ success: true, count: payments.length, payments });
    } catch (err) {
      console.error("Error in POST /api/payments/doctor (with session lookup):", err && err.stack ? err.stack : err);
      return res.status(500).json({ success: false, message: "Server error fetching payments", error: String(err && err.message ? err.message : err) });
    }
  });
  

  // Route: POST /api/payments/generate-invoice
// body: { paymentId }  OR { appointmentId, amount, currency, customer: { name, contact, email }, items: [...] }
// replace previous /generate-invoice handler with this version
router.post("/generate-invoice", async (req, res) => {
  try {
    const { paymentId, linkId, referenceId, appointmentId, amount, currency = "INR", customer = {}, items = [], notes = "" } = req.body || {};

    console.log("DEBUG /generate-invoice payload:", { paymentId, linkId, referenceId, appointmentId, amount });

    // Try to find existing payment using multiple strategies
    let payment = null;

    // 1) If paymentId provided, try findById (ObjectId) and fallback to findOne({ _id: paymentId })
    if (paymentId) {
      try {
        // try as ObjectId
        if (/^[0-9a-fA-F]{24}$/.test(String(paymentId))) {
          payment = await Payment.findById(paymentId).lean();
          console.log("DEBUG looked up Payment by _id (as ObjectId):", !!payment);
        }
        if (!payment) {
          payment = await Payment.findOne({ _id: paymentId }).lean();
          console.log("DEBUG looked up Payment by _id (as string):", !!payment);
        }
      } catch (err) {
        console.warn("DEBUG paymentId lookup error:", err && err.message);
      }
    }

    // 2) linkId (Razorpay link id)
    if (!payment && linkId) {
      payment = await Payment.findOne({ linkId }).lean();
      console.log("DEBUG looked up Payment by linkId:", !!payment);
    }

    // 3) referenceId (custom field stored earlier)
    if (!payment && referenceId) {
      payment = await Payment.findOne({ referenceId }).lean();
      console.log("DEBUG looked up Payment by referenceId:", !!payment);
    }

    // 4) appointmentId lookup (may want the latest)
    if (!payment && appointmentId) {
      try {
        if (/^[0-9a-fA-F]{24}$/.test(String(appointmentId))) {
          payment = await Payment.findOne({ appointmentId: appointmentId }).sort({ createdAt: -1 }).lean();
          console.log("DEBUG looked up Payment by appointmentId:", !!payment);
        } else {
          // maybe appointmentId passed as some other identifier; try regex match
          payment = await Payment.findOne({ "appointmentId": appointmentId }).sort({ createdAt: -1 }).lean();
          console.log("DEBUG looked up Payment by appointmentId (fallback):", !!payment);
        }
      } catch (err) {
        console.warn("DEBUG appointmentId lookup error:", err && err.message);
      }
    }

    // If still no payment and amount provided + appointmentId provided -> create new Payment doc
    let createdPaymentDoc = null;
    if (!payment) {
      if (!appointmentId && !amount && !paymentId && !linkId && !referenceId) {
        console.log("DEBUG no identifiers and no amount -> rejecting");
        return res.status(400).json({ success: false, message: "Provide paymentId or linkId or referenceId or appointmentId+amount." });
      }

      // if we have at least appointmentId or amount, create payment doc
      const p = new Payment({
        appointmentId: appointmentId || null,
        amount: (currency === "INR" ? Math.round(Number(amount || 0) * 100) : Math.round(Number(amount || 0))),
        currency,
        customer: {
          name: customer.name || null,
          contact: customer.contact || null,
          email: customer.email || null
        },
        status: "created",
        raw: { generatedInvoiceBy: req.body.generatedBy || "backend" }
      });
      createdPaymentDoc = await p.save();
      payment = createdPaymentDoc.toObject();
      console.log("DEBUG created new Payment doc:", payment._id && payment._id.toString());
    }

    // now we must have payment
    if (!payment || !payment._id) {
      console.warn("DEBUG final: payment still not found/created", { payment });
      return res.status(400).json({ success: false, message: "Could not find or create Payment. Check identifiers." });
    }

    // Build invoice metadata
    const invoiceNumber = `INV-${String(payment._id).slice(-8)}`;
    const patientName = payment.customer?.name || customer.name || "Patient";
    const patientContact = payment.customer?.contact || customer.contact || "";
    const doctorName = payment.doctorAssignedUsername || req.body.doctorName || "";

    const invoiceItems = items.length ? items : [
      { description: "Consultation / Package payment", qty: 1, amount: payment.amount || 0, currency: payment.currency || "INR" }
    ];

    // create PDF buffer using existing helper (ensure createInvoicePdfBuffer is defined in this file scope)
    const pdfBuffer = await createInvoicePdfBuffer({
      invoiceNumber,
      patientName,
      patientContact,
      doctorName,
      amountDisplay: payment.currency === "INR" ? `₹${(payment.amount || 0) / 100}` : String(payment.amount || 0),
      currency: payment.currency || "INR",
      items: invoiceItems,
      notes
    });

    // upload to drive
    const filename = `invoice_${invoiceNumber}_${String(payment._id).slice(-6)}.pdf`;
    const driveResp = await uploadToDriveOAuth(pdfBuffer, filename, "application/pdf", process.env.GOOGLE_DRIVE_FOLDER_INVOICE || process.env.GOOGLE_DRIVE_FOLDER_ID || null);

    // update payment doc
    const invoiceData = {
      invoiceUrl: driveResp.webViewLink || null,
      invoiceDriveId: driveResp.id || null,
      invoiceFilename: filename,
      invoiceCreatedAt: new Date()
    };

    await Payment.updateOne({ _id: payment._id }, { $set: { invoice: invoiceData, invoiceNumber }, $push: { raw: { ...(payment.raw || {}), invoice_created: invoiceData } } }).catch((e)=> console.warn("updateOne invoice warning:", e && e.message));

    // send WA via AiSensy (best-effort)
    try {
      const rawPhone = payment.customer?.contact || customer.contact || "";
      const to = normalizePhoneToRough(rawPhone);
      if (to && (process.env.AISENSY_INVOICE_TEMPLATE || process.env.AISENSY_INVOICE_CAMPAIGN)) {
        const templateName = process.env.AISENSY_INVOICE_TEMPLATE || "invoice_template";
        const campaignName = process.env.AISENSY_INVOICE_CAMPAIGN || "";
        const patientLink = invoiceData.invoiceUrl || "";
        const amountDisplay = payment.currency === "INR" ? `₹${(payment.amount || 0) / 100}` : String(payment.amount || 0);

        const messagePayload = {
          to,
          campaignName,
          templateName,
          params: [patientName || "Patient", amountDisplay, patientLink, invoiceNumber]
        };
        console.log("DEBUG sending AiSensy invoice payload:", messagePayload);
        await sendTemplateMessage(messagePayload);
      } else {
        console.log("DEBUG AiSensy not configured or no patient phone");
      }
    } catch (waErr) {
      console.error("AiSensy send invoice WA error:", waErr && (waErr.message || waErr));
    }

    return res.json({
      success: true,
      message: "Invoice generated, uploaded and attempted WhatsApp send.",
      invoice: invoiceData,
      drive: driveResp,
      paymentId: String(payment._id)
    });
  } catch (err) {
    console.error("Error in /api/payments/generate-invoice:", err && (err.stack || err));
    return res.status(500).json({ success: false, message: "Server error generating invoice", error: String(err && err.message ? err.message : err) });
  }
});


  

module.exports = router;
