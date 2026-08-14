// Routes/sessionRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Session = require("../Models/Session"); // Add this at the top



router.get("/", async (req, res) => {
  try {
    // disable browser caching for this response (prevent 304 usage)
    res.set("Cache-Control", "no-store, must-revalidate, max-age=0");
    // optional: disable ETag for this response only
    res.removeHeader("ETag");

    const { concern, active } = req.query;
    const coll = mongoose.connection.collection("Sessions");
    const q = {};

    if (typeof active !== "undefined") {
      q.active = String(active).toLowerCase() === "true";
    }
    if (concern && String(concern).trim()) {
      q.concern = { $regex: new RegExp(String(concern).trim(), "i") };
    }

    // include extra fields so we don't lose info
    const sessions = await coll
      .find(q, {
        projection: {
          package_name: 1,
          sessions_count: 1,
          price_inr: 1,
          price_usd: 1,
          price_abroad_inr: 1,
          includes_free_diet_months: 1,
          notes: 1,
          duration_weeks: 1,
          _id: 1,
        },
      })
      .sort({ price_inr: 1 })
      .toArray();

    // If you want auto-concatenation of diet-plan into package_name
    const out = sessions.map((s) => {
      const copy = { ...s };
      if (!copy.package_name) copy.package_name = "";
      if (copy.includes_free_diet_months && !/diet/i.test(copy.package_name)) {
        // append only if not already present
        const months = copy.includes_free_diet_months;
        copy.package_name = `${copy.package_name} — includes ${months} month${months > 1 ? "s" : ""} diet plan`;
      }
      return copy;
    });

    console.log(`sessions found: ${out.length} for query:`, q);
    return res.json({ success: true, count: out.length, sessions: out });
  } catch (err) {
    console.error("Error fetching sessions:", err);
    return res.status(500).json({ success: false, message: "Server error fetching sessions" });
  }
});



// ===========================
//  NEW: GET ALL DIET PACKAGES
// ===========================
router.get("/diet", async (req, res) => {
  try {
    // No caching (same as above)
    res.set("Cache-Control", "no-store, must-revalidate, max-age=0");
    res.removeHeader("ETag");

    const coll = mongoose.connection.collection("Sessions");

    // Fetch ONLY diet-related sessions
    const diet = await coll
      .find(
        {
          $or: [
            { concern: { $regex: /diet/i } },
            { package_type: { $regex: /diet/i } }
          ],
          active: true
        },
        {
          projection: {
            package_name: 1,
            months: 1,
            sessions_count: 1,
            price_inr: 1,
            price_usd: 1,
            price_abroad_inr: 1,
            notes: 1,
            active: 1,
            _id: 1,
          },
        }
      )
      .sort({ months: 1 })
      .toArray();

    return res.json({
      success: true,
      count: diet.length,
      diet_packages: diet
    });
  } catch (err) {
    console.error("Error fetching diet packages:", err);
    return res.status(500).json({ success: false, message: "Server error fetching diet packages" });
  }
});


// GET session by ID
router.get('/:id', async (req, res) => {
  const id = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid session ID" });
  }

  try {
    const session = await Session.findById(id).lean().exec();
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    console.log(">>> SESSION DATA:", session);
    return res.json({ success: true, session });
  } catch (err) {
    console.error("Fetch session error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});




router.get('/:id', async (req, res) => {
  const id = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid session ID" });
  }

  try {
    // Use the same approach as your other routes - direct collection access
    const coll = mongoose.connection.collection("Sessions");
    const session = await coll.findOne({ _id: new mongoose.Types.ObjectId(id) });
    
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    console.log(">>> SESSION DATA:", session);
    return res.json({ success: true, session });
  } catch (err) {
    console.error("Fetch session error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});





module.exports = router;
