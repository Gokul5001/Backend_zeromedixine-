const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const express = require("express");
const router = express.Router();
const OplivaAppointment = require("../Models/OplivaAppointment");
const OplivaPlan = require("../Models/OplivaPlan");
const OplivaPayment = require("../Models/OplivaPayment");
const crypto = require("crypto");
const OplivaSession = require("../Models/OplivaSession");
const twilio = require("twilio");
const ClinicCode = require("../Models/ClinicCode");
const multer = require("multer");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const OplivaConsentForm = require("../Models/OplivaConsentForm");


const {
  sendOplivaPatientConfirmation,
  sendOplivaAdminAlert
} = require("../utils/oplivaWhatsApp");


const twilioClient = twilio(
  process.env.TWILIO_API_KEY_SID,
  process.env.TWILIO_API_KEY_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});


const normalizePhone = (p) => {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
};


function trimmedEnv(key) {
  const v = process.env[key];
  return (typeof v === "string" ? v.trim() : null) || null;
}

const razorpay = new Razorpay({
  key_id: trimmedEnv("RAZORPAY_KEY_ID"),
  key_secret: trimmedEnv("RAZORPAY_KEY_SECRET")
});


// router.post("/consultation", async (req, res) => {
//   try {
//     const { name, email, phone, age, message } = req.body;

//     if (!name || !email || !phone || !age || !message) {
//       return res.status(400).json({
//         success: false,
//         message: "All fields are required"
//       });
//     }

//     // ==========================
//     // 1️⃣ Store in DB
//     // ==========================
//     const newLead = await OplivaAppointment.create({
//       name,
//       email,
//       phone,
//       age,
//       message
//     });

//     console.log("✅ Opliva lead stored:", newLead._id);

//     const normalizedPhone = normalizePhone(phone);

//     // ==========================
//     // 2️⃣ Send WhatsApp to Patient
//     // ==========================
//     try {
//       await sendOplivaPatientConfirmation({
//         to: normalizedPhone,
//         name
//       });
//       console.log("📤 Patient WA sent");
//     } catch (err) {
//       console.error("⚠ Patient WA failed:", err.message);
//     }

//     // ==========================
//     // 3️⃣ Send WhatsApp to Admin
//     // ==========================
//     try {
//       const adminNumber = process.env.OPLIVA_ADMIN_NUMBER;

//       if (adminNumber) {
//         await sendOplivaAdminAlert({
//           to: adminNumber,
//           name,
//           phone: normalizedPhone,
//           age
//         });
//         console.log("📤 Admin WA sent");
//       }
//     } catch (err) {
//       console.error("⚠ Admin WA failed:", err.message);
//     }

//     return res.status(201).json({
//       success: true,
//       message: "Consultation stored & notifications triggered"
//     });

//   } catch (error) {
//     console.error("Opliva consultation error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error"
//     });
//   }
// });



// router.post("/consultation", async (req, res) => {
//   try {
//     const { name, email, phone, age, message, promoCode } = req.body;

//     if (!name || !email || !phone || !age || !message) {
//       return res.status(400).json({
//         success: false,
//         message: "All fields are required"
//       });
//     }

//     // ==========================
//     // 1️⃣ Store in DB
//     // ==========================
//     const newLead = await OplivaAppointment.create({
//       name,
//       email,
//       phone,
//       age,
//       message,
//       promoCode: promoCode || null   // ✅ added
//     });

//     console.log("✅ Opliva lead stored:", newLead._id);

//     const normalizedPhone = normalizePhone(phone);

//     // ==========================
//     // 2️⃣ Send WhatsApp to Patient
//     // ==========================
//     try {
//       await sendOplivaPatientConfirmation({
//         to: normalizedPhone,
//         name
//       });
//       console.log("📤 Patient WA sent");
//     } catch (err) {
//       console.error("⚠ Patient WA failed:", err.message);
//     }

//     // ==========================
//     // 3️⃣ Send WhatsApp to Admin
//     // ==========================
//     try {
//       const adminNumber = process.env.OPLIVA_ADMIN_NUMBER;

//       if (adminNumber) {
//         await sendOplivaAdminAlert({
//           to: adminNumber,
//           name,
//           phone: normalizedPhone,
//           age,
//           promoCode: promoCode || "N/A" // ✅ optional in alert
//         });
//         console.log("📤 Admin WA sent");
//       }
//     } catch (err) {
//       console.error("⚠ Admin WA failed:", err.message);
//     }

//     return res.status(201).json({
//       success: true,
//       message: "Consultation stored & notifications triggered"
//     });

//   } catch (error) {
//     console.error("Opliva consultation error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error"
//     });
//   }
// });


