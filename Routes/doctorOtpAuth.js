// ============================================================
// routes/doctorOtpAuth.js
// OTP-based login for ZeroMedicine Doctor App
// Uses Fast2SMS Quick SMS (no DLT required)
// Collections: otp_verifications + doctors
// Phone number = permanent doctor identity (never duplicates)
// ============================================================

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const OtpVerification = require("../Models/OtpVerification");
const Doctor = require("../Models/Doctor");
const twilio = require("twilio");
const multer = require("multer");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");


const s3 = new S3Client({
  region: process.env.AWS_REGION,          // e.g. "ap-south-1"
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ── helper: same slugify logic used on the frontend ──
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uploadToS3(buffer, filename, mimetype) {
  const key = `doctor-profiles/${filename}`;

  await s3.send(new PutObjectCommand({
    Bucket:      process.env.AWS_S3_BUCKET_NAME,   // "zeromedixine-doctor-images"
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
    CacheControl: "public, max-age=31536000, immutable",

  }));

  // Return the public URL (works if bucket has public-read or a bucket policy)
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}


// ── Multer: memory storage for profile image uploads ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — covers both images and audio
  fileFilter: (req, file, cb) => {
    const allowedImages = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    const allowedAudio  = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"];
    if ([...allowedImages, ...allowedAudio].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG/PNG/WebP images and MP3/MP4/WebM/OGG/WAV/M4A audio are allowed"));
    }
  }
});

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

// ─────────────────────────────────────────
// HELPER: checks if all required fields are filled
// ─────────────────────────────────────────
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

// Always store/lookup as 10 digits: "6380085913"
function normalizePhone(phone) {
  return String(phone).replace(/\D/g, "").replace(/^91/, "").slice(-10);
}

// Generate next doctor_id: find highest existing → increment
// e.g. doc_001, doc_002, doc_003 ...
async function generateDoctorId() {
  const last = await Doctor.findOne({}, { doctor_id: 1 })
    .sort({ doctor_id: -1 })
    .lean();

  if (!last) return "doc_001";

  const num = parseInt(last.doctor_id.replace("doc_", ""), 10);
  return `doc_${String(num + 1).padStart(3, "0")}`;
}

// ─────────────────────────────────────────
// Send OTP via Fast2SMS Quick SMS
// No DLT registration required
// ─────────────────────────────────────────
// async function sendOtpViaSMS(phone, otp) {

//   const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
//     method: "POST",
//     headers: {
//       "authorization": process.env.FAST2SMS_API_KEY,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({
//       route: "q",
//       message: `Your ZeroMedicine doctor login OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
//       language: "english",
//       numbers: phone    // 10 digit, no country code
//     })
//   });

//   const data = await res.json();
//   if (!data.return) {
//     console.error("Fast2SMS error:", JSON.stringify(data));
//     throw new Error(data.message || "Failed to send SMS");
//   }

