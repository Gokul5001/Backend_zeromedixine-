// // routes/notification.js
// const express = require("express");
// const router = express.Router();
// const admin = require("../utils/firebase");
// const FcmDevice = require("../models/FcmDevice");


// router.post("/send", async (req, res) => {
//     const { token, title, body, data } = req.body;
  
//     if (!token) {
//       return res.status(400).json({ message: "FCM token required" });
//     }
  
//     const message = {
//       token,
//       notification: {
//         title: title || "Zeromedixine",
//         body: body || "You have a new update",
//       },
//       data: data || {},
//     };
  
//     try {
//       const response = await admin.messaging().send(message);
//       console.log("✅ Push sent:", response);
//       res.json({ success: true, response });
//     } catch (error) {
//       console.error("❌ Push error:", error);
//       res.status(500).json({ success: false, error: error.message });
//     }
//   });
  

  
//   router.post("/update", async (req, res) => {
//     const { userId, role, token, deviceType, clinicId } = req.body;
  
//     if (!userId || !token) {
//       return res.status(400).json({ message: "userId and token required" });
//     }
  
//     try {
//       await FcmDevice.updateOne(
//         { token: token }, // check by token (unique field)
//         {
//           $set: {
//             userId,
//             role,
//             deviceType,
//             clinicId: clinicId || null,
//             updatedAt: new Date(),
//           },
//         },
//         { upsert: true } // create if not exists
//       );
  
//       res.json({ success: true });
//     } catch (error) {
//       console.error("FCM Update Error:", error);
//       res.status(500).json({ success: false });
//     }
//   });
  

// module.exports = router;



// routes/notification.js
// const express = require("express");
// const router = express.Router();
// const admin = require("../utils/firebase");
// const FcmDevice = require("../models/FcmDevice");
// const Doctor = require("../Models/Doctor");

// router.post("/send", async (req, res) => {
//   const { token, title, body, data } = req.body;

//   if (!token) {
//     return res.status(400).json({ message: "FCM token required" });
//   }

//   const message = {
//     token,
//     notification: {
//       title: title || "Zeromedixine",
//       body: body || "You have a new update",
//     },
//     data: data || {},
//   };

//   try {
//     const response = await admin.messaging().send(message);
//     console.log("✅ Push sent:", response);
//     res.json({ success: true, response });
//   } catch (error) {
//     console.error("❌ Push error:", error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// router.post("/update", async (req, res) => {
//   const { userId, role, token, deviceType, clinicId } = req.body;

//   if (!userId || !token) {
//     return res.status(400).json({ message: "userId and token required" });
//   }

//   try {
//     await FcmDevice.updateOne(
//       { token: token },
//       {
//         $set: {
//           userId,
//           role,
//           deviceType,
//           clinicId: clinicId || null,
//           updatedAt: new Date(),
//         },
//       },
//       { upsert: true }
//     );

//     res.json({ success: true });
//   } catch (error) {
//     console.error("FCM Update Error:", error);
//     res.status(500).json({ success: false });
//   }
// });

// // ─────────────────────────────────────────────────────────────
// // HELPER: resolve doctor_id ("doc_009") → Doctor's MongoDB _id
// // Caches result on first call per process run could be added later
// // ─────────────────────────────────────────────────────────────
// async function getDoctorObjectId(doctorIdStr) {
//   if (!doctorIdStr) return null;

//   const doc = await Doctor.findOne({ doctor_id: doctorIdStr })
//     .select("_id")
//     .lean();

//   return doc?._id || null;
// }

// // ─────────────────────────────────────────────────────────────
// // HELPER: send push notification to a doctor by doctor_id string
// // Looks up FcmDevice by the doctor's ObjectId (userId field)
// // Use this from physioReminderJob.js, booking confirmations, etc.
// // ─────────────────────────────────────────────────────────────
// async function sendNotificationToDoctor(doctorIdStr, { title, body, data = {} }) {
//   try {
//     const doctorObjectId = await getDoctorObjectId(doctorIdStr);

//     if (!doctorObjectId) {
//       console.warn(`⚠️ sendNotificationToDoctor: no Doctor found for doctor_id="${doctorIdStr}"`);
//       return { success: false, reason: "doctor_not_found" };
//     }

//     // A doctor may have multiple devices (e.g. logged in on 2 phones)
//     const devices = await FcmDevice.find({
//       userId: doctorObjectId,
//       role: "doctor",
//     }).lean();

//     if (!devices.length) {
//       console.warn(`⚠️ sendNotificationToDoctor: no FCM devices for doctor_id="${doctorIdStr}" (objectId=${doctorObjectId})`);
//       return { success: false, reason: "no_devices" };
//     }

//     const results = [];

//     for (const device of devices) {
//       try {
//         const message = {
//           token: device.token,
//           notification: { title, body },
//           data: Object.fromEntries(
//             Object.entries(data).map(([k, v]) => [k, String(v)]) // FCM data values must be strings
//           ),
//         };

//         const response = await admin.messaging().send(message);
//         console.log(`✅ Push sent to doctor ${doctorIdStr} (token=${device.token.slice(0, 12)}...):`, response);
//         results.push({ token: device.token, success: true, response });
//       } catch (err) {
//         console.error(`❌ Push failed for doctor ${doctorIdStr} (token=${device.token.slice(0, 12)}...):`, err.message);

