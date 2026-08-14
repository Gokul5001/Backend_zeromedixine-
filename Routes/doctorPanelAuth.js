// ============================================================
// Routes/doctorPanelAuth.js
// Doctor-facing login — authenticates against the existing
// login_credentials collection (type: "Physiotherapist"),
// then resolves the linked Doctor profile via loginCredentialId.
//
// Mount in server.js:
//   const doctorPanelAuth = require("./Routes/doctorPanelAuth");
//   app.use("/api/doctor-panel", doctorPanelAuth);
//
// Reuses the SAME "access_token" cookie / JWT_SECRET as
// Middleware/authMiddleware.js's requireAuth, so a doctor who
// logs in here can call the existing protected routes as-is,
// e.g. GET /api/admin/physio-appointments/mine
//
// ROUTES IN THIS FILE:
//   POST  /api/doctor-panel/login
//   GET   /api/doctor-panel/me
//   GET   /api/doctor-panel/profile   — full profile for the edit form
//   PATCH /api/doctor-panel/profile   — update profile, incl. profile
//                                        image (S3) and voice note
//                                        (Google Drive), multipart/form-data
//   GET   /api/doctor-panel/appointments
//   GET   /api/doctor-panel/assessment/:id  — NEW: full AI intake
//                                        assessment for appointments that
//                                        came in via the AI chat assistant
//                                        (appt.assessment_id). Powers the
//                                        "AI Summary" modal on the
//                                        dashboard's appointment cards.
//   POST  /api/doctor-panel/logout
// ============================================================

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { summarizeProfessional } = require("../services/geminiSummarize");
const LoginCredential = require("../Models/Logincredential");
const Doctor = require("../Models/Doctor");
const { requireAuth } = require("../Middleware/authMiddleware");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const PhysioAppointment = require("../Models/PhysioAppointment");

// Model backing the "assessments" collection (AI chat-assistant intake
// results). Adjust this path if your Assessment model lives elsewhere —
// it should map to the same collection shown in the Mongo Atlas
// Data Explorer (fields: conditionCategory, severity, description,
// redFlag, redFlagReason, summaryForPhysio, patientSummary,
// recommendedSpecialist, nextQuestions, modelUsed, rawModelResponse, ...).
const Assessment = require("../Models/Assessment");


// Reuse loginRateLimiter if present in the project; fall back to a no-op
// so this file doesn't hard-crash if the path differs.
let loginRateLimiter = (req, res, next) => next();
try {
  loginRateLimiter = require("../Middleware/rateLimit").loginRateLimiter || loginRateLimiter;
} catch (_) {
  console.warn("[doctorPanelAuth] rateLimit middleware not found — running without it");
}