//   console.log(`✅ Fast2SMS OTP sent to ${phone}`);
// }
async function sendOtpViaSMS(phone, otp) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID_ZEROMEDIXINE,
    process.env.TWILIO_AUTH_TOKEN_ZEROMEDIXINE
  );

  const message = await client.messages.create({
    body: `Your ZeroMedicine doctor login OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
    from: process.env.TWILIO_PHONE_NUMBER_ZEROMEDIXINE,
    to: `+91${phone}`   // Indian numbers — adjust prefix if needed
  });

  console.log(`✅ Twilio OTP sent to +91${phone} | SID: ${message.sid}`);
}

// ─────────────────────────────────────────
// POST /api/doctor-auth/send-otp
// Body: { "phone": "6380085913" }
// ─────────────────────────────────────────
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }

    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length !== 10) {
      return res.status(400).json({ success: false, error: "Invalid phone number. Must be 10 digits." });
    }

    // ── Rate limit: block if OTP sent in last 60 seconds ──
    const recent = await OtpVerification.findOne({ phone: normalizedPhone })
      .sort({ created_at: -1 })
      .lean();

    if (recent && (Date.now() - new Date(recent.created_at).getTime()) < 60 * 1000) {
      return res.status(429).json({
        success: false,
        error: "OTP already sent. Please wait 60 seconds before retrying."
      });
    }

    // ── Generate + hash OTP ──
    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, 10);

    // ── Save to otp_verifications collection ──
    await OtpVerification.create({
      phone: normalizedPhone,
      otp_hash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),  // 10 min
      attempts: 0,
      verified: false
    });

    // ── Send SMS ──
    await sendOtpViaSMS(normalizedPhone, otp);

    return res.json({
      success: true,
      message: `OTP sent to +91${normalizedPhone}`,
      ...(process.env.NODE_ENV === "development" && { _devOtp: otp })
    });

  } catch (err) {
    console.error("Send OTP error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});


// ─────────────────────────────────────────
// POST /api/doctor-auth/resend-otp
// Body: { "phone": "6380085913" }
// ─────────────────────────────────────────
router.post("/resend-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }

    const normalizedPhone = normalizePhone(phone);

    // Must have an existing session
    const existing = await OtpVerification.findOne({ phone: normalizedPhone })
      .sort({ created_at: -1 })
      .lean();

    if (!existing) {
      return res.status(400).json({
        success: false,
        error: "No OTP session found. Please request a new OTP first."
      });
    }

    // Generate fresh OTP
    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, 10);

    // Delete old OTP docs for this phone, create fresh one
    await OtpVerification.deleteMany({ phone: normalizedPhone });
    await OtpVerification.create({
      phone: normalizedPhone,
      otp_hash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      verified: false
    });

    await sendOtpViaSMS(normalizedPhone, otp);

    return res.json({
      success: true,
      message: "OTP resent successfully",
      ...(process.env.NODE_ENV === "development" && { _devOtp: otp })
    });

  } catch (err) {
    console.error("Resend OTP error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to resend OTP" });
  }
});


// ─────────────────────────────────────────
// POST /api/doctor-auth/verify-otp
// Body: { "phone": "6380085913", "otp": "482951" }
//
// LOGIC:
//   OTP valid →
//     Doctor exists with this phone? → login, return existing doctor_id
//     Doctor not found?              → create new doc with new doctor_id
// ─────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);

    // ── Fetch latest OTP doc ──
    const otpDoc = await OtpVerification.findOne({ phone: normalizedPhone })
      .sort({ created_at: -1 });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        error: "OTP not found or expired. Please request a new one."
      });
    }

    // ── Expired? ──
    if (new Date() > otpDoc.expires_at) {
      await OtpVerification.deleteMany({ phone: normalizedPhone });
      return res.status(400).json({
        success: false,
        error: "OTP has expired. Please request a new one."
      });
    }

    // ── Too many attempts? ──
    if (otpDoc.attempts >= 3) {
      await OtpVerification.deleteMany({ phone: normalizedPhone });
      return res.status(429).json({
        success: false,
        error: "Too many wrong attempts. Please request a new OTP."
      });
    }

    // ── Validate OTP ──
    const isValid = await bcrypt.compare(otp, otpDoc.otp_hash);
    if (!isValid) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
        attemptsLeft: 3 - otpDoc.attempts
      });
    }

    // ── OTP valid — mark verified + clean up ──
    await OtpVerification.deleteMany({ phone: normalizedPhone });

    // ── CHECK: does this doctor already exist? ──
    let doctor = await Doctor.findOne({ phone_number: normalizedPhone });

    if (!doctor) {
      // ── FIRST TIME LOGIN — create one document, one doctor_id, forever ──
      const doctor_id = await generateDoctorId();
      doctor = await Doctor.create({
        doctor_id,
        phone_number: normalizedPhone,
        profile_complete: false
      });
      console.log(`🆕 New doctor created: ${doctor_id} for ${normalizedPhone}`);
    } else {
      // ── RETURNING DOCTOR — just update last_login ──
      doctor.last_login = new Date();
      await doctor.save();
      console.log(`🔄 Returning doctor login: ${doctor.doctor_id} for ${normalizedPhone}`);
    }

    // ── Issue JWT ──
    // ── Issue JWT ──

    const token = jwt.sign(
      {
        id: doctor._id,
        doctor_id: doctor.doctor_id,
        phone: doctor.phone_number,
        name: doctor.name,
        role: doctor.role || "doctor"
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    
    res.cookie("doctorToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 30 * 24 * 60 * 60 * 1000   // 30 days in ms
    });
    
    
        return res.json({
          success: true,
          message: "Login successful",
          token,
          is_new_doctor: !doctor.profile_complete,   // frontend can redirect to profile setup
          doctor: {
            id: doctor._id,
            doctor_id: doctor.doctor_id,
            phone: doctor.phone_number,
            name: doctor.name,
            role: doctor.role,
            profile_complete: doctor.profile_complete,
            conditions_treated: doctor.conditions_treated,
            languages: doctor.languages,
            availability: doctor.availability,
            session_pricing: doctor.session_pricing
          }
        });
    
      } catch (err) {
        console.error("Verify OTP error:", err.message);
        return res.status(500).json({ success: false, error: "Verification failed" });
      }
    });


// ─────────────────────────────────────────
// POST /api/doctor-auth/logout
// ─────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie("doctorToken");
  return res.json({ success: true, message: "Logged out" });
});


// ─────────────────────────────────────────
// MIDDLEWARE: protect doctor routes
// Usage: const { verifyDoctorToken } = require("./doctorOtpAuth");
//        router.get("/profile", verifyDoctorToken, handler)
// ─────────────────────────────────────────
function verifyDoctorToken(req, res, next) {
  const token =
    req.cookies?.doctorToken ||
    req.headers?.authorization?.replace("Bearer ", "");
    req.query?.token;          // ← ADD THIS LINE


  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.doctor = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}


// POST /api/doctor-auth/complete-profile
// router.post("/complete-profile", verifyDoctorToken, async (req, res) => {
//   try {
//     const { name, role, conditions_treated, languages, availability, session_pricing } = req.body;

//     const doctor = await Doctor.findOneAndUpdate(
//       { phone_number: req.doctor.phone },
//       {
//         name,
//         role,
//         conditions_treated,
//         languages,
//         availability,
//         session_pricing,
//         profile_complete: true
//       },
//       { new: true }
//     );

//     if (!doctor) {
//       return res.status(404).json({ success: false, error: "Doctor not found" });
//     }

//     return res.json({
//       success: true,
//       message: "Profile updated successfully",
//       doctor: {
//         id: doctor._id,
//         doctor_id: doctor.doctor_id,
//         phone: doctor.phone_number,
//         name: doctor.name,
//         role: doctor.role,
//         profile_complete: doctor.profile_complete,
//         conditions_treated: doctor.conditions_treated,
//         languages: doctor.languages,
//         availability: doctor.availability,
//         session_pricing: doctor.session_pricing
//       }
//     });

//   } catch (err) {
//     console.error("Complete profile error:", err.message);
//     return res.status(500).json({ success: false, error: "Failed to update profile" });
//   }
// });
// router.post("/complete-profile", verifyDoctorToken, async (req, res) => {
//   try {
//     const { name, role, conditions_treated, languages, availability, session_pricing } = req.body;

//     const fieldsToSet = {
//       name,
//       role,
//       conditions_treated,
//       languages,
//       availability,
//       session_pricing,
//       profile_complete: true
//     };

//     // Compute verified_profile based on what's being saved
//     fieldsToSet.verified_profile = isProfileVerified(fieldsToSet);

//     const doctor = await Doctor.findOneAndUpdate(
//       { phone_number: req.doctor.phone },
//       { $set: fieldsToSet },
//       { new: true }
//     );

//     if (!doctor) {
//       return res.status(404).json({ success: false, error: "Doctor not found" });
//     }

//     return res.json({
//       success: true,
//       message: "Profile updated successfully",
//       doctor: {
//         id: doctor._id,
//         doctor_id: doctor.doctor_id,
//         phone: doctor.phone_number,
//         name: doctor.name,
//         role: doctor.role,
//         profile_complete: doctor.profile_complete,
//         verified_profile: doctor.verified_profile,
//         conditions_treated: doctor.conditions_treated,
//         languages: doctor.languages,
//         availability: doctor.availability,
//         session_pricing: doctor.session_pricing
//       }
//     });

//   } catch (err) {
//     console.error("Complete profile error:", err.message);
//     return res.status(500).json({ success: false, error: "Failed to update profile" });
//   }
// });

// ─────────────────────────────────────────
// POST /api/doctor-auth/complete-profile
// Content-Type: multipart/form-data
// Fields: name, role, conditions_treated (JSON string), languages (JSON string),
//         availability (JSON string), session_pricing, years_of_experience
// File:   profile_image (optional)
// ─────────────────────────────────────────
router.post(
  "/complete-profile",
  verifyDoctorToken,
  upload.single("profile_image"),
  async (req, res) => {
    try {
      const {
        name,
        role,
        session_pricing,
        years_of_experience
      } = req.body;

      // ── Parse JSON-stringified array/object fields (sent via multipart) ──
      let conditions_treated, languages, availability;
      try {
        conditions_treated = req.body.conditions_treated
          ? JSON.parse(req.body.conditions_treated)
          : [];
        languages = req.body.languages
          ? JSON.parse(req.body.languages)
          : [];
        availability = req.body.availability
          ? JSON.parse(req.body.availability)
          : {};
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          error: "Invalid JSON in conditions_treated, languages, or availability"
        });
      }

      // ── Upload profile image to Google Drive if provided ──
      let profile_image = undefined; // undefined = don't overwrite if not sent

      if (req.file && req.file.buffer) {
        const filename = `doctor_profile_${Date.now()}_${req.file.originalname}`;
        const result = await uploadToDriveOAuth(
          req.file.buffer,
          filename,
          req.file.mimetype
        );
        profile_image =
          result?.webViewLink ||
          (result?.id
            ? `https://drive.google.com/file/d/${result.id}/view`
            : null);
      }

      // ── Build fields to save ──
      const fieldsToSet = {
        name,
        role,
        conditions_treated,
        languages,
        availability,
        session_pricing,
        years_of_experience,
        profile_complete: true
      };

      // Only set profile_image if a file was actually uploaded
      if (profile_image !== undefined) {
        fieldsToSet.profile_image = profile_image;
      }

      // ── Compute verified_profile ──
      fieldsToSet.verified_profile = false;

      const doctor = await Doctor.findOneAndUpdate(
        { phone_number: req.doctor.phone },
        { $set: fieldsToSet },
        { new: true }
      );

      if (!doctor) {
        return res.status(404).json({ success: false, error: "Doctor not found" });
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
          profile_image: doctor.profile_image,
          profile_complete: doctor.profile_complete,
          verified_profile: doctor.verified_profile,
          conditions_treated: doctor.conditions_treated,
          languages: doctor.languages,
          availability: doctor.availability,
          session_pricing: doctor.session_pricing
        }
      });

    } catch (err) {
      console.error("Complete profile error:", err.message);
      return res.status(500).json({ success: false, error: "Failed to update profile" });
    }
  }
);


