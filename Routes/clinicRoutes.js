// routes/clinicRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Clinic = require('../Models/Clinic');
const mongoose = require('mongoose');
const { uploadToDriveOAuth } = require('../lib/drive-oauth'); // your existing Drive helper
// const { sendTemplateMessage } = require("../utils/aisensy");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcryptjs');
const ClinicCredentials = require('../Models/ClinicCredentials'); // path may vary
const ClinicPatient = require("../Models/addpatient");  // your addpatient.js exports "ClinicPatient"
const Appointment = require("../Models/Appointment");   // adjust path/filename as needed
const State = require("../Models/State");
const { sendTemplateMessage } = require("../utils/superfone");
const { requireAuth } = require("../Middleware/authMiddleware");


// multer memory storage for small files (signature + pdf)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    // allow up to 10 MB for the concern PDF and small signature
    fileSize: 25 * 1024 * 1024 // 25 MB as an overall max (per-field still controlled by client)
  }
});



// helper
function sanitizeString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function sanitizeIFSC(v) {
  const s = sanitizeString(v || '').toUpperCase();
  return s || null;
}

function sanitizeGST(v) {
  const s = sanitizeString(v || '').toUpperCase();
  return s || null;
}

// simple phone normalizer (replace with your existing function if present)
function normalizePhone(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  // remove spaces, parentheses, dashes
  s = s.replace(/[()\s\-]/g, "");
  // remove leading zeros
  s = s.replace(/^0+/, "");
  // ensure starts with country code — default to India '91' if no + or country code present
  if (!s.startsWith("+")) {
    // if it already looks like 10 digit Indian number, prefix +91
    if (/^\d{10}$/.test(s)) s = "+91" + s;
    else if (/^\d{11,15}$/.test(s) && s.length > 10) s = "+" + s; // naive
    else s = "+" + s; // fallback
  }
  // ensure digits and leading +
  s = s.replace(/[^\d+]/g, "");
  return s;
}



const allowedSpecialisations = [
  "Physio",
  "Orthopedic",
  "Neuro",
  "Cardio",
  "General Practice",
  "Gynecology",
  "ENT",
  "Dermatology",
  "Nutrition",
  "Other"
];


/**
 * GET /api/clinics/doctor-strip
 * - ACTIVE clinics only
 * - UNIQUE by registrationNumber
 * - profile_img required
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


router.get("/doctor-strip", async (req, res) => {
  try {
    const clinics = await Clinic.aggregate([
      {
        // 1️⃣ Only approved & active clinics
        $match: {
          status: "active",
          isActive: true,
          profile_img: { $exists: true, $ne: null },
          registrationNumber: { $exists: true, $ne: "" }
        }
      },

      {
        // 2️⃣ Sort newest first (so latest clinic wins)
        $sort: { createdAt: -1 }
      },

      {
        // 3️⃣ Group by registrationNumber
        $group: {
          _id: "$registrationNumber",
          clinic: { $first: "$$ROOT" }
        }
      },

      {
        // 4️⃣ Flatten structure
        $replaceRoot: { newRoot: "$clinic" }
      },

      {
        // 5️⃣ Limit homepage load
        $limit: 30
      },

      {
        // 6️⃣ Send only required fields
        $project: {
          clinicName: 1,
          Chief_doctor: 1,
          Role: 1,
          profile_img: 1,
          s3_profile_img: 1, // ✅ ADD THIS
          redirect_path: 1,
          registrationNumber: 1
        }
      }
    ]);

    return res.json({
      success: true,
      data: clinics
    });

  } catch (err) {
    console.error("Doctor strip error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});



// POST /api/clinics/register
router.post('/register', upload.fields([
  { name: 'signature', maxCount: 1 },
  { name: 'concernFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const body = req.body || {};

    const clinicName = sanitizeString(body.clinicName);
    const registrationNumber = sanitizeString(body.registrationNumber);
    const clinicNumber = sanitizeString(body.clinicNumber);
    const ownerNumber = sanitizeString(body.ownerNumber);
    const ownerName = sanitizeString(body.ownerName) || null; // optional
    const pincode = sanitizeString(body.pincode);
    const address = sanitizeString(body.address);
    const gstNumber = sanitizeGST(body.gstNumber) || null;

    const specialisationRaw = sanitizeString(body.specialisation) || 'Physio';
    const matched = allowedSpecialisations.find(s => s.toLowerCase() === specialisationRaw.toLowerCase());
    const specialisation = matched || 'Other';


    

    const clinicAccountDetails = {
      accountHolder: sanitizeString(body.accountHolder) || null,
      bankName: sanitizeString(body.bankName) || null,
      accountNumber: sanitizeString(body.accountNumber) || null,
      ifsc: sanitizeIFSC(body.ifsc) || null
    };

    // Validate required fields for full registration
    if (!clinicName || !registrationNumber || !clinicNumber || !ownerNumber) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }

    // Try to find existing pending clinic by registrationNumber
    let clinic = await Clinic.findOne({ registrationNumber }).exec();

    if (clinic && clinic.status === 'pending') {
      // Update pending clinic, but KEEP pending (admin must approve)
      clinic.clinicName = clinicName;
      clinic.clinicNumber = clinicNumber;
      clinic.ownerNumber = ownerNumber;
      clinic.gstNumber = gstNumber;
      clinic.specialisation = specialisation;
      clinic.clinicAccountDetails = clinicAccountDetails;
      clinic.isActive = false;
      clinic.status = 'pending';
      if (ownerName) clinic.ownerName = ownerName;
    } else {
      // ensure no duplicates
      const existingByNumber = await Clinic.findOne({
        $or: [
          { registrationNumber },
          { clinicNumber }
        ]
      }).lean();

      if (existingByNumber && !clinic) {
        return res.status(409).json({ success: false, message: 'Clinic with same registration or clinic number already exists' });
      }

      // create new pending clinic (not active yet)
      clinic = new Clinic({
        clinicName,
        registrationNumber,
        clinicNumber,
        ownerNumber,
        pincode,
        address,
        gstNumber,
        specialisation,
        clinicAccountDetails,
        other_details: {},
        status: 'pending',
        isActive: false,
        ownerName: ownerName || null
      });
    }

    // === handle signature file (if provided) ===
    // try {
    //   const sigFile = req.files && req.files.signature && req.files.signature[0];
    //   if (sigFile && sigFile.buffer) {
    //     try {
    //       const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
    //       const safeName = (clinicName || 'clinic').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
    //       const filename = `clinic_signature_${safeName}_${Date.now()}.png`;

    //       const result = await uploadToDriveOAuth(sigFile.buffer, filename, sigFile.mimetype || 'image/png', folderId);
    //       let driveViewUrl = null;
    //       if (result && (result.webViewLink || result.webContentLink || result.id)) {
    //         driveViewUrl = result.webViewLink || result.webContentLink || (result.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
    //       }
    //       if (driveViewUrl) {
    //         clinic.other_details = clinic.other_details || {};
    //         clinic.other_details.signature = {
    //           url: driveViewUrl,
    //           driveId: result.id || null,
    //           filename,
    //           uploadedAt: new Date()
    //         };
    //       }
    //     } catch (driveErr) {
    //       console.warn('Drive upload failed for signature, continuing:', driveErr && (driveErr.message || driveErr));
    //     }
    //   }
    // } catch (e) {
    //   console.warn('Signature handling error:', e && e.message);
    // }

    // === handle concernFile (pdf) upload to Drive and save link ===
    try {
      const concernFile = req.files && req.files.concernFile && req.files.concernFile[0];
      if (concernFile && concernFile.buffer) {
        const folderId = process.env.CLINIC_GOOGLE_DRIVE_AGREEMENT || null;
        const safeName = clinicName ? clinicName.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60) : 'clinic';
        const filename = concernFile.originalname || `clinic_Agreement_${safeName}_${Date.now()}.pdf`;

        const result = await uploadToDriveOAuth(concernFile.buffer, filename, concernFile.mimetype || 'application/pdf', folderId);
        const driveUrl = (result && (result.webViewLink || (result.id ? `https://drive.google.com/file/d/${result.id}/view` : null))) || null;

        clinic.other_details = clinic.other_details || {};
        clinic.other_details.concernForm = {
          url: driveUrl,
          driveId: result && result.id ? result.id : null,
          filename,
          uploadedAt: new Date()
        };
      }
    } catch (concernErr) {
      console.warn('Drive upload failed for concern PDF (non-fatal):', concernErr && (concernErr.message || concernErr));
    }

    // Save/update (still pending)
    await clinic.save();

    // -------------------------
    // Post-save notifications
    // -------------------------
    // 1) Owner confirmation (short): [ownerName, clinicName] — best-effort
    // (async () => {
    //   try {
    //     const ownerPhone = normalizePhone(ownerNumber || clinic.ownerNumber || '');
    //     const ownerDisplay = ownerName || clinic.ownerName || clinic.clinicName || 'Clinic';
    //     const ownerTemplate = process.env.AISENSY_CLINIC_APPROVED_TEMPLATE || '';

    //     if (ownerPhone && typeof sendTemplateMessage === 'function') {
    //       await sendTemplateMessage({
    //         to: ownerPhone,
    //         campaignName: process.env.AISENSY_CLINIC_SUBMIT_CAMPAIGN || null,
    //         templateName: ownerTemplate,
    //         params: [ownerDisplay, clinic.clinicName || ownerDisplay] // exactly two params: owner, clinic
    //       });
    //       console.log('Owner notified via WA (submission).');
    //     } else {
    //       console.warn('Owner WA not sent: missing phone or sendTemplateMessage.');
    //     }
    //   } catch (e) {
    //     console.warn('Owner WA send failed (non-fatal):', e && (e.message || e));
    //   }
    // })().catch(()=>{});
    (async () => {
      try {
        const ownerPhone = normalizePhone(ownerNumber || clinic.ownerNumber || '');
        const ownerDisplay = ownerName || clinic.ownerName || clinic.clinicName || 'Clinic';
    
        if (ownerPhone && typeof sendTemplateMessage === 'function') {
          await sendTemplateMessage({
            to: ownerPhone,
            templateName: "clinic_request_approval_step2_new",
            language: "en_US",
            params: [
              ownerDisplay,              // {{1}}
              clinic.clinicName          // {{2}}
            ]
          });
    
          console.log('Owner notified via Superfone (submission).');
        } else {
          console.warn('Owner WA not sent: missing phone or sendTemplateMessage.');
        }
      } catch (e) {
        console.warn('Owner WA send failed (non-fatal):', e?.message || e);
      }
    })();

    // 2) ADMIN notification to NOTIFY_ZEROMEDIXINE (immediately at registration)
    // (async () => {
    //   try {
    //     const adminRaw = process.env.NOTIFY_ZEROMEDIXINE_APPROVAL || '';
    //     const adminPhone = normalizePhone(adminRaw);
    //     const adminTemplate = process.env.AISENSY_CLINIC_APPROVED_TEMPLATE || '';
    //     const FRONTEND = (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
    //     // review link — point directly to the clinic review page so admin can approve quickly
    //     const reviewUrl = `${FRONTEND}/clinic_admin/login`;

    //     if (adminPhone && typeof sendTemplateMessage === 'function') {
    //       // Send exactly two params: clinicName and reviewUrl (as you requested)
    //       await sendTemplateMessage({
    //         to: adminPhone,
    //         campaignName: process.env.AISENSY_CLINIC_APPR_CAMPAIGN || null,
    //         templateName: adminTemplate,
    //         params: [clinic.clinicName || 'New Clinic', reviewUrl]
    //       });
    //       console.log('Admin notified via WA about new clinic registration.');
    //     } else {
    //       console.warn('Admin WA not sent: NOTIFY_ZEROMEDIXINE missing or sendTemplateMessage undefined.');
    //     }
    //   } catch (e) {
    //     console.warn('Admin WA send failed (non-fatal):', e && (e.message || e));
    //   }
    // })().catch(()=>{});

    (async () => {
      try {
        const adminRaw = process.env.NOTIFY_ZEROMEDIXINE_APPROVAL || '';
        const adminPhone = normalizePhone(adminRaw);
    
        const FRONTEND = (process.env.FRONTEND_URL || 'https://www.zeromedixine.com').replace(/\/$/, '');
        const reviewUrl = `${FRONTEND}/clinic_admin/login`;
    
        if (adminPhone && typeof sendTemplateMessage === 'function') {
          await sendTemplateMessage({
            to: adminPhone,
            templateName: "clinic_registration_request_newss_s",
            language: "en_US",
            params: [
              clinic.clinicName || 'New Clinic',   // {{1}}
              reviewUrl                            // {{2}}
            ]
          });
    
          console.log('Admin notified via Superfone about new clinic registration.');
        } else {
          console.warn('Admin WA not sent: missing phone or sendTemplateMessage.');
        }
      } catch (e) {
        console.warn('Admin WA send failed (non-fatal):', e?.message || e);
      }
    })();
    
    // -------------------------
    // Respond to client
    // -------------------------
    return res.json({
      success: true,
      clinicId: clinic._id,
      driveConcernUrl: clinic.other_details && clinic.other_details.concernForm ? clinic.other_details.concernForm.url : null,
      message: 'Clinic registered/updated and is pending admin approval'
    });
  } catch (err) {
    console.error('Clinic register error:', err);
    if (err && err.name === 'ValidationError') {
      const messages = Object.values(err.errors || {}).map(e => e.message).join('; ');
      return res.status(400).json({ success: false, message: `Validation error: ${messages}` });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});





router.post('/:id/status', requireAuth, async (req, res) => {
  if (!["admin", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  try {
    const id = req.params.id;
    const newStatus = String((req.body && req.body.status) || '').toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid clinic id' });
    }
    if (!['active', 'rejected', 'pending'].includes(newStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const clinic = await Clinic.findById(id);
    if (!clinic) {
      return res.status(404).json({ success: false, message: 'Clinic not found' });
    }

    // -------------------------------
    // Update status
    // -------------------------------
    clinic.status = newStatus;
    clinic.isActive = (newStatus === 'active');
    if (newStatus === 'active') {
      clinic.activatedAt = clinic.activatedAt || new Date();
    }
    await clinic.save();

    // -------------------------------
    // Generate username & password
    // -------------------------------
    let username = null;
    let rawPassword = null;

    try {
      const base = (clinic.clinicName || 'clinic')
        .split(/\s+/)[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || `clinic${Date.now().toString().slice(-4)}`;

      // ensure unique username
      let candidate = base;
      let counter = 0;
      while (true) {
        const exists = await ClinicCredentials.findOne({ username: candidate }).lean();
        if (!exists) {
          username = candidate;
          break;
        }
        counter++;
        candidate = `${base}${counter}`;
        if (counter > 9999) {
          username = `${base}${Date.now().toString().slice(-6)}`;
          break;
        }
      }

      // 🔐 password = username + random 5 digits
      const random5 = Math.floor(10000 + Math.random() * 90000); // 10000–99999
      rawPassword = `${username}${random5}`;

      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(rawPassword, saltRounds);

      await ClinicCredentials.findOneAndUpdate(
        { clinic: clinic._id },
        {
          $set: {
            clinic: clinic._id,
            username,
            passwordHash,
            createdAt: new Date()
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log('ClinicCredentials upserted for clinic', clinic._id);
    } catch (credErr) {
      console.warn(
        'Credential creation failed (non-fatal):',
        credErr && (credErr.message || credErr)
      );
    }

    // -------------------------------
    // Send WhatsApp to owner ONLY (non-blocking)
    // -------------------------------
    // (async () => {
    //   try {
    //     const accessLink = `https://www.zeromedixine.com/clinic/login`;
    //     const fullAccessString = `${accessLink}, username:${username}, password:${rawPassword}`;

    //     const ownerPhone = normalizePhone(clinic.ownerNumber || '');
    //     const clinicName = clinic.clinicName || 'Your Clinic';

    //     const templateName =
    //       process.env.AISENSY_CLINIC_APPROVED_TEMPLATE_APPROVED ||
    //       process.env.AISENSY_CLINIC_APPROVED_TEMPLATE ||
    //       null;

    //     const campaignName =
    //       process.env.AISENSY_CLINIC_APPR_CAMPAIGN_APPROVED ||
    //       process.env.AISENSY_CLINIC_APPR_CAMPAIGN ||
    //       null;

    //     if (ownerPhone && templateName && typeof sendTemplateMessage === 'function') {
    //       await sendTemplateMessage({
    //         to: ownerPhone,
    //         campaignName,
    //         templateName,
    //         params: [
    //           clinicName,      // {{1}}
    //           clinicName,      // {{2}}
    //           fullAccessString // {{3}}
    //         ]
    //       });
    //       console.log('Owner WhatsApp sent to', ownerPhone);
    //     } else {
    //       console.warn('Owner WA not sent: missing phone/template/send function');
    //     }
    //   } catch (waErr) {
    //     console.warn(
    //       'Owner WA send failed (non-fatal):',
    //       waErr && (waErr.message || waErr)
    //     );
    //   }
    // })().catch(() => {});

    (async () => {
      try {
        const accessLink = `https://www.zeromedixine.com/clinic/login`;
        const fullAccessString =
          `${accessLink}, username:${username}, password:${rawPassword}`;
    
        const rawPhone = normalizePhone(clinic.ownerNumber || '');
        const ownerPhone = rawPhone
          ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`)
          : null;
    
        const clinicName = clinic.clinicName || 'Your Clinic';
    
        if (ownerPhone && typeof sendTemplateMessage === 'function') {
          await sendTemplateMessage({
            to: ownerPhone,
            templateName: "clinic_reg",
            language: "en",
            params: [
              clinicName,
              clinicName,
              fullAccessString
            ]
          });
    
          console.log('Owner WhatsApp sent via Superfone to', ownerPhone);
        } else {
          console.warn('Owner WA not sent: missing phone or sendTemplateMessage');
        }
    
      } catch (waErr) {
        console.warn(
          'Owner WA send failed (non-fatal):',
          waErr?.message || waErr
        );
      }
    })();

    // -------------------------------
    // Return response
    // -------------------------------
    return res.json({
      success: true,
      message: 'Status updated',
      clinicId: clinic._id,
      status: clinic.status,
      isActive: clinic.isActive,
      username: username || null,
      password: rawPassword || null, // returned ONLY once
      wasNotified: null
    });

  } catch (err) {
    console.error('Clinic status update error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});


// GET /api/clinics/summary
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const clinics = await Clinic.find(
      { status: { $in: ["active", "pending"] } },
      { clinicName: 1, address: 1, status: 1 }
    ).lean();

      
    const active = clinics.filter(c => c.status === "active");
    const pending = clinics.filter(c => c.status === "pending");

    return res.json({
      success: true,
      active: {
        count: active.length,
        clinics: active
      },
      pending: {
        count: pending.length,
        clinics: pending
      }
    });
  } catch (err) {
    console.error("Clinic summary error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



router.get('/clinics_results', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || '').trim();
    const pincode = (req.query.pincode || '').trim();

    const filter = {};

    if (q) {
      const regex = new RegExp(
        q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        'i'
      );
      filter.$or = [
        { clinicName: regex },
        { Chief_doctor: regex },
        { address: regex },
        { registrationNumber: regex },
        { clinicNumber: regex }
      ];
    }

    if (pincode) filter.pincode = pincode;

    const [docs, total] = await Promise.all([
      Clinic.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Clinic.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: docs,
      total,
      page,
      limit
    });
  } catch (err) {
    console.error('Clinic list error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const pincode = (req.query.pincode || '').trim();

    const filter = {
      isActive: true   // 🔥 ONLY ACTIVE CLINICS
    };

    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), 'i');
      filter.$or = [
        { clinicName: regex },
        { Chief_doctor: regex },
        { address: regex },
        { registrationNumber: regex },
        { clinicNumber: regex }
      ];
    }

    if (pincode) filter.pincode = pincode;

    const docs = await Clinic
      .find(filter)
      .sort({ clinicName: 1 }) // better UX
      .lean();

    return res.json({
      success: true,
      data: docs,
      total: docs.length
    });
  } catch (err) {
    console.error('Clinic list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/clinics/:id
 * Get clinic details
 */
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid clinic id' });
    }

    const clinic = await Clinic.findById(id).lean();
    if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });

    return res.json({ success: true, data: clinic });
  } catch (err) {
    console.error('Clinic detail error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/clinics/request  (replace your existing /request route with this)
router.post('/request', async (req, res) => {
  try {
    const body = req.body || {};
    const clinicName = sanitizeString(body.clinicName);
    const registrationNumber = sanitizeString(body.registrationNumber);
    const clinicNumber = sanitizeString(body.clinicNumber);
    const ownerNumber = sanitizeString(body.ownerNumber);
    const pincode = sanitizeString(body.pincode);
    const address = sanitizeString(body.address);
    const rawState = sanitizeString(body.state);

    if (!clinicName || !registrationNumber || !clinicNumber || !ownerNumber || !pincode || !address || !rawState) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Invalid pincode' });
    }

    // check duplicate by registrationNumber or clinicNumber
    const existing = await Clinic.findOne({
      $or: [
        { registrationNumber },
        { clinicNumber }
      ]
    }).lean();

    if (existing) {
      if (existing.registrationNumber === registrationNumber && existing.status === 'pending') {
        return res.json({ success: true, message: 'Existing pending request found', clinicId: existing._id, alreadyPending: true });
      }
      return res.status(409).json({ success: false, message: 'Clinic with same registration or clinic number already exists' });
    }

    // ensure a valid specialisation enum value (use 'Physio' as safe default)
    const safeSpecialisation = 'Physio';

    // ----------------------------
// STATE: FIND OR CREATE
// ----------------------------
const normalizedState =
rawState.charAt(0).toUpperCase() + rawState.slice(1).toLowerCase();

let stateDoc = await State.findOne({
name: { $regex: `^${normalizedState}$`, $options: "i" }
});

if (!stateDoc) {
stateDoc = await State.create({ name: normalizedState });
}


    // NOTE: pincode and address required in model; use placeholders for pending requests
    const doc = new Clinic({
      clinicName,
      registrationNumber,
      clinicNumber,
      ownerNumber,
      pincode,
      address,     
            // 🔑 OBJECT ID STORED HERE
            state: stateDoc._id, 
      gstNumber: null,
      specialisation: safeSpecialisation,
      clinicAccountDetails: {},
      other_details: {},
      status: 'pending',
      isActive: false,
      // optional: store a registration token for secure form link
      registrationToken: uuidv4().slice(0, 12) // store in model schema if you want this
    });

    await doc.save();

    // Build registration link (frontend should have a route to consume this token/id)
    const FRONTEND_URL = process.env.FRONTEND_URL || process.env.APP_URL || "https://your-frontend.example";
    // prefer token-based link if your model saved registrationToken, else fallback to doc._id
    const regToken = doc.registrationToken || doc._id;
    const registrationLink = `${FRONTEND_URL.replace(/\/$/, "")}/clinic/onboard/${regToken}`;

    // Normalize owner number
    const ownerPhone = normalizePhone(ownerNumber);

    // // Prepare AiSensy payload
    // const campaignName = process.env.AISENSY_CLINIC_REG_CAMPAIGN;
    // const templateName = process.env.AISENSY_CLINIC_REG_TEMPLATE;

    // // Template params mapping for your template:
    // // {{1}} -> clinic name
    // // {{2}} -> registration link
    // const params = [
    //   clinicName,
    //   registrationLink
    // ];

    // // attempt to send WhatsApp template message (best-effort)
    // let waResult = null;
    // if (ownerPhone && sendTemplateMessage) {
    //   try {
    //     const pay = {
    //       to: ownerPhone,
    //       campaignName: campaignName,
    //       templateName: templateName,
    //       params
    //     };
    //     console.log("AiSensy: sending clinic registration template", pay);
    //     waResult = await sendTemplateMessage(pay);
    //     console.log("AiSensy clinic WA response:", waResult);
    //   } catch (waErr) {
    //     console.error("AiSensy send error for clinic registration:", waErr?.debug || waErr?.message || waErr);
    //     // don't fail the whole request just because WA failed
    //   }
    // } else {
    //   console.warn("Owner phone missing or sendTemplateMessage unavailable; skipping WA send.");
    // }

    // Superfone template params
const params = [
  clinicName,        // {{1}}
  registrationLink  // {{2}}
];

let waResult = null;

if (ownerPhone && typeof sendTemplateMessage === "function") {
  try {
    const payload = {
      to: ownerPhone,
      templateName: "clinic_registration_request_new",
      language: "en",
      params
    };

    console.log("Superfone: sending clinic registration template:", payload);
    waResult = await sendTemplateMessage(payload);
    console.log("Superfone clinic WA response:", waResult);
  } catch (waErr) {
    console.error("Superfone send error for clinic registration:", waErr?.response?.data || waErr?.message || waErr);
  }
} else {
  console.warn("Owner phone missing or sendTemplateMessage unavailable; skipping WA send.");
}

    return res.json({
      success: true,
      message: "Clinic request created",
      clinicId: doc._id,
      state: {
        id: stateDoc._id,
        name: stateDoc.name
      },
      whatsAppSent: Boolean(waResult)
    });
  } catch (err) {
    console.error('Clinic request error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/clinics/onboard/:id
router.get('/onboard/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const clinic = await Clinic.findOne({
      $or: [{ registrationToken: id }, { _id: id }],
      status: 'pending'
    }).lean();

    if (!clinic) return res.status(404).json({ success: false, message: 'Not found' });
    // remove sensitive fields
    delete clinic.__v;
    return res.json({ success: true, clinic });
  } catch (err) {
    console.error('onboard fetch error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});



// GET /api/clinics/dashboard-summary/:clinicId
router.get("/dashboard-summary/:clinicId", async (req, res) => {
  try {
    const clinicId = (req.params.clinicId || "").trim();
    if (!clinicId || !mongoose.Types.ObjectId.isValid(clinicId)) {
      return res.status(400).json({ success: false, message: "Invalid clinic id" });
    }

    // verify clinic exists
    const clinic = await Clinic.findById(clinicId).lean().catch(() => null);
    if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

    // Use Promise.all for better performance
    const [patientsCount, doctorsCount, appointmentsCount] = await Promise.all([
      ClinicPatient.countDocuments({ clinic: clinicId }).catch(() => 0),
      // Doctor.countDocuments({ clinic: clinicId }).catch(() => 0),
      Appointment.countDocuments({ clinic: clinicId }).catch(() => 0)
    ]);

    // Alternative: If Appointment model is undefined, check if appointments exist in ClinicPatient model
    // Some systems store appointments within patient records
    let effectiveAppointmentsCount = appointmentsCount;
    if (appointmentsCount === 0 || isNaN(appointmentsCount)) {
      // Try to count appointments differently - check if patients have treatment dates
      const patientsWithAppointments = await ClinicPatient.countDocuments({
        clinic: clinicId,
        treatmentDate: { $exists: true, $ne: null }
      }).catch(() => 0);
      effectiveAppointmentsCount = patientsWithAppointments;
    }

    // Recent patients — last 5 by createdAt desc
    let recentPatients = [];
    try {
      recentPatients = await ClinicPatient.find({ clinic: clinicId })
        .select("name mobile treatment treatmentDate treatmentTime createdAt invoice")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    } catch (e) {
      console.warn('Failed to fetch recent patients:', e.message);
    }

    return res.json({
      success: true,
      counts: {
        patients: patientsCount || 0,
        doctors: doctorsCount || 0,
        appointments: effectiveAppointmentsCount || 0
      },
      recentPatients,
      clinic: { 
        _id: clinic._id, 
        clinic_name: clinic.clinicName || clinic.name || "",
        username: clinic.username || ""
      }
    });
  } catch (err) {
    console.error("dashboard-summary error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


router.post("/:id/update-basic", requireAuth, upload.single("profile_img"),
  async (req, res) => {
    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid clinic id" });
      }

      const clinic = await Clinic.findById(id);
      if (!clinic) {
        return res.status(404).json({ success: false, message: "Clinic not found" });
      }

      const {
        clinicName,
        registrationNumber,
        clinicNumber,
        ownerNumber,
        pincode,
        address,
        Chief_doctor,
        Role,
        consult_fee,
        clinic_timing,
        about_doctor,      // ✅ NEW
        redirect_path      // ✅ NEW
      } = req.body;

      clinic.clinicName = clinicName || clinic.clinicName;
      clinic.registrationNumber = registrationNumber || clinic.registrationNumber;
      clinic.clinicNumber = clinicNumber || clinic.clinicNumber;
      clinic.ownerNumber = ownerNumber || clinic.ownerNumber;
      clinic.pincode = pincode || clinic.pincode;
      clinic.address = address || clinic.address;
      clinic.Chief_doctor = Chief_doctor || clinic.Chief_doctor;
      clinic.Role = Role || clinic.Role;
      clinic.consult_fee = consult_fee || clinic.consult_fee;
      clinic.clinic_timing = clinic_timing || clinic.clinic_timing;
      clinic.about_doctor = about_doctor ?? clinic.about_doctor;
      clinic.redirect_path = redirect_path ?? clinic.redirect_path;


      if (req.file && req.file.buffer) {
        const folderId = process.env.CLINIC_PROFILE_FOLDER_ID;
        const filename = `clinic_profile_${clinic._id}_${Date.now()}.jpg`;

        const result = await uploadToDriveOAuth(
          req.file.buffer,
          filename,
          req.file.mimetype,
          folderId
        );

        clinic.profile_img =
          result?.webViewLink ||
          (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);
      }

      await clinic.save();

      return res.json({
        success: true,
        message: "Clinic details updated",
        data: clinic
      });

    } catch (err) {
      console.error("Clinic update error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

router.get("/clinics/:id", async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  res.json({ success: true, clinic });
});

 

module.exports = router;
