const express = require("express");
const router = express.Router();
const Clinic = require("../Models/Clinic");

router.get("/doctor/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const doctor = await Clinic.findOne(
      { redirect_path: slug, status: "active" },
      {
        clinicName: 1,
        Chief_doctor: 1,
        Role: 1,
        profile_img: 1,
        consult_fee: 1,
        address: 1,
        clinic_timing: 1,
        about_doctor: 1,
        registrationNumber: 1,
        clinicNumber: 1,
        ownerNumber:1
      }
    ).lean();

    if (!doctor) {
      return res.status(404).json({ success: false });
    }

    res.json({ success: true, doctor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});



module.exports = router;