// ─────────────────────────────────────────
// PATCH /api/doctor-auth/update-profile
// Updates doctor profile fields (partial update supported)
// Requires: Bearer token in Authorization header
// Body: any subset of { name, role, conditions_treated, languages, availability, session_pricing }
// ─────────────────────────────────────────
// router.patch("/update-profile", verifyDoctorToken, async (req, res) => {
//   try {
//     const { name, role, conditions_treated, languages, availability, session_pricing } = req.body;

//     // Build update object — only include fields that were actually sent
//     const updates = {};
//     if (name !== undefined)               updates.name = name;
//     if (role !== undefined)               updates.role = role;
//     if (conditions_treated !== undefined) updates.conditions_treated = conditions_treated;
//     if (languages !== undefined)          updates.languages = languages;
//     if (availability !== undefined)       updates.availability = availability;
//     if (session_pricing !== undefined)    updates.session_pricing = session_pricing;

//     if (Object.keys(updates).length === 0) {
//       return res.status(400).json({ success: false, error: "No fields provided to update" });
//     }

//     const doctor = await Doctor.findOneAndUpdate(
//       { phone_number: req.doctor.phone },
//       { $set: updates },
//       { new: true, runValidators: true }
//     );

//     if (!doctor) {
//       return res.status(404).json({ success: false, error: "Doctor not found" });
//     }

