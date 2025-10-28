// routes/concernRoutes.js
const express = require("express");
const router = express.Router();
const Concern = require("../models/Concern");

// GET all concerns
router.get("/", async (req, res) => {
  try {
    const concerns = await Concern.find({}, { _id: 1, concern: 1 }); // only _id and concern
    res.json(concerns);
  } catch (err) {
    console.error("Error fetching concerns:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
