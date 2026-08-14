// routes/doctorsRoute.js
// Add this to your existing clinicRoutes.js or as a separate route file
// Mount at: app.use('/api/doctors', doctorsRoute);
// OR add this GET handler inside your existing clinicRoutes.js

/**
 * GET /api/doctors
 * Returns all active clinics formatted as doctor cards
 * Query params:
 *   - page: number (default 1)
 *   - limit: number (default 12)
 *   - specialisation: string (optional filter)
 *   - q: string (search by name/role)
 */
router.get('/doctors', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));
    const skip = (page - 1) * limit;

    const specialisation = (req.query.specialisation || '').trim();
    const q = (req.query.q || '').trim();

    const filter = {
      isActive: true,
      status: 'active',
      Chief_doctor: { $exists: true, $ne: '' },   // must have a doctor name
    };

    if (specialisation) {
      filter.specialisation = specialisation;
    }

    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { Chief_doctor: regex },
        { clinicName: regex },
        { Role: regex },
        { address: regex },
      ];
    }

    const [docs, total] = await Promise.all([
      Clinic.find(filter)
        .select(
          'Chief_doctor Role consult_fee profile_img s3_profile_img clinicName address specialisation redirect_path clinic_timing about_doctor registrationNumber'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Clinic.countDocuments(filter),
    ]);

    // Shape the response as doctor cards
    const doctors = docs.map((c) => ({
      id: c._id,
      name: c.Chief_doctor,
      role: c.Role,
      clinicName: c.clinicName,
      address: c.address,
      specialisation: c.specialisation,
      consultFee: c.consult_fee,
      timing: c.clinic_timing,
      about: c.about_doctor,
      profileImg: c.s3_profile_img || c.profile_img || null,  // prefer S3
      redirectPath: c.redirect_path,
      registrationNumber: c.registrationNumber,
    }));

    return res.json({
      success: true,
      data: doctors,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Doctors list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Also export the allowed specialisations for filter UI
router.get('/doctors/specialisations', (_req, res) => {
  res.json({
    success: true,
    data: [
      'Physio',
      'Orthopedic',
      'Neuro',
      'Cardio',
      'General Practice',
      'Gynecology',
      'ENT',
      'Dermatology',
      'Nutrition',
      'Other',
    ],
  });
});

module.exports = router;

/*
─────────────────────────────────────
HOW TO USE IN YOUR EXISTING SETUP:
─────────────────────────────────────
Since you already have clinicRoutes.js, just PASTE the two router.get()
blocks above directly into your clinicRoutes.js file, BEFORE module.exports.

Your existing server.js already has:
  app.use('/api/clinics', clinicRoutes);

So the endpoints will be:
  GET /api/clinics/doctors                  → all doctor cards
  GET /api/clinics/doctors/specialisations  → filter options

No changes needed to server.js.
─────────────────────────────────────
*/