const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ─────────────────────────────────────────────
// S3 client — same pattern as routes/doctorOtpAuth.js
// ─────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(buffer, filename, mimetype) {
  const key = `doctor-profiles/${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ─────────────────────────────────────────────
// Multer — memory storage, same allowed types as doctorOtpAuth.js
// ─────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — covers both images and audio
  fileFilter: (req, file, cb) => {
    const allowedImages = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    const allowedAudio = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"];
    if ([...allowedImages, ...allowedAudio].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG/PNG/WebP images and MP3/MP4/WebM/OGG/WAV/M4A audio are allowed"));
    }
  },
});

// ─────────────────────────────────────────────
// HELPER: same "is this profile fully filled in" check used elsewhere
// ─────────────────────────────────────────────
function isProfileVerified(doctor) {
  return !!(
    doctor.name &&
    doctor.role &&
    doctor.years_of_experience &&
    doctor.conditions_treated?.length > 0 &&
    doctor.languages?.length > 0 &&
    doctor.session_pricing &&
    doctor.availability?.days?.length > 0 &&
    doctor.availability?.start_time &&
    doctor.availability?.end_time
  );
}

// ─────────────────────────────────────────────
// POST /api/doctor-panel/login
// body: { username, password }
// "username" may be a username, mobile number, or email —
// same lookup pattern as the existing admin login.
// ─────────────────────────────────────────────
router.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !String(username).trim() || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Username and password are required" });
    }

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Only match credentials belonging to a Physiotherapist account —
    // this endpoint is doctor-only, clinics/superadmins use their own logins.
    const credential = await LoginCredential.findOne({
      type: "Physiotherapist",
      $or: [
        { username: { $regex: new RegExp(`^${esc}$`, "i") } },
        { mobile_no: raw },
        { email: { $regex: new RegExp(`^${esc}$`, "i") } },
      ],
    });

    if (!credential) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    const stored = credential.password || "";
    let passwordMatches = false;

    if (/^\$2[ayb]\$/.test(stored)) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      // legacy plaintext fallback + silent migration to bcrypt
      passwordMatches = stored === password;
      if (passwordMatches) {
        try {
          const newHash = await bcrypt.hash(password, 12);
          await LoginCredential.updateOne(
            { _id: credential._id },
            { $set: { password: newHash } }
          );
          console.log("Migrated password to bcrypt for doctor login:", credential._id);
        } catch (e) {
          console.warn("Password migration failed for", credential._id, e);
        }
      }
    }

    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    // Resolve the linked Doctor profile
    const doctor = await Doctor.findOne({ loginCredentialId: credential._id }).lean();
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "No doctor profile is linked to this account yet. Contact the super admin.",
      });
    }

    const payload = {
      id: credential._id.toString(),
      username: credential.username || credential.email || credential.mobile_no,
      role: "doctor",
    };

    const token = createToken(payload);

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 8, // 8h, matches JWT_EXPIRES default
    });

    return res.json({
      success: true,
      user: {
        _id: credential._id,
        username: payload.username,
        role: "doctor",
      },
      doctor: {
        doctorMongoId: doctor._id,
        doctor_id: doctor.doctor_id,
        name: doctor.name,
        role: doctor.role,
        profile_image: doctor.profile_image || null,
      },
    });
  } catch (err) {
    console.error("Doctor login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
});

// GET /api/doctor-panel/me — quick session check for the dashboard
router.get("/me", requireAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ loginCredentialId: req.user.id }).lean();
    if (!doctor) {
      return res.status(404).json({ success: false, message: "No doctor profile linked to this login" });
    }
    return res.json({
      success: true,
      user: req.user,
      doctor: {
        doctorMongoId: doctor._id,
        doctor_id: doctor.doctor_id,
        name: doctor.name,
        role: doctor.role,
        profile_image: doctor.profile_image || null,
      },
    });
  } catch (err) {
    console.error("Doctor /me error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─────────────────────────────────────────────
// GET /api/doctor-panel/profile
// Full profile for the "Edit doctor profile" form.
// Requires: access_token cookie (requireAuth)
// ─────────────────────────────────────────────
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ loginCredentialId: req.user.id }).lean();
    if (!doctor) {
      return res.status(404).json({ success: false, message: "No doctor profile linked to this login" });
    }

    return res.json({
      success: true,
      doctor: {
        id: doctor._id,
        doctor_id: doctor.doctor_id,
        phone: doctor.phone_number,
        name: doctor.name,
        role: doctor.role,
        years_of_experience: doctor.years_of_experience,
        profile_image: doctor.profile_image || null,
        voice_note: doctor.voice_note || null,
        conditions_treated: doctor.conditions_treated || [],
        languages: doctor.languages || [],
        availability: doctor.availability || { days: [], start_time: "", end_time: "" },
        session_pricing: doctor.session_pricing,
        single_session_price: doctor.single_session_price,
        single_session_price_usd: doctor.single_session_price_usd,
        packages: doctor.packages || [],
        packages_usd: doctor.packages_usd || [],
        profile_complete: doctor.profile_complete,
        verified_profile: doctor.verified_profile,
        created_at: doctor.created_at,
        last_login: doctor.last_login,
      },
    });
  } catch (err) {
    console.error("Doctor /profile GET error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/doctor-panel/profile
// Content-Type: multipart/form-data
// Body: any subset of { name, role, session_pricing, years_of_experience,
//                        conditions_treated (JSON string array),
//                        languages (JSON string array),
//                        availability (JSON string object) }
// Files: profile_image (optional → S3), voice_note (optional → Google Drive)
// Requires: access_token cookie (requireAuth)
// ─────────────────────────────────────────────
router.patch(
  "/profile",
  requireAuth,
  upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "voice_note", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { name, role, session_pricing, years_of_experience } = req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (role !== undefined) updates.role = role;
      if (session_pricing !== undefined) updates.session_pricing = session_pricing;
      if (years_of_experience !== undefined) updates.years_of_experience = years_of_experience;

      if (req.body.conditions_treated !== undefined) {
        try {
          updates.conditions_treated = JSON.parse(req.body.conditions_treated);
        } catch {
          return res.status(400).json({ success: false, message: "Invalid JSON in conditions_treated" });
        }
      }
      if (req.body.languages !== undefined) {
        try {
          updates.languages = JSON.parse(req.body.languages);
        } catch {
          return res.status(400).json({ success: false, message: "Invalid JSON in languages" });
        }
      }
      if (req.body.availability !== undefined) {
        try {
          updates.availability = JSON.parse(req.body.availability);
        } catch {
          return res.status(400).json({ success: false, message: "Invalid JSON in availability" });
        }
      }

      // ── Upload profile image to S3, if provided ──
      const profileImageFile = req.files?.profile_image?.[0];
      if (profileImageFile) {
        const filename = `doctor_profile_${Date.now()}_${profileImageFile.originalname}`;
        updates.profile_image = await uploadToS3(
          profileImageFile.buffer,
          filename,
          profileImageFile.mimetype
        );
      }

      // ── Upload voice note to Google Drive, if provided ──
      const voiceNoteFile = req.files?.voice_note?.[0];
      if (voiceNoteFile) {
        const allowedAudio = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"];
        if (!allowedAudio.includes(voiceNoteFile.mimetype)) {
          return res.status(400).json({
            success: false,
            message: "Invalid audio format. Allowed: mp3, mp4, webm, ogg, wav, m4a",
          });
        }
        const filename = `doctor_voice_${Date.now()}_${voiceNoteFile.originalname}`;
        const result = await uploadToDriveOAuth(voiceNoteFile.buffer, filename, voiceNoteFile.mimetype);
        updates.voice_note =
          result?.webViewLink || (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: "No fields provided to update" });
      }

      const doctor = await Doctor.findOneAndUpdate(
        { loginCredentialId: req.user.id },
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!doctor) {
        return res.status(404).json({ success: false, message: "No doctor profile linked to this login" });
      }

      // Recompute profile_complete on the full merged document
      const isNowComplete = isProfileVerified(doctor);
      if (doctor.profile_complete !== isNowComplete) {
        doctor.profile_complete = isNowComplete;
        await doctor.save();
      }

      return res.json({
        success: true,
        message: "Profile updated successfully",
        doctor: {
          id: doctor._id,
          doctor_id: doctor.doctor_id,
          phone: doctor.phone_number,
          name: doctor.name,
          role: doctor.role,
          years_of_experience: doctor.years_of_experience,
          profile_image: doctor.profile_image || null,
          voice_note: doctor.voice_note || null,
          conditions_treated: doctor.conditions_treated || [],
          languages: doctor.languages || [],
          availability: doctor.availability || { days: [], start_time: "", end_time: "" },
          session_pricing: doctor.session_pricing,
          profile_complete: doctor.profile_complete,
          verified_profile: doctor.verified_profile,
        },
      });
    } catch (err) {
      console.error("Doctor /profile PATCH error:", err);
      return res.status(500).json({ success: false, message: "Failed to update profile" });
    }
  }
);


router.get("/appointments", requireAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ loginCredentialId: req.user.id })
      .maxTimeMS(8000)
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "No doctor profile linked to this login",
      });
    }

    const appointments = await PhysioAppointment.find({
      $or: [{ doctor_ref: doctor._id }, { doctor_id: doctor.doctor_id }],
    })
      .sort({ booked_at: -1 })
      .maxTimeMS(8000)
      .lean();

    return res.json({
      success: true,
      doctor: { name: doctor.name, doctor_id: doctor.doctor_id },
      appointments,
    });
  } catch (err) {
    console.error("doctor-panel/appointments error:", err);
    return res.status(503).json({
      success: false,
      message: "Temporarily unable to load appointments — please retry",
    });
  }
});

// ─────────────────────────────────────────────
// GET /api/doctor-panel/assessment/:id
// Returns the full AI intake assessment for an appointment that came in
// via the AI chat assistant (appointment.assessment_id points here).
// Powers the "AI Summary" modal on the dashboard's appointment cards —
// includes the parsed fields (conditionCategory, severity, description,
// redFlag/redFlagReason, summaryForPhysio, patientSummary,
// recommendedSpecialist, nextQuestions) as well as modelUsed and the
// full rawModelResponse, so the doctor can see everything the AI produced.
// Requires: access_token cookie (requireAuth), doctor-only.
// ─────────────────────────────────────────────
router.get("/assessment/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid assessment id" });
    }

    const assessment = await Assessment.findById(id).maxTimeMS(8000).lean();
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }

    return res.json({
      success: true,
      assessment: {
        id: assessment._id,
        conditionCategory: assessment.conditionCategory,
        severity: assessment.severity,
        description: assessment.description,
        redFlag: assessment.redFlag,
        redFlagReason: assessment.redFlagReason,
        summaryForPhysio: assessment.summaryForPhysio,
        patientSummary: assessment.patientSummary,
        recommendedSpecialist: assessment.recommendedSpecialist,
        nextQuestions: assessment.nextQuestions || [],
        modelUsed: assessment.modelUsed,
        rawModelResponse: assessment.rawModelResponse,
        createdAt: assessment.createdAt,
      },
    });
  } catch (err) {
    console.error("Doctor /assessment GET error:", err);
    return res.status(500).json({ success: false, message: "Failed to load assessment" });
  }
});

// POST /api/doctor-panel/summarize-text
// body: { text, fieldContext } — rewrites text via Gemini, doesn't touch the DB.
router.post("/summarize-text", requireAuth, async (req, res) => {
  try {
    const { text, fieldContext } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: "No text provided to summarize" });
    }
    const summary = await summarizeProfessional(String(text).trim(), fieldContext);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error("Doctor /summarize-text error:", err);
    return res.status(500).json({ success: false, message: "Could not summarize this text right now" });
  }
});

// POST /api/doctor-panel/appointments/:id/post-session-enquiry
// body: { chief_complaints, notes } — saves onto the appointment, scoped to this doctor.
router.post("/appointments/:id/post-session-enquiry", requireAuth, async (req, res) => {
  try {
    const { chief_complaints, notes, sessionNumber } = req.body;
    if (!chief_complaints || !chief_complaints.trim()) {
      return res.status(400).json({ success: false, message: "Chief complaints can't be empty" });
    }

    const appt = await PhysioAppointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    const enquiry = { chief_complaints, notes: notes || null, submitted_at: new Date() };

    if (sessionNumber != null && Array.isArray(appt.sessions) && appt.sessions.length) {
      const session = appt.sessions.find((s) => s.session_number === Number(sessionNumber));
      if (!session) {
        return res.status(404).json({ success: false, message: `Session ${sessionNumber} not found` });
      }
      session.post_session_enquiry = enquiry;
    } else {
      appt.post_session_enquiry = enquiry;
    }

    await appt.save();
    return res.json({ success: true, appointment: appt });
  } catch (err) {
    console.error("post-session-enquiry error:", err);
    return res.status(500).json({ success: false, message: "Could not save this enquiry" });
  }
});
// POST /api/doctor-panel/logout
router.post("/logout", (req, res) => {
  res.clearCookie("access_token", { httpOnly: true, sameSite: "lax" });
  return res.json({ success: true, message: "Logged out" });
});

module.exports = router;