//     return res.json({
//       success: true,
//       message: "Profile updated successfully",
//       doctor: {
//         id: doctor._id,
//         doctor_id: doctor.doctor_id,
//         phone: doctor.phone_number,
//         name: doctor.name,
//         role: doctor.role,
//         profile_complete: doctor.profile_complete,
//         conditions_treated: doctor.conditions_treated,
//         languages: doctor.languages,
//         availability: doctor.availability,
//         session_pricing: doctor.session_pricing
//       }
//     });

//   } catch (err) {
//     console.error("Update profile error:", err.message);
//     return res.status(500).json({ success: false, error: "Failed to update profile" });
//   }
// });

// router.patch("/update-profile", verifyDoctorToken, async (req, res) => {
//   try {
//     const { name, role, conditions_treated, languages, availability, session_pricing } = req.body;

//     // Build update object — only include fields that were actually sent
//     const updates = {};
//     if (name !== undefined)               updates.name = name;
//     if (role !== undefined)               updates.role = role;
//     if (conditions_treated !== undefined) updates.conditions_treated = conditions_treated;
//     if (languages !== undefined)          updates.languages = languages;
//     if (availability !== undefined)       updates.availability = availability;
//     if (session_pricing !== undefined)    updates.session_pricing = session_pricing;

//     if (Object.keys(updates).length === 0) {
//       return res.status(400).json({ success: false, error: "No fields provided to update" });
//     }

//     // Apply partial updates first, then fetch the full doc to evaluate verified_profile
//     // We use findOneAndUpdate with new:true so we get the merged result
//     const doctor = await Doctor.findOneAndUpdate(
//       { phone_number: req.doctor.phone },
//       { $set: updates },
//       { new: true, runValidators: true }
//     );

//     if (!doctor) {
//       return res.status(404).json({ success: false, error: "Doctor not found" });
//     }

//     // ── Recompute verified_profile against the full merged document ──
//     // This handles both "now complete" and "something was cleared" cases
//     const shouldBeVerified = isProfileVerified(doctor);

//     if (doctor.verified_profile !== shouldBeVerified) {
//       doctor.verified_profile = shouldBeVerified;
//       await doctor.save();
//     }

//     return res.json({
//       success: true,
//       message: "Profile updated successfully",
//       doctor: {
//         id: doctor._id,
//         doctor_id: doctor.doctor_id,
//         phone: doctor.phone_number,
//         name: doctor.name,
//         role: doctor.role,
//         profile_complete: doctor.profile_complete,
//         verified_profile: doctor.verified_profile,
//         conditions_treated: doctor.conditions_treated,
//         languages: doctor.languages,
//         availability: doctor.availability,
//         session_pricing: doctor.session_pricing
//       }
//     });

//   } catch (err) {
//     console.error("Update profile error:", err.message);
//     return res.status(500).json({ success: false, error: "Failed to update profile" });
//   }
// });


// ─────────────────────────────────────────
// PATCH /api/doctor-auth/update-profile
// Content-Type: multipart/form-data
// Body: any subset of profile fields
// File: profile_image (optional — replaces existing if sent)
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// PATCH /api/doctor-auth/update-profile
// Content-Type: multipart/form-data
// Body: any subset of profile fields
// Files: profile_image (optional), voice_note (optional)
// ─────────────────────────────────────────
// router.patch(
//   "/update-profile",
//   verifyDoctorToken,
//   upload.fields([
//     { name: "profile_image", maxCount: 1 },
//     { name: "voice_note",    maxCount: 1 }
//   ]),
//   async (req, res) => {
//     try {
//       const { name, role, session_pricing, years_of_experience } = req.body;

//       // ── Build partial update object ──
//       const updates = {};
//       if (name !== undefined)                updates.name = name;
//       if (role !== undefined)                updates.role = role;
//       if (session_pricing !== undefined)     updates.session_pricing = session_pricing;
//       if (years_of_experience !== undefined) updates.years_of_experience = years_of_experience;

//       // ── Parse JSON fields only if present in body ──
//       if (req.body.conditions_treated !== undefined) {
//         try { updates.conditions_treated = JSON.parse(req.body.conditions_treated); }
//         catch { return res.status(400).json({ success: false, error: "Invalid JSON in conditions_treated" }); }
//       }
//       if (req.body.languages !== undefined) {
//         try { updates.languages = JSON.parse(req.body.languages); }
//         catch { return res.status(400).json({ success: false, error: "Invalid JSON in languages" }); }
//       }
//       if (req.body.availability !== undefined) {
//         try { updates.availability = JSON.parse(req.body.availability); }
//         catch { return res.status(400).json({ success: false, error: "Invalid JSON in availability" }); }
//       }

//       // ── Upload profile image if provided ──
//       const profileImageFile = req.files?.profile_image?.[0];
//       if (profileImageFile) {
//         const filename = `doctor_profile_${Date.now()}_${profileImageFile.originalname}`;
//         const result = await uploadToDriveOAuth(
//           profileImageFile.buffer,
//           filename,
//           profileImageFile.mimetype
//         );
//         updates.profile_image =
//           result?.webViewLink ||
//           (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
//       }

//       // ── Upload voice note if provided ──
//       const voiceNoteFile = req.files?.voice_note?.[0];
//       if (voiceNoteFile) {
//         const allowedAudio = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"];
//         if (!allowedAudio.includes(voiceNoteFile.mimetype)) {
//           return res.status(400).json({
//             success: false,
//             error: "Invalid audio format. Allowed: mp3, mp4, webm, ogg, wav, m4a"
//           });
//         }
//         const filename = `doctor_voice_${Date.now()}_${voiceNoteFile.originalname}`;
//         const result = await uploadToDriveOAuth(
//           voiceNoteFile.buffer,
//           filename,
//           voiceNoteFile.mimetype
//         );
//         updates.voice_note =
//           result?.webViewLink ||
//           (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
//       }

//       if (Object.keys(updates).length === 0) {
//         return res.status(400).json({ success: false, error: "No fields provided to update" });
//       }

//       const doctor = await Doctor.findOneAndUpdate(
//         { phone_number: req.doctor.phone },
//         { $set: updates },
//         { new: true, runValidators: true }
//       );

//       if (!doctor) {
//         return res.status(404).json({ success: false, error: "Doctor not found" });
//       }

//       // ── Recompute verified_profile on full merged document ──
// const isNowComplete = isProfileVerified(doctor);
// if (doctor.profile_complete !== isNowComplete) {
//   doctor.profile_complete = isNowComplete;
//   await doctor.save();
// }

//       return res.json({
//         success: true,
//         message: "Profile updated successfully",
//         doctor: {
//           id: doctor._id,
//           doctor_id: doctor.doctor_id,
//           phone: doctor.phone_number,
//           name: doctor.name,
//           role: doctor.role,
//           years_of_experience: doctor.years_of_experience,
//           profile_image: doctor.profile_image,
//           voice_note: doctor.voice_note,
//           profile_complete: doctor.profile_complete,
//           verified_profile: doctor.verified_profile,
//           conditions_treated: doctor.conditions_treated,
//           languages: doctor.languages,
//           availability: doctor.availability,
//           session_pricing: doctor.session_pricing
//         }
//       });

//     } catch (err) {
//       console.error("Update profile error:", err.message);
//       return res.status(500).json({ success: false, error: "Failed to update profile" });
//     }
//   }
// );

// ─────────────────────────────────────────
// PATCH /api/doctor-auth/update-profile
// Content-Type: multipart/form-data
// Body: any subset of profile fields
// Files: profile_image (optional → S3), voice_note (optional → Google Drive)
// ─────────────────────────────────────────
router.patch(
  "/update-profile",
  verifyDoctorToken,
  upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "voice_note",    maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { name, role, session_pricing, years_of_experience } = req.body;

      // ── Build partial update object ──
      const updates = {};
      if (name !== undefined)                updates.name = name;
      if (role !== undefined)                updates.role = role;
      if (session_pricing !== undefined)     updates.session_pricing = session_pricing;
      if (years_of_experience !== undefined) updates.years_of_experience = years_of_experience;

      // ── Parse JSON fields only if present in body ──
      if (req.body.conditions_treated !== undefined) {
        try { updates.conditions_treated = JSON.parse(req.body.conditions_treated); }
        catch { return res.status(400).json({ success: false, error: "Invalid JSON in conditions_treated" }); }
      }
      if (req.body.languages !== undefined) {
        try { updates.languages = JSON.parse(req.body.languages); }
        catch { return res.status(400).json({ success: false, error: "Invalid JSON in languages" }); }
      }
      if (req.body.availability !== undefined) {
        try { updates.availability = JSON.parse(req.body.availability); }
        catch { return res.status(400).json({ success: false, error: "Invalid JSON in availability" }); }
      }

      // ── Upload profile image to S3 ──
      const profileImageFile = req.files?.profile_image?.[0];
      if (profileImageFile) {
        const filename = `doctor_profile_${Date.now()}_${profileImageFile.originalname}`;
        updates.profile_image = await uploadToS3(
          profileImageFile.buffer,
          filename,
          profileImageFile.mimetype
        );
      }

      // ── Upload voice note to Google Drive (unchanged) ──
      const voiceNoteFile = req.files?.voice_note?.[0];
      if (voiceNoteFile) {
        const allowedAudio = ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"];
        if (!allowedAudio.includes(voiceNoteFile.mimetype)) {
          return res.status(400).json({
            success: false,
            error: "Invalid audio format. Allowed: mp3, mp4, webm, ogg, wav, m4a"
          });
        }
        const filename = `doctor_voice_${Date.now()}_${voiceNoteFile.originalname}`;
        const result = await uploadToDriveOAuth(
          voiceNoteFile.buffer,
          filename,
          voiceNoteFile.mimetype
        );
        updates.voice_note =
          result?.webViewLink ||
          (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: "No fields provided to update" });
      }

      const doctor = await Doctor.findOneAndUpdate(
        { phone_number: req.doctor.phone },
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!doctor) {
        return res.status(404).json({ success: false, error: "Doctor not found" });
      }

      // ── Recompute profile_complete on full merged document ──
      const isNowComplete = isProfileVerified(doctor);
      if (doctor.profile_complete !== isNowComplete) {
        doctor.profile_complete = isNowComplete;
        await doctor.save();
      }

      return res.json({
        success: true,
        message: "Profile updated successfully",
        doctor: {
          id:                  doctor._id,
          doctor_id:           doctor.doctor_id,
          phone:               doctor.phone_number,
          name:                doctor.name,
          role:                doctor.role,
          years_of_experience: doctor.years_of_experience,
          profile_image:       doctor.profile_image,
          voice_note:          doctor.voice_note,
          profile_complete:    doctor.profile_complete,
          verified_profile:    doctor.verified_profile,
          conditions_treated:  doctor.conditions_treated,
          languages:           doctor.languages,
          availability:        doctor.availability,
          session_pricing:     doctor.session_pricing
        }
      });

    } catch (err) {
      console.error("Update profile error:", err.message);
      return res.status(500).json({ success: false, error: "Failed to update profile" });
    }
  }
);

// ─────────────────────────────────────────
// GET /api/doctor-auth/profile
// Returns logged-in doctor's profile
// Requires: Bearer token in Authorization header
// ─────────────────────────────────────────
router.get("/profile", verifyDoctorToken, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ phone_number: req.doctor.phone }).lean();

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
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
        profile_image: doctor.profile_image,
        voice_note: doctor.voice_note,          // ← add this
        profile_complete: doctor.profile_complete,
        verified_profile: doctor.verified_profile,
        conditions_treated: doctor.conditions_treated,
        languages: doctor.languages,
        availability: doctor.availability,
        session_pricing: doctor.session_pricing,
        created_at: doctor.created_at,
        last_login: doctor.last_login
      }
    });

  } catch (err) {
    console.error("Get profile error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch profile" });
  }
});


// ─────────────────────────────────────────
// GET /api/doctor-auth/public/doctors
// Public route — no token required
// Returns all doctors with profile_complete: true
// ─────────────────────────────────────────
router.get("/public/doctors", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "12", 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();

    const filter = { verified_profile: true };

    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: regex },
        { role: regex },
        { conditions_treated: regex },
        { languages: regex }
      ];
    }

      // ── NEW: condition-based match (e.g. from the pain assistant) ──
      if (req.query.condition) {
        const condRegex = new RegExp(
          req.query.condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
        filter.conditions_treated = condRegex;
      }

    const [doctors, total] = await Promise.all([
      Doctor.find(filter)
      .select("doctor_id name role qualification registration_no conditions_treated languages availability session_pricing single_session_price single_session_price_usd packages packages_usd years_of_experience profile_image voice_note sessions_completed")
      .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Doctor.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: doctors,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error("Public doctors list error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch doctors" });
  }
});


// GET /api/doctor-auth/appointments?status=confirmed
// GET /api/doctor-auth/appointments?status=pending_payment
// GET /api/doctor-auth/appointments  (all statuses)
// Requires: Bearer token


// GET /api/doctor-auth/admin/doctors
router.get("/admin/doctors", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit = Math.min(50, parseInt(req.query.limit || "20", 10));
    const skip  = (page - 1) * limit;
    const q     = (req.query.q || "").trim();
 
    const filter = {};
    if (req.query.verified === "true")  filter.verified_profile = true;
    if (req.query.verified === "false") filter.verified_profile = false;
 
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: regex },
        { role: regex },
        { phone_number: regex },
        { doctor_id: regex },
      ];
    }
 
    const [doctors, total] = await Promise.all([
      Doctor.find(filter)
    .select(
  "doctor_id name role phone_number years_of_experience " +
  "profile_image voice_note conditions_treated languages " +
  "availability session_pricing single_session_price single_session_price_usd packages packages_usd " +
  "profile_complete verified_profile " +
  "created_at last_login"
)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Doctor.countDocuments(filter),
    ]);
 
    return res.json({
      success: true,
      data: doctors,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Admin doctors list error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch doctors" });
  }
});
 
 
// PATCH /api/doctor-auth/admin/doctors/:doctorId/approve
router.patch("/admin/doctors/:doctorId/approve", async (req, res) => {
  try {
    const { doctorId } = req.params;
    const approved = req.body.approved === true || req.body.approved === "true";
 
    const doctor = await Doctor.findOneAndUpdate(
      { doctor_id: doctorId },
      { $set: { verified_profile: approved } },
      { new: true }
    );
 
    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }
 
    return res.json({
      success: true,
      message: approved
        ? `Dr. ${doctor.name || doctorId} approved successfully`
        : `Dr. ${doctor.name || doctorId} approval revoked`,
      doctor: {
        id:               doctor._id,
        doctor_id:        doctor.doctor_id,
        name:             doctor.name,
        verified_profile: doctor.verified_profile,
        profile_complete: doctor.profile_complete,
      },
    });
  } catch (err) {
    console.error("Doctor approve error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to update approval status" });
  }
});
 
