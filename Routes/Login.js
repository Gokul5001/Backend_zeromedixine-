// // Routes/Login.js
// const express = require("express");
// const router = express.Router();
// const mongoose = require("mongoose");
// const LoginCredential = require("../Models/LoginCredential"); // adjust path if Models vs models
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");

// router.post("/login", async (req, res) => {
//   try {
//     const { username, password } = req.body || {};
//     if (!username || !password) return res.status(400).json({ success: false, message: "username and password required" });

//     const raw = String(username).trim();
//     const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//     const query = {
//       $or: [
//         { username: { $regex: new RegExp(`^${esc}$`, "i") } },
//         { user: { $regex: new RegExp(`^${esc}$`, "i") } },
//         { user_name: { $regex: new RegExp(`^${esc}$`, "i") } },
//         { mobile_no: raw },
//         { email: { $regex: new RegExp(`^${esc}$`, "i") } }
//       ]
//     };

//     const user = await LoginCredential.findOne(query).lean();
//     if (!user) return res.status(401).json({ success: false, message: "Invalid username or password" });

//     const stored = user.password || "";
//     let passwordMatches = false;

//     // bcrypt hash detection
//     if (/^\$2[ayb]\$/.test(stored)) {
//       passwordMatches = await bcrypt.compare(password, stored);
//     } else {
//       // legacy plaintext fallback
//       passwordMatches = stored === password;
//       // if matches plaintext -> re-hash & update (migration)
//       if (passwordMatches) {
//         try {
//           const newHash = await bcrypt.hash(password, 12);
//           await LoginCredential.updateOne({ _id: user._id }, { $set: { password: newHash } });
//           console.log("Migrated password to bcrypt for user:", user._id);
//         } catch (e) {
//           console.warn("Password migration failed for", user._id, e);
//         }
//       }
//     }

//     if (!passwordMatches) return res.status(401).json({ success: false, message: "Invalid username or password" });

//     // sign token
//     let token = null;
//     if (process.env.JWT_SECRET) {
//       token = jwt.sign(
//         { id: user._id.toString(), username: user.username || user.user || user.user_name || null, role: user.role || "doctor" },
//         process.env.JWT_SECRET,
//         { expiresIn: process.env.JWT_EXPIRES || "8h" }
//       );
//     }

//     // set secure httpOnly cookie (frontend should call withCredentials: true)
//     if (token) {
//       res.cookie("access_token", token, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: "lax",
//         maxAge: 1000 * 60 * 60 * 8, // 8 hours
//       });
//     }

//     const safeUser = {
//       _id: user._id,
//       username: user.username || user.user || user.user_name || null,
//       email: user.email || null,
//       mobile_no: user.mobile_no || null,
//       role: user.role || "doctor",
//     };

//     return res.json({ success: true, user: safeUser, token: token || null });
//   } catch (err) {
//     console.error("Login error:", err);
//     return res.status(500).json({ success: false, message: "Server error during login" });
//   }
// });

// module.exports = router;
// Routes/Login.js
const express = require("express");
const router = express.Router();
const LoginCredential = require("../Models/LoginCredential");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { loginRateLimiter } = require("../middleware/rateLimit");


// Helpers
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// POST /api/admin/login
router.post("/login",loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: "username and password required" });

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      $or: [
        { username: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user_name: { $regex: new RegExp(`^${esc}$`, "i") } },
        { mobile_no: raw },
        { email: { $regex: new RegExp(`^${esc}$`, "i") } }
      ]
    };

    const user = await LoginCredential.findOne(query).lean();
    if (!user) return res.status(401).json({ success: false, message: "Invalid username or password" });

    const stored = user.password || "";
    let passwordMatches = false;

    // bcrypt hash detection
    if (/^\$2[ayb]\$/.test(stored)) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      // legacy plaintext fallback
      passwordMatches = stored === password;
      // if matches plaintext -> re-hash & update (migration)
      if (passwordMatches) {
        try {
          const newHash = await bcrypt.hash(password, 12);
          await LoginCredential.updateOne({ _id: user._id }, { $set: { password: newHash } });
          console.log("Migrated password to bcrypt for user:", user._id);
        } catch (e) {
          console.warn("Password migration failed for", user._id, e);
        }
      }
    }

    if (!passwordMatches) return res.status(401).json({ success: false, message: "Invalid username or password" });

    // build payload & sign token
    const payload = {
      id: user._id.toString(),
      username: user.username || user.user || user.user_name || null,
      role: user.role || "doctor",
    };

    let token = null;
    if (process.env.JWT_SECRET) {
      token = createToken(payload);
    }

    // set secure httpOnly cookie (frontend must use withCredentials: true)
    if (token) {
      res.cookie("access_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // require HTTPS in prod
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
      });
    }

    // return safe user only (do NOT return token)
    const safeUser = {
      _id: user._id,
      username: payload.username,
      email: user.email || null,
      mobile_no: user.mobile_no || null,
      role: payload.role,
    };

    return res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  res.clearCookie("access_token", { httpOnly: true, sameSite: "lax" });
  return res.json({ success: true, message: "Logged out" });
});

module.exports = router;
