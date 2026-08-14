// ============================================================
// routes/patientAuth.js
// OTP-based login for ZeroMedicine Patients (web)
// Mounted at: app.use("/api/patient-auth", patientAuthRoutes)
//
// LOGIC:
//   - Phone = permanent patient identity (never duplicates)
//   - OTP is stored ON the Patient document (overwritten each time)
//   - Same patient logging in again → same patient_id, OTP updated
//   - First-time patient → new patient_id generated (pat_001, pat_002…)
// ============================================================

const express = require("express");
const router  = express.Router();
const crypto  = require("crypto");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const twilio  = require("twilio");
const PhysioAppointment = require("../Models/PhysioAppointment");
const Patient = require("../Models/Patient");

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

// Always store/lookup as 10 digits: "9876543210"
function normalizePhone(phone) {
  if (!phone) return "";
  let s = String(phone).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

// Generate next patient_id: pat_001, pat_002 …
async function generatePatientId() {
  const last = await Patient.findOne({}, { patient_id: 1 })
    .sort({ patient_id: -1 })
    .lean();

  if (!last) return "pat_001";
  const num = parseInt(last.patient_id.replace("pat_", ""), 10);
  return `pat_${String(num + 1).padStart(3, "0")}`;
}

async function sendOtpViaSMS(phone, otp) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID_ZEROMEDIXINE,
    process.env.TWILIO_AUTH_TOKEN_ZEROMEDIXINE
  );

  const message = await client.messages.create({
    body: `Your ZeroMedicine OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
    from: process.env.TWILIO_PHONE_NUMBER_ZEROMEDIXINE,
    to:   `+${phone}`,
  });

  console.log(`✅ Twilio OTP sent to +91${phone} | SID: ${message.sid}`);
}

// ─────────────────────────────────────────
// MIDDLEWARE: protect patient routes
// ─────────────────────────────────────────
function verifyPatientToken(req, res, next) {
  const token =
    req.cookies?.patientToken ||
    req.headers?.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.patient = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

// ─────────────────────────────────────────
// POST /api/patient-auth/send-otp
// Body: { phone: "9876543210" }
// Creates patient doc on first call; updates OTP on every call
// ─────────────────────────────────────────
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }

    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length < 11 || normalizedPhone.length > 15) {
      return res.status(400).json({ success: false, error: "Invalid phone number." });
    }

    // ── Rate limit: block if OTP sent in last 60 seconds ──
    const existing = await Patient.findOne({ phone_number: normalizedPhone }).lean();

    if (existing?.otp_last_sent_at) {
      const elapsed = Date.now() - new Date(existing.otp_last_sent_at).getTime();
      if (elapsed < 60 * 1000) {
        return res.status(429).json({
          success: false,
          error: "OTP already sent. Please wait 60 seconds before retrying.",
        });
      }
    }

    // ── Generate + hash OTP ──
    const otp      = generateOtp();
    const otp_hash = await bcrypt.hash(otp, 10);
    const now      = new Date();

    if (existing) {
      // ── RETURNING PATIENT — update OTP fields on same document ──
      await Patient.updateOne(
        { phone_number: normalizedPhone },
        {
          $set: {
            otp_hash,
            otp_expires_at:   new Date(now.getTime() + 10 * 60 * 1000),
            otp_attempts:     0,
            otp_last_sent_at: now,
          },
        }
      );
    } else {
      // ── FIRST TIME — create patient document ──
      const patient_id = await generatePatientId();
      await Patient.create({
        patient_id,
        phone_number:     normalizedPhone,
        otp_hash,
        otp_expires_at:   new Date(now.getTime() + 10 * 60 * 1000),
        otp_attempts:     0,
        otp_last_sent_at: now,
        profile_complete: false,
      });
      console.log(`🆕 New patient pre-created: ${patient_id} for ${normalizedPhone}`);
    }

    // ── Send SMS ──
    await sendOtpViaSMS(normalizedPhone, otp);

    return res.json({
      success: true,
      message: `OTP sent to +${normalizedPhone}`,
      is_new:  !existing,
      ...(process.env.NODE_ENV === "development" && { _devOtp: otp }),
    });

  } catch (err) {
    console.error("Patient send-otp error:", {
      code: err?.code,
      message: err?.message,
      moreInfo: err?.moreInfo,
      status: err?.status,
    });
    return res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});


// ─────────────────────────────────────────
// POST /api/patient-auth/resend-otp
// Body: { phone: "9876543210" }
// ─────────────────────────────────────────
router.post("/resend-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: "Phone is required" });

    const normalizedPhone = normalizePhone(phone);
    const patient = await Patient.findOne({ phone_number: normalizedPhone });

    if (!patient) {
      return res.status(400).json({ success: false, error: "No session found. Please request a new OTP." });
    }

    const otp      = generateOtp();
    const otp_hash = await bcrypt.hash(otp, 10);
    const now      = new Date();

    patient.otp_hash         = otp_hash;
    patient.otp_expires_at   = new Date(now.getTime() + 10 * 60 * 1000);
    patient.otp_attempts     = 0;
    patient.otp_last_sent_at = now;
    await patient.save();

    await sendOtpViaSMS(normalizedPhone, otp);

    return res.json({
      success: true,
      message: "OTP resent successfully",
      ...(process.env.NODE_ENV === "development" && { _devOtp: otp }),
    });

  } catch (err) {
    console.error("Patient resend-otp error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to resend OTP" });
  }
});


// ─────────────────────────────────────────
// POST /api/patient-auth/verify-otp
// Body: { phone: "9876543210", otp: "482951" }
// Returns JWT + patient data
// ─────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    const patient = await Patient.findOne({ phone_number: normalizedPhone });

    if (!patient) {
      return res.status(400).json({ success: false, error: "OTP not found. Please request a new one." });
    }

    // ── Expired? ──
    if (!patient.otp_expires_at || new Date() > patient.otp_expires_at) {
      patient.otp_hash       = null;
      patient.otp_expires_at = null;
      await patient.save();
      return res.status(400).json({ success: false, error: "OTP has expired. Please request a new one." });
    }

    // ── Too many attempts? ──
    if (patient.otp_attempts >= 3) {
      patient.otp_hash       = null;
      patient.otp_expires_at = null;
      await patient.save();
      return res.status(429).json({ success: false, error: "Too many wrong attempts. Please request a new OTP." });
    }

    // ── Validate OTP ──
    const isValid = await bcrypt.compare(otp, patient.otp_hash);
    if (!isValid) {
      patient.otp_attempts += 1;
      await patient.save();
      return res.status(400).json({
        success: false,
        error:   "Invalid OTP",
        attemptsLeft: 3 - patient.otp_attempts,
      });
    }

    // ── OTP valid — clear OTP fields, update last_login ──
    patient.otp_hash         = null;
    patient.otp_expires_at   = null;
    patient.otp_attempts     = 0;
    patient.last_login       = new Date();
    await patient.save();

    console.log(`✅ Patient login: ${patient.patient_id} | ${normalizedPhone}`);

    // ── Issue JWT ──
    const token = jwt.sign(
      {
        id:         patient._id,
        patient_id: patient.patient_id,
        phone:      patient.phone_number,
        name:       patient.name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.cookie("patientToken", token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge:   30 * 24 * 60 * 60 * 1000,   
    });

    return res.json({
      success:          true,
      message:          "Login successful",
      token,
      is_new_patient:   !patient.profile_complete,
      patient: {
        id:               patient._id,
        patient_id:       patient.patient_id,
        phone:            patient.phone_number,
        name:             patient.name,
        email:            patient.email,
        age:              patient.age,
        gender:           patient.gender,
        profile_complete: patient.profile_complete,
      },
    });

  } catch (err) {
    console.error("Patient verify-otp error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Verification failed" });
  }
});


// ─────────────────────────────────────────
// PATCH /api/patient-auth/update-profile
// Save patient name/email/age/gender after first login
// Body: { name, email, age, gender }
// ─────────────────────────────────────────
router.patch("/update-profile", verifyPatientToken, async (req, res) => {
  try {
    const { name, email, age, gender } = req.body;
    const updates = {};
    if (name   !== undefined) updates.name   = name;
    if (email  !== undefined) updates.email  = email;
    if (age    !== undefined) updates.age    = age;
    if (gender !== undefined) updates.gender = gender;

    if (name) updates.profile_complete = true;

    const patient = await Patient.findOneAndUpdate(
      { phone_number: req.patient.phone },
      { $set: updates },
      { new: true }
    );

    if (!patient) {
      return res.status(404).json({ success: false, error: "Patient not found" });
    }

    return res.json({
      success: true,
      patient: {
        id:               patient._id,
        patient_id:       patient.patient_id,
        phone:            patient.phone_number,
        name:             patient.name,
        email:            patient.email,
        age:              patient.age,
        gender:           patient.gender,
        profile_complete: patient.profile_complete,
      },
    });
  } catch (err) {
    console.error("Patient update-profile error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to update profile" });
  }
});


// ─────────────────────────────────────────
// GET /api/patient-auth/profile
// ─────────────────────────────────────────
router.get("/profile", verifyPatientToken, async (req, res) => {
  try {
    const patient = await Patient.findOne({ phone_number: req.patient.phone }).lean();
    if (!patient) return res.status(404).json({ success: false, error: "Patient not found" });

    return res.json({
      success: true,
      patient: {
        id:               patient._id,
        patient_id:       patient.patient_id,
        phone:            patient.phone_number,
        name:             patient.name,
        email:            patient.email,
        age:              patient.age,
        gender:           patient.gender,
        total_bookings:   patient.total_bookings,
        profile_complete: patient.profile_complete,
        created_at:       patient.created_at,
        last_login:       patient.last_login,
      },
    });
  } catch (err) {
    console.error("Patient profile error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to fetch profile" });
  }
});


// ─────────────────────────────────────────
// GET /api/patient-auth/bookings
// Returns logged-in patient's appointments
// ─────────────────────────────────────────
router.get("/bookings", verifyPatientToken, async (req, res) => {
    try {
      const patient = await Patient.findOne({ phone_number: req.patient.phone }).lean();
      if (!patient) return res.status(404).json({ success: false, error: "Patient not found" });
      const appointments = await PhysioAppointment.find({ patient_id: patient.patient_id })
      .populate("doctor_ref", "name")   // ← fetches doctor name
      .sort({ booked_at: -1 })
      .lean();
    
    const enriched = appointments.map(a => ({
      ...a,
      doctor_name: a.doctor_ref?.name || null,
    }));
    
    return res.json({ success: true, patient, appointments: enriched });
    } catch (err) {
      console.error("Patient bookings error:", err?.message || err);
      return res.status(500).json({ success: false, error: "Failed to fetch bookings" });
    }
  });

  
// ─────────────────────────────────────────
// POST /api/patient-auth/logout
// ─────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie("patientToken");
  return res.json({ success: true, message: "Logged out" });
});


module.exports = router;
module.exports.verifyPatientToken = verifyPatientToken;

// ─────────────────────────────────────────
// MOUNT IN server.js / app.js:
//   const patientAuthRoutes = require("./routes/patientAuth");
//   app.use("/api/patient-auth", patientAuthRoutes);
// ─────────────────────────────────────────