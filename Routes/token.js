const express = require("express");
const jwt = require("jsonwebtoken");
const { authenticateToken } = require("../Middleware/auth");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_prod";

// POST /api/token/regenerate
router.post("/regenerate", authenticateToken, (req, res) => {
  try {
    const { id, role, username } = req.user;

    const newAccessToken = jwt.sign(
      { id, role, username },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.json({
      success: true,
      accessToken: newAccessToken
    });
  } catch (err) {
    console.error("Token regenerate error:", err);
    return res.status(500).json({ success: false, message: "Token regeneration failed" });
  }
});

module.exports = router;
