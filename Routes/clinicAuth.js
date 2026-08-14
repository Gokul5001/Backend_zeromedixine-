// routes/clinicAuth.js
const express = require("express");
const router = express.Router();
const ClinicCredentials = require("../models/ClinicCredentials");
const Clinic = require("../Models/Clinic"); // adjust path if needed
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { loginRateLimiter } = require("../middleware/rateLimit");
const { authenticateToken, requireRole } = require("../middleware/auth");


const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}


// Register clinic
router.post("/register", async (req, res) => {
  try {
    const { clinic_name, username, password } = req.body || {};
    if (!clinic_name || !username || !password) {
      return res.status(400).json({ success: false, message: "clinic_name, username and password required" });
    }

    const raw = String(username).trim();
    // check uniqueness (case-insensitive for username/email)
    const existing = await LoginCredential.findOne({
      $or: [
        { username: new RegExp(`^${raw}$`, "i") },
        { email: new RegExp(`^${raw}$`, "i") },
        { mobile_no: raw }
      ]
    }).lean();

    if (existing) {
      return res.status(409).json({ success: false, message: "Username/email/mobile already in use" });
    }

    const hash = await bcrypt.hash(password, 12);

    const doc = new LoginCredential({
      username: raw,
      password: hash,
      role: "clinic",
      clinic_name: clinic_name.trim(),
    });

    await doc.save();

    // create token and set cookie
    const payload = { id: doc._id.toString(), role: "clinic", username: raw };
    const token = createToken(payload);
    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
        });

    const safeUser = {
      _id: doc._id,
      username: raw,
      role: "clinic",
      clinic_name: doc.clinic_name,
    };

    return res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Clinic register error:", err);
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
});



router.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "username and password required" });
    }

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1️⃣ Find credential (single OR multi)
    const cred = await ClinicCredentials.findOne({
      username: { $regex: new RegExp(`^${esc}$`, "i") },
    }).lean();

    if (!cred) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    // 2️⃣ Password check
    const ok = await bcrypt.compare(password, cred.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    // 3️⃣ Resolve ACTIVE clinicId
    let clinicId = null;

    if (cred.clinic) {
      // 🔹 Old single-clinic login
      clinicId = cred.clinic;
    } else if (Array.isArray(cred.clinics) && cred.clinics.length > 0) {
      // 🔹 New multi-branch login
      clinicId = cred.clinics[0]; // fallback → first clinic
    }

    if (!clinicId) {
      return res.status(403).json({ success: false, message: "No clinic assigned to this login" });
    }

    // 4️⃣ Fetch clinic
    const clinic = await Clinic.findById(clinicId).lean();
    if (!clinic) {
      return res.status(404).json({ success: false, message: "Clinic not found" });
    }

    // 5️⃣ JWT (IMPORTANT)
    const payload = {
      id: clinic._id.toString(), // 🔥 ACTIVE clinic
      role: "clinic",
      username: cred.username,
      ownerRole: cred.role // useful later
    };

    const token = createToken(payload);

    const decoded = jwt.decode(token); // decode without verifying
const expiresAt = decoded.exp * 1000; // convert to milliseconds

const now = Date.now();
const remainingMs = expiresAt - now;

const expiresInSeconds = Math.floor(remainingMs / 1000);
const expiresInDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
        });

    // 6️⃣ Response
    return res.json({
      success: true,
      access_token: token,
      expires_at: expiresAt,          // exact timestamp
      expires_in_seconds: expiresInSeconds, // remaining seconds
      expires_in_days: expiresInDays, // remaining days
      user: {
        _id: clinic._id,
        clinic_name: clinic.clinicName,
        username: cred.username,
        role: "clinic",
        ownerRole: cred.role,
        email: clinic.email || null,
        mobile_no: clinic.clinicNumber || clinic.ownerNumber || null
      }
    });

  } catch (err) {
    console.error("Clinic login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
});



// Logout
router.post("/logout", (req, res) => {
  res.clearCookie("access_token", { httpOnly: true, sameSite: "lax" });
  res.json({ success: true });
});


// router.get("/me", authenticateToken, requireRole("clinic"), async (req, res) => {
//     try {
//       const clinicId = req.user?.id;
//       if (!clinicId) return res.status(401).json({ success: false, message: "Not authenticated" });
  
//       const clinic = await LoginCredential.findById(clinicId)
//         .select("-password -__v") // never send password
//         .lean();
  
//       if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });
  
//       // Normalize response shape for frontend convenience
//       const safe = {
//         _id: clinic._id,
//         username: clinic.username || clinic.user || clinic.user_name || null,
//         clinic_name: clinic.clinic_name || clinic.organization || null,
//         email: clinic.email || null,
//         mobile_no: clinic.mobile_no || null,
//         role: clinic.role || "clinic",
//         createdAt: clinic.createdAt,
//         updatedAt: clinic.updatedAt,
//       };
  
//       return res.json({ success: true, user: safe });
//     } catch (err) {
//       console.error("GET /api/clinics/auth/me error:", err);
//       return res.status(500).json({ success: false, message: "Server error" });
//     }
//   });

router.get("/me", authenticateToken, requireRole("clinic"), async (req, res) => {
  try {
    const clinicId = req.user?.id;
    if (!clinicId) return res.status(401).json({ success: false, message: "Not authenticated" });

    // find clinic
    const clinic = await Clinic.findById(clinicId).lean();
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

    // find username from ClinicCredentials (if exists)
    const cred = await ClinicCredentials.findOne({ clinic: clinic._id }).lean();

    const safe = {
      _id: clinic._id,
      username: cred ? cred.username : null,
      clinic_name: clinic.clinicName || clinic.name || null,
      email: clinic.email || null,
      mobile_no: clinic.clinicNumber || clinic.ownerNumber || null,
      role: "clinic",
      createdAt: clinic.createdAt,
      updatedAt: clinic.updatedAt,
      address:clinic.address,
    };

    return res.json({ success: true, user: safe });
  } catch (err) {
    console.error("GET /api/clinics/auth/me error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


module.exports = router;