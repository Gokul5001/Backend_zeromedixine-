const express = require("express");
const router = express.Router();
const State = require("../Models/State");
const mongoose = require("mongoose");
const Clinic = require("../Models/Clinic"); // adjust path if needed
const District = require("../Models/District");

router.get("/", async (req, res) => {
  try {
    const states = await State.find({})
      .populate({
        path: "districts",
        model: "District",
        select: "_id name",
        options: { sort: { name: 1 } }
      })
      .select("_id name districts")
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      count: states.length,
      states
    });
  } catch (err) {
    console.error("Error fetching states:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch states"
    });
  }
});


router.get("/district/:districtId", async (req, res) => {
  try {
    const { districtId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(districtId)) {
      return res.status(400).json({ success: false });
    }

    const clinics = await Clinic.find(
      {
        district: districtId,
        status: "active"
      },
      {
        clinicName: 1,
        Chief_doctor: 1,
        profile_img: 1,
        consult_fee: 1,
        address: 1,
        clinic_timing: 1,
        ownerNumber:1,
        redirect_path: 1
      }
    )
      .sort({ clinicName: 1 })
      .lean();

    res.json({ success: true, clinics });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});




// GET clinics by state (ONLY ACTIVE)

// GET clinics by state (PUBLIC SAFE DATA ONLY)
router.get("/:stateId", async (req, res) => {
  try {
    const { stateId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(stateId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid state id"
      });
    }

    const clinics = await Clinic.find(
      {
        state: new mongoose.Types.ObjectId(stateId),
        status: "active"
      },
      {
        // ✅ ONLY PUBLIC FIELDS
        clinicName: 1,
        Chief_doctor: 1,
        Role: 1,
        profile_img: 1,
        consult_fee: 1,
        clinicNumber: 1,
        ownerNumber:1,
        address: 1,
        locality: 1,
        pincode: 1,
        clinic_timing:1,
        redirect_path: 1,
        _id: 1 // optional but okay
      }
    )
      .sort({ clinicName: 1 })
      .lean();

    res.json({
      success: true,
      count: clinics.length,
      clinics
    });
  } catch (err) {
    console.error("Error fetching clinics by state:", err);
    res.status(500).json({
      success: false,
      message: "Server error fetching clinics"
    });

  }
});


router.get("/district-name/:districtId", async (req, res) => {
  try {
    const district = await District.findById(req.params.districtId)
      .select("name")
      .lean();

    if (!district) {
      return res.json({ success: false });
    }

    res.json({ success: true, name: district.name });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get("/by-name/:stateName", async (req, res) => {
  try {
    const stateName = req.params.stateName;

    const state = await State.findOne({
      name: new RegExp(`^${stateName}$`, "i")
    });

    if (!state) {
      return res.json({ success: false, message: "State not found" });
    }

    const clinics = await Clinic.find(
      {
        state: state._id,
        status: "active"
      },
      {
        clinicName: 1,
        Chief_doctor: 1,
        Role: 1,
        profile_img: 1,
        consult_fee: 1,
        clinicNumber: 1,
        ownerNumber: 1,
        address: 1,
        locality: 1,
        pincode: 1,
        clinic_timing: 1,
        redirect_path: 1,
        _id: 1
      }
    ).sort({ clinicName: 1 });

    res.json({
      success: true,
      state: state.name,
      clinics
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


router.get("/by-district-name/:stateName/:districtName", async (req, res) => {
  try {
    const { stateName, districtName } = req.params;

    // 1. Find state
    const state = await State.findOne({
      name: new RegExp(`^${stateName}$`, "i")
    });

    if (!state) {
      return res.json({ success: false });
    }

    // 2. Find district
    const district = await District.findOne({
      name: new RegExp(`^${districtName}$`, "i")
    });

    if (!district) {
      return res.json({ success: false });
    }

    // 3. Get clinics
    const clinics = await Clinic.find({
      state: state._id,
      district: district._id,
      status: "active"
    });

    res.json({
      success: true,
      state: state.name,
      district: district.name,
      clinics
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;