// ─────────────────────────────────────────
// PATCH /api/doctor-auth/admin/doctors/:doctorId
// Admin can edit any doctor field before/after approval
// No auth required (add admin middleware if needed)
// ─────────────────────────────────────────
router.patch("/admin/doctors/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;
    const {
      name,
      role,
      session_pricing,
      single_session_price,        // ← add
      single_session_price_usd,    // ← add

      years_of_experience,
      conditions_treated,
      languages,
      availability,
      packages,
      packages_usd,                 // ← add

    } = req.body;

    const updates = {};
    if (name               !== undefined) updates.name               = name;
    if (role               !== undefined) updates.role               = role;
    if (session_pricing    !== undefined) updates.session_pricing    = session_pricing;
    if (single_session_price  !== undefined) updates.single_session_price  = single_session_price;   // ← add
    if (single_session_price_usd  !== undefined) updates.single_session_price_usd  = single_session_price_usd;  // ← add

    if (years_of_experience !== undefined) updates.years_of_experience = years_of_experience;
    if (conditions_treated !== undefined) updates.conditions_treated = conditions_treated;
    if (languages          !== undefined) updates.languages          = languages;
    if (availability       !== undefined) updates.availability       = availability;
    if (packages            !== undefined) updates.packages            = packages;   // ← add this
    if (packages_usd              !== undefined) updates.packages_usd              = packages_usd;              // ← add


    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: "No fields provided to update" });
    }

    const doctor = await Doctor.findOneAndUpdate(
      { doctor_id: doctorId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    // Recompute profile_complete after admin edit
    const isNowComplete = isProfileVerified(doctor);
    if (doctor.profile_complete !== isNowComplete) {
      doctor.profile_complete = isNowComplete;
      await doctor.save();
    }

    return res.json({
      success: true,
      message: `Dr. ${doctor.name || doctorId} updated successfully`,
      doctor: {
        id:                  doctor._id,
        doctor_id:           doctor.doctor_id,
        name:                doctor.name,
        role:                doctor.role,
        years_of_experience: doctor.years_of_experience,
        profile_image:       doctor.profile_image,
        voice_note:          doctor.voice_note,
        profile_complete:    doctor.profile_complete,
        verified_profile:    doctor.verified_profile,
        conditions_treated:  doctor.conditions_treated,
        languages:           doctor.languages,
        availability:        doctor.availability,
        session_pricing:     doctor.session_pricing,
        single_session_price:  doctor.single_session_price,   // ← add
        single_session_price_usd: doctor.single_session_price_usd,   // ← add

        packages:              doctor.packages,               // ← add
        packages_usd:              doctor.packages_usd,                // ← add



      },
    });
  } catch (err) {
    console.error("Admin edit doctor error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to update doctor" });
  }
});

// GET /api/doctor-auth/public/doctors/:id
router.get("/public/doctors/:id", async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id)
      .select(   "doctor_id name role phone_number years_of_experience " +
      "profile_image voice_note conditions_treated languages " +
      "availability session_pricing single_session_price single_session_price_usd " +
      "packages packages_usd " +                                    // ← add packages_usd
      "profile_complete verified_profile " +
      "created_at last_login")
      .lean();

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    return res.json({ success: true, data: doctor });
  } catch (err) {
    console.error("Get doctor by id error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch doctor" });
  }
});


router.get("/public/doctors/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const doctors = await Doctor.find({ verified_profile: true })
      .select(
        "doctor_id name role qualification registration_no conditions_treated languages availability " +
        "session_pricing single_session_price single_session_price_usd " +
        "packages packages_usd years_of_experience profile_image voice_note " +
        "sessions_completed slug"
      )
      .lean();

    const doctor = doctors.find((d) =>
      d.slug ? d.slug === slug : slugify(d.name) === slug
    );

    if (!doctor) {
      return res.status(404).json({ success: false, error: "Doctor not found" });
    }

    return res.json({ success: true, data: doctor });
  } catch (err) {
    console.error("Get doctor by slug error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch doctor" });
  }
});


module.exports = router;
module.exports.verifyDoctorToken = verifyDoctorToken;


// ─────────────────────────────────────────
// FILE STRUCTURE:
//
//   models/
//     OtpVerification.js   ← stores hashed OTP per phone
//     Doctor.js            ← one doc per doctor, permanent doctor_id
//   routes/
//     doctorOtpAuth.js     ← this file
//
// .env required:
//   FAST2SMS_API_KEY=your_key
//   JWT_SECRET=any_long_random_string
//   NODE_ENV=development
// ─────────────────────────────────────────