router.post("/consultation", async (req, res) => {
  try {
    const { name, email, phone, age, message, promoCode } = req.body;

    // ==========================
    // 1️⃣ Basic Validation
    // ==========================
    if (!name || !email || !phone || !age || !message) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // ==========================
    // 2️⃣ Validate Promo Code
    // ==========================
    let clinicData = null;

    if (promoCode && promoCode.trim() !== "") {
      clinicData = await ClinicCode.findOne({
        clinic_code: promoCode.trim(),
        status: "active"
      });

      if (!clinicData) {
        return res.status(400).json({
          success: false,
          field: "promoCode",
          message: "Enter a valid clinic code"
        });
      }
    }

    // ==========================
    // 3️⃣ Normalize Phone
    // ==========================
    const normalizedPhone = normalizePhone(phone);

    // ==========================
    // 4️⃣ Store in DB
    // ==========================
    const newLead = await OplivaAppointment.create({
      name,
      email,
      phone: normalizedPhone,
      age,
      message,

      promoCode: promoCode || null,

      clinic_code: clinicData?.clinic_code || null,
      clinic_name: clinicData?.clinic_name || null
    });

    console.log("✅ Opliva lead stored:", newLead._id);

    // ==========================
    // 5️⃣ Send WhatsApp to Patient
    // ==========================
    try {
      await sendOplivaPatientConfirmation({
        to: normalizedPhone,
        name
      });
      console.log("📤 Patient WA sent");
    } catch (err) {
      console.error("⚠ Patient WA failed:", err.message);
    }

    // ==========================
    // 6️⃣ Send WhatsApp to Admin
    // ==========================
    try {
      const adminNumber = process.env.OPLIVA_ADMIN_NUMBER;

      if (adminNumber) {
        await sendOplivaAdminAlert({
          to: adminNumber,
          name,
          phone: normalizedPhone,
          age,
          promoCode: promoCode || "N/A",
          clinic_name: clinicData?.clinic_name || "No clinic"
        });
        console.log("📤 Admin WA sent");
      }
    } catch (err) {
      console.error("⚠ Admin WA failed:", err.message);
    }

    // ==========================
    // 7️⃣ Success Response
    // ==========================
    return res.status(201).json({
      success: true,
      message: "Consultation stored & notifications sent"
    });

  } catch (error) {
    console.error("❌ Opliva consultation error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});



router.get("/appointments", async (req, res) => {
  try {

    const leads = await OplivaAppointment
      .find()
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: leads
    });

  } catch (error) {
    console.error("Fetch Opliva leads error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.get("/plans", async (req, res) => {
  try {

    const plans = await OplivaPlan
      .find({ is_active: true })
      .sort({ price_inr: 1 });

    res.json({
      success: true,
      plans
    });

  } catch (error) {

    console.error("Fetch plans error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }
});



router.post("/book-plan", async (req, res) => {

  try {

    const { leadId, planId, currency = "INR", notes } = req.body;

    if (!leadId || !planId) {

      return res.status(400).json({
        success: false,
        message: "leadId and planId required"
      });

    }

    const lead = await OplivaAppointment.findById(leadId);
    const plan = await OplivaPlan.findById(planId);

    if (!lead || !plan) {

      return res.status(404).json({
        success: false,
        message: "Lead or Plan not found"
      });

    }

    // ==========================
    // PRICE
    // ==========================

    const amount =
      currency === "USD"
        ? plan.price_usd
        : plan.price_inr;

    const amountSmallest =
      currency === "INR"
        ? amount * 100
        : amount;

    // ==========================
    // UNIQUE REFERENCE
    // ==========================

    const referenceId =
      `${leadId}-${uuidv4().slice(0,8)}`;

    // ==========================
    // CREATE RAZORPAY LINK
    // ==========================

    const link = await razorpay.paymentLink.create({

      amount: amountSmallest,

      currency: currency,

      accept_partial: false,

      reference_id: referenceId,

      description: `Opliva Plan - ${plan.plan_name}`,

      customer: {

        name: lead.name,
        contact: lead.phone,
        email: lead.email

      },

      notify: {
        sms: false,
        email: false
      }

    });

    // ==========================
    // STORE PAYMENT RECORD
    // ==========================

    const payment = await OplivaPayment.create({

      leadId: lead._id,

      planId: plan._id,

      planName: plan.plan_name,

      amount,

      currency,

      paymentStatus: "pending",

      paymentMethod: "razorpay",

      paymentLink: link.short_url,

      transactionId: link.id,

      notes

    });

    // ==========================
    // RESPONSE
    // ==========================

    return res.json({

      success: true,

      message: "Plan booked and payment link created",

      paymentId: payment._id,

      paymentLink: link.short_url

    });

  }
  catch (error) {

    console.error("Book plan error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});



router.get("/payments", async (req, res) => {

  try {

    const payments = await OplivaPayment
      .find()
      .populate("leadId")
      .populate("planId")
      .sort({ createdAt: -1 });

    const data = payments.map(p => ({

      id: p._id,
      name: p.leadId?.name || "",
      phone: p.leadId?.phone || "",
      email: p.leadId?.email || "",
      planName: p.planName,

      amount: p.amount,

      currency: p.currency,

      paymentStatus: p.paymentStatus,
      paymentLink:p.paymentLink,

      createdAt: p.createdAt

    }));

    res.json({
      success: true,
      payments: data
    });

  } catch (error) {

    console.error("Fetch payments error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});


// ==========================================
// Razorpay Webhook for Opliva Payments
// ==========================================

router.post("/payment-webhook", async (req, res) => {
  try {

    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.OPLIVA_RAZORPAY_WEBHOOK_SECRET;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (signature !== expectedSignature) {

      console.warn("⚠ Invalid Razorpay webhook signature");

      return res.status(400).send("Invalid signature");

    }

    const payload = JSON.parse(req.body.toString());

    const event = payload.event;

    console.log("Opliva Razorpay event:", event);

    if (event === "payment_link.paid") {

      const paymentLink = payload.payload.payment_link.entity;

      const linkId = paymentLink.id;

      const payment = await OplivaPayment.findOne({
        transactionId: linkId
      });

      if (!payment) {

        console.warn("⚠ Opliva payment not found for:", linkId);

        return res.json({ ok: true });

      }

      payment.paymentStatus = "paid";

      payment.razorpayPaymentId =
        payload.payload.payment.entity.id;

      payment.paidAt = new Date();

      await payment.save();

      console.log("✅ Opliva payment updated:", payment._id);

    }

    res.json({ success: true });

  }
  catch (error) {

    console.error("Opliva webhook error:", error);

    res.status(500).send("Webhook error");

  }

});


router.post("/book-session", async (req, res) => {

  try {

    const { leadId, preferredDate, preferredTime } = req.body;

    if (!leadId || !preferredDate || !preferredTime) {
      return res.status(400).json({
        success:false,
        message:"Missing required fields"
      });
    }

    const lead = await OplivaAppointment.findById(leadId);

    if(!lead){
      return res.status(404).json({
        success:false,
        message:"Lead not found"
      });
    }

    // ======================
    // Create Twilio Room
    // ======================

    const roomName = `opliva_${uuidv4()}`;

    const room = await twilioClient.video.rooms.create({
      uniqueName: roomName,
      type: "group",
      recordParticipantsOnConnect:false
    });

    const FRONTEND_URL = process.env.FRONTEND_URL || "";

    const patientLink =
      FRONTEND_URL
        ? `${FRONTEND_URL}/consult/${roomName}`
        : `/consult/${roomName}`;

    const doctorLink =
      FRONTEND_URL
        ? `${FRONTEND_URL}/doctor/join/${roomName}`
        : `/doctor/join/${roomName}`;

    // ======================
    // Save Session
    // ======================

    const session = await OplivaSession.create({

      leadId,

      preferredDate,
      preferredTime,

      roomName,
      roomSid: room.sid,

      patientLink,
      doctorLink,

      status: "scheduled"

    });

    return res.json({

      success:true,
      message:"Session created",

      sessionId: session._id,
      patientLink,
      doctorLink

    });

  }
  catch(error){

    console.error("Book session error:",error);

    res.status(500).json({
      success:false,
      message:"Server error"
    });

  }

});



router.get("/sessions", async (req,res)=>{

  try{

    const sessions = await OplivaSession
      .find()
      .populate("leadId")
      .sort({createdAt:-1});

    res.json({
      success:true,
      sessions
    });

  }
  catch(err){

    console.error(err);

    res.status(500).json({
      success:false
    });

  }

});


// ==========================================
// 🧬 OPLIVA GENETIC CONSENT FORM
// ==========================================
router.post("/opliva-consent", upload.single("file"), async (req, res) => {
  try {
    const formData = JSON.parse(req.body.data || "{}");

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "PDF file missing"
      });
    }

    // ==========================
    // Upload to Google Drive
    // ==========================
    const filename = `opliva_consent_${Date.now()}.pdf`;

    const result = await uploadToDriveOAuth(
      req.file.buffer,
      filename,
      req.file.mimetype || "application/pdf",
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );

    const driveUrl =
      result?.webViewLink ||
      (result?.id
        ? `https://drive.google.com/file/d/${result.id}/view`
        : null);

    console.log("📄 Opliva consent uploaded:", driveUrl);


    // ==========================
// STORE IN DB
// ==========================
await OplivaConsentForm.create({
  ...formData,
  driveUrl
});


    // ==========================
    // OPTIONAL: STORE IN DB
    // ==========================
    // If you want later:
    // await OplivaConsent.create({ ...formData, driveUrl });

    // ==========================
    // OPTIONAL: SEND WHATSAPP
    // ==========================
    try {
      if (formData.contact) {
        const phone = normalizePhone(formData.contact);

        // reuse your WA utils if needed
        // await sendOplivaPatientConfirmation({ to: phone, name: formData.name });

        console.log("📤 Consent WA optional trigger");
      }
    } catch (err) {
      console.error("WA error:", err.message);
    }

    return res.json({
      success: true,
      message: "Consent form submitted",
      driveUrl
    });

  } catch (err) {
    console.error("❌ Opliva consent error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});


module.exports = router;