//         // Clean up dead/invalid tokens
//         if (
//           err.code === "messaging/registration-token-not-registered" ||
//           err.code === "messaging/invalid-registration-token"
//         ) {
//           await FcmDevice.deleteOne({ token: device.token }).catch(() => {});
//           console.log(`🗑️ Removed stale FCM token for doctor ${doctorIdStr}`);
//         }

//         results.push({ token: device.token, success: false, error: err.message });
//       }
//     }

//     return { success: true, results };
//   } catch (err) {
//     console.error("sendNotificationToDoctor error:", err.message);
//     return { success: false, reason: "internal_error", error: err.message };
//   }
// }



// module.exports = router;
// module.exports.sendNotificationToDoctor = sendNotificationToDoctor;
// module.exports.getDoctorObjectId = getDoctorObjectId;



// routes/notification.js
const express = require("express");
const router = express.Router();
const admin = require("../utils/firebase");
const FcmDevice = require("../models/FcmDevice");
const Doctor = require("../Models/Doctor");

router.post("/send", async (req, res) => {
  const { token, title, body, data } = req.body;

  if (!token) {
    return res.status(400).json({ message: "FCM token required" });
  }

  const message = {
    token,
    notification: {
      title: title || "Zeromedixine",
      body: body || "You have a new update",
    },
    data: data || {},
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Push sent:", response);
    res.json({ success: true, response });
  } catch (error) {
    console.error("❌ Push error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/update", async (req, res) => {
  const { userId, role, token, deviceType, clinicId } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ message: "userId and token required" });
  }

  try {
    await FcmDevice.updateOne(
      { token: token },
      {
        $set: {
          userId,
          role,
          deviceType,
          clinicId: clinicId || null,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("FCM Update Error:", error);
    res.status(500).json({ success: false });
  }
});

// ─────────────────────────────────────────────────────────────
// HELPER: resolve doctor_id ("doc_009") → Doctor's MongoDB _id
// ─────────────────────────────────────────────────────────────
async function getDoctorObjectId(doctorIdStr) {
  if (!doctorIdStr) return null;

  const doc = await Doctor.findOne({ doctor_id: doctorIdStr })
    .select("_id")
    .lean();

  return doc?._id || null;
}

// ─────────────────────────────────────────────────────────────
// HELPER: send push notification to a doctor by doctor_id string
// Looks up FcmDevice by the doctor's ObjectId (userId field)
//
// NOTE: role filter intentionally removed — the app stores the
// doctor's profile role (e.g. "Physiotherapist", "Android developer")
// in fcm_devices.role, not the literal string "doctor". userId is
// already scoped to this specific doctor, so that's enough.
// ─────────────────────────────────────────────────────────────
async function sendNotificationToDoctor(doctorIdStr, { title, body, data = {} }) {
  try {
    const doctorObjectId = await getDoctorObjectId(doctorIdStr);

    if (!doctorObjectId) {
      console.warn(`⚠️ sendNotificationToDoctor: no Doctor found for doctor_id="${doctorIdStr}"`);
      return { success: false, reason: "doctor_not_found" };
    }

    const devices = await FcmDevice.find({
      userId: doctorObjectId,
    }).lean();

    if (!devices.length) {
      console.warn(`⚠️ sendNotificationToDoctor: no FCM devices for doctor_id="${doctorIdStr}" (objectId=${doctorObjectId})`);
      return { success: false, reason: "no_devices" };
    }

    const results = [];

    for (const device of devices) {
      try {
        const message = {
          token: device.token,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)]) // FCM data values must be strings
          ),
        };

        const response = await admin.messaging().send(message);
        console.log(`✅ Push sent to doctor ${doctorIdStr} (token=${device.token.slice(0, 12)}...):`, response);
        results.push({ token: device.token, success: true, response });
      } catch (err) {
        console.error(`❌ Push failed for doctor ${doctorIdStr} (token=${device.token.slice(0, 12)}...):`, err.message);

        // Clean up dead/invalid tokens
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await FcmDevice.deleteOne({ token: device.token }).catch(() => {});
          console.log(`🗑️ Removed stale FCM token for doctor ${doctorIdStr}`);
        }

        results.push({ token: device.token, success: false, error: err.message });
      }
    }

    return { success: true, results };
  } catch (err) {
    console.error("sendNotificationToDoctor error:", err.message);
    return { success: false, reason: "internal_error", error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// OPTIONAL: HTTP endpoint version
// Body: { doctor_id: "doc_009", title, body, data }
// ─────────────────────────────────────────────────────────────
router.post("/send-to-doctor", async (req, res) => {
  const { doctor_id, title, body, data } = req.body;

  if (!doctor_id) {
    return res.status(400).json({ success: false, message: "doctor_id is required" });
  }

  const result = await sendNotificationToDoctor(doctor_id, {
    title: title || "Zeromedixine",
    body: body || "You have a new update",
    data: data || {},
  });

  return res.json(result);
});

module.exports = router;
module.exports.sendNotificationToDoctor = sendNotificationToDoctor;
module.exports.getDoctorObjectId = getDoctorObjectId;