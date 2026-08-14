// server.js
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const addSessionRoutes = require("./Routes/addSessionRoutes");
const consentRoutes = require("./Routes/consentRoutes");
const appointmentRoutes = require("./Routes/AppointmentRoutes");
const Appointment = require("./Models/Appointment");
const OplivaSession = require("./Models/OplivaSession");

// at top of file: add these requires (if not already present)
const twilio = require("twilio");
const adminAuth = require("./Routes/Login");
const cookieParser = require("cookie-parser");
const cors=require('cors')
const sessionRoutes = require("./Routes/Sessions");
const paymentRoutes = require("./Routes/paymentRoutes");
const { startReminderJob } = require("./jobs/reminderJob");
const { startSessionReminderJob } = require("./jobs/sessionReminderJob");
const { startScheduleRunner } = require("./utils/scheduleRunner");
const invoiceRoutes = require("./Routes/invoiceRoutes");
const SuperAdminLogin = require("./Routes/SuperAdminLogin");
const addSessionReschedule = require("./Routes/addSessionReschedule");
const salesAuth = require('./Routes/salesAuth');
const calendarRoutes = require("./routes/calendarRoutes");
const clinicRoutes = require("./routes/clinicRoutes");
const calendarRoutes_specific = require("./routes/calendarRoutes_specific");
const clinicAuth = require("./routes/clinicAuth");
const addClinicPatientRouter = require("./routes/addclinicpatient");
const clinicCalendarRouter = require("./routes/clinicCalendarRoutes");
const clinicPatientInvoice = require("./routes/clinicPatientInvoice");
const stateRoutes = require("./routes/stateRoutes");
const clinicBookingRoutes = require("./Routes/clinicBookingRoutes");
const clinicBookingRoutesnew = require("./Routes/clinicBookingRoutesnew");
const doctorPanelInvoiceRoutes = require("./Routes/doctorPanelInvoiceRoutes");

const tokenRoutes = require("./Middleware/token");
const blogRoutes = require("./Routes/blogRoutes");
const Doctors = require("./Routes/doctors");
// const aiRoutes = require("./Routes/aiRoutes");
const geminiRoutes = require("./Routes/geminiRoutes");
const hfSummarizeRoutes = require("./Routes/hfSummarizeRoutes");
const multer = require("multer");
const ElevenLabs = require("elevenlabs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { Readable } = require("stream");
const fs = require("fs");
const path = require("path");
ffmpeg.setFfmpegPath(ffmpegPath);
const OpenAI = require("openai");
const oplivaRoutes = require("./routes/oplivaRoutes");
const forParentsRoutes = require("./routes/forParentsRoutes");
const doctorOtpAuth = require("./routes/doctorOtpAuth");
const notificationRoutes = require("./routes/notification");
const textToSpeech = require("@google-cloud/text-to-speech");
const proxyRoutes = require("./routes/proxyRoutes");
const { startPhysioReminderJob } = require("./Routes/physioReminderJob");
const patientAuthRoutes = require("./Routes/patientAuth");
const aiAssessmentRoutes = require("./routes/aiAssessment");
const recoveryPlanRoutes = require("./routes/recoveryPlan");
const adminPhysioAppointmentRoutes = require("./Routes/adminPhysioAppointmentRoutes");
const doctorPanelAuth = require("./Routes/doctorPanelAuth");
const doctorPanelXrayRoutes = require("./Routes/doctorPanelXray");
const geoip = require("geoip-lite");
const billingRoutes = require("./Routes/billingRoutes.js");


geoip.lookup("8.8.8.8");
console.log("[geo] geoip-lite database preloaded");

const franc=require("franc")
const upload = multer();


const app = express();

const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use(express.urlencoded({ extended: true }));
// after app.use(express.json()) and before routes
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  
  process.env.FRONTEND_ORIGIN // optionally set FRONTEND_ORIGIN in .env
];

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser requests (postman)
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    callback(new Error('CORS policy: origin not allowed - ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','Accept']
};

app.use(cors(corsOptions));


app.use(cookieParser());


// MongoDB connection

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected to", mongoose.connection.db.databaseName);
    // start reminder job only after DB is ready
    startReminderJob();
    startSessionReminderJob();
    startScheduleRunner();
    startPhysioReminderJob();



  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));


// Routes
const concernRoutes = require("./routes/concernRoutes");

const physioAppointmentRoutes = require("./Routes/physioAppointmentRoutes");

app.use("/api/admin/physio-appointments", adminPhysioAppointmentRoutes);
app.use("/api/admin/physio-appointments", physioAppointmentRoutes);

app.use("/api/concerns", concernRoutes);
app.use("/api/appointments", appointmentRoutes);  
app.use("/api/patient", appointmentRoutes);
app.use("/api/admin", adminAuth);
app.use("/api/sessions", sessionRoutes);  
app.use("/api/payments", paymentRoutes);
app.use("/api/add_sessions", addSessionRoutes);
app.use("/api/consent", consentRoutes);
// app.use("/api/superadmin", superAdminRoutes);
app.use("/api/add_sessions", invoiceRoutes); // or mount at /api/add_sessions/invoice if you prefer
app.use("/api/superadmin", SuperAdminLogin);
app.use("/api/add_sessions", addSessionReschedule);
app.use('/api/sales', salesAuth);
app.use("/api/calendar", calendarRoutes);
app.use('/api/clinics', clinicRoutes);
app.use("/api/calendar", calendarRoutes_specific);
app.use("/api/clinics/auth", clinicAuth);
app.use("/api/clinics/patients", addClinicPatientRouter);
app.use("/api/calendar", clinicCalendarRouter); 
app.use("/api/clinics/patients", clinicPatientInvoice);
app.use("/api/states", stateRoutes);
app.use("/api/clinic-bookings", clinicBookingRoutes);
app.use("/api/clinics/new-bookings", clinicBookingRoutesnew);
app.use("/api/doctor-panel", doctorPanelInvoiceRoutes);
app.use("/api/patient-auth", patientAuthRoutes);
app.use("/api/assessment", aiAssessmentRoutes);
app.use("/api/recovery-plan", recoveryPlanRoutes);
app.use("/", doctorPanelXrayRoutes);
app.use("/api/token", tokenRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/public",Doctors);
// app.use("/api/ai", aiRoutes);
// app.use("/api/ai", geminiRoutes);
// app.use("/api/ai", hfSummarizeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/opliva", oplivaRoutes);
app.use("/api/for-parents", forParentsRoutes);
app.use("/api/whatsapp-bulk", require("./routes/whatsappBulkRoutes"));
app.use(
  "/api/whatsapp-bulk",
  require("./routes/whatsappScheduleRoutes")
);
app.use("/api/doctor-panel", doctorPanelAuth);
// Default route
app.get("/", (req, res) => res.send("Server and MongoDB are running smoothly!"));
app.use("/api/doctor-auth", doctorOtpAuth);
app.use("/api", proxyRoutes);
app.use("/api/billing", billingRoutes);

// ===== Twilio Video =====
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;
const client = twilio(
  process.env.TWILIO_API_KEY_SID,
  process.env.TWILIO_API_KEY_SECRET,
  { accountSid: process.env.TWILIO_ACCOUNT_SID }
);

const elevenlabs = new ElevenLabs.ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// Token generation for Twilio Video
app.post("/api/video/token", (req, res) => {
  try {
    const { identity, room } = req.body;
    if (!identity || !room) return res.status(400).json({ error: "Missing params: identity or room" });

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { identity }
    );
    token.addGrant(new VideoGrant({ room }));

    return res.json({ token: token.toJwt() });
  } catch (err) {
    console.error("Token error:", err);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// Create Twilio Room for consultation
app.post("/api/video/create-room", async (req, res) => {
  try {
    const { roomName } = req.body;
    
    if (!roomName) {
      return res.status(400).json({ error: "Room name is required" });
    }

    // Create Twilio room
    const room = await client.video.v1.rooms.create({
      uniqueName: roomName,
      type: "group",
      recordParticipantsOnConnect: false
    });

    console.log(`✅ Twilio room created: ${roomName}`);
    
    res.json({ 
      success: true, 
      roomName: room.uniqueName,
      roomSid: room.sid
    });
    
  } catch (err) {
    console.error("Error creating Twilio room:", err);
    
    // If room already exists, that's fine - we can still use it
    if (err.code === 53113) {
      return res.json({ 
        success: true, 
        roomName: req.body.roomName,
        message: "Room already exists" 
      });
    }
    
    res.status(500).json({ error: "Failed to create video room" });
  }
});

app.post("/api/send-whatsapp", async (req, res) => {
  try {
    const payload = req.body;

    const response = await axios.post(
      "https://api.superfone.ai/v1/messages",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPERFONE_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({
      success: true,
      superfoneResponse: response.data
    });
  } catch (error) {
    console.error("WhatsApp send error:", error?.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: error?.response?.data || "WhatsApp send failed"
    });
  }
});



app.post("/api/detect-language", (req, res) => {
  const { text } = req.body;
  const lang = franc(text);
  res.json({ lang });
});

// app.post("/api/transcript", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No audio file received" });
//     }

//     const inputPath = path.join(__dirname, `input_${Date.now()}.webm`);
//     const outputPath = path.join(__dirname, `output_${Date.now()}.wav`);

//     // Save uploaded webm
//     fs.writeFileSync(inputPath, req.file.buffer);

//     // Convert webm → wav
//     await new Promise((resolve, reject) => {
//       ffmpeg(inputPath)
//         .audioCodec("pcm_s16le")
//         .audioChannels(1)
//         .audioFrequency(16000)
//         .format("wav")
//         .save(outputPath)
//         .on("end", resolve)
//         .on("error", reject);
//     });

//     // Send WAV to ElevenLabs
//     const transcription = await elevenlabs.speechToText.convert({
//       file: fs.createReadStream(outputPath),
//       model_id: "scribe_v2",
//       diarize: true,
//       language_code: "eng"
//     });

//     // Cleanup
//     fs.unlinkSync(inputPath);
//     fs.unlinkSync(outputPath);

//     console.log("Transcript:", transcription.text);

//     res.json({ text: transcription.text });

//   } catch (error) {
//     console.error("Transcription error:", error);
//     res.status(500).json({ error: "Transcription failed" });
//   }
// });


app.post("/api/transcript", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file received" });
    }

    const inputPath = path.join(__dirname, `input_${Date.now()}.webm`);
    const outputPath = path.join(__dirname, `output_${Date.now()}.wav`);

    // Save uploaded webm
    fs.writeFileSync(inputPath, req.file.buffer);

    // Convert webm → wav (16k mono required)
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .format("wav")
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // 🔥 Send to OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputPath),
      model: "whisper-1"
    });

    // Cleanup
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    console.log("Transcript:", transcription.text);

    res.json({ text: transcription.text });

  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Transcription failed" });
  }
});


app.get("/test-eleven", async (req, res) => {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      }
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Network test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// app.post("/api/video/save-transcript", async (req, res) => {
//   try {
//     const { roomName, transcript } = req.body;

//     if (!roomName || !transcript) {
//       return res.status(400).json({ error: "Missing roomName or transcript" });
//     }

//     const appointment = await Appointment.findOne({
//       "twilioRoomPatient.roomName": roomName
//     });

//     if (!appointment) {
//       return res.status(404).json({ error: "Appointment not found" });
//     }

//     // Save as single paragraph (overwrite or append)
//     appointment.transcript = transcript;

//     await appointment.save();

//     res.json({ success: true });

//   } catch (error) {
//     console.error("Transcript save error:", error);
//     res.status(500).json({ error: "Failed to save transcript" });
//   }
// });


app.post("/api/video/save-transcript", async (req, res) => {
  try {
    const { roomName, transcript } = req.body;

    if (!roomName || !transcript) {
      return res.status(400).json({ error: "Missing roomName or transcript" });
    }

    // 🔍 First check Zeromedixine Appointment
    let appointment = await Appointment.findOne({
      "twilioRoomPatient.roomName": roomName
    });

    if (appointment) {
      appointment.transcript = transcript;
      await appointment.save();
      return res.json({ success: true, source: "appointment" });
    }

    // 🔍 Then check Opliva Sessions
    let oplivaSession = await OplivaSession.findOne({
      roomName: roomName
    });

    if (oplivaSession) {
      oplivaSession.transcript = transcript;
      await oplivaSession.save();
      return res.json({ success: true, source: "opliva" });
    }

    return res.status(404).json({ error: "Room not found in any collection" });

  } catch (error) {
    console.error("Transcript save error:", error);
    res.status(500).json({ error: "Failed to save transcript" });
  }
});

// ==========================================
// 🔥 Separate Route: Summarize Transcript
// ==========================================
app.post("/api/video/summarize", async (req, res) => {
  try {
    const roomName = req.body?.roomName;

    if (!roomName) {
      return res.status(400).json({ error: "roomName is required" });
    }
    

    // 1️⃣ Get stored transcript from DB
    const appointment = await Appointment.findOne({
      "twilioRoomPatient.roomName": roomName
    });

    if (!appointment || !appointment.transcript) {
      return res.status(404).json({ error: "Transcript not found" });
    }

    const transcriptText = appointment.transcript;

    // 2️⃣ Send to OpenAI for summarization
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a professional clinical documentation assistant."
        },
        {
          role: "user",
          content: `
Summarize the following patient-doctor consultation transcript in structured medical format.

Provide sections:

• Chief Complaint  
• Symptoms  
• Duration  
• Medical History  
• Next Steps  

Do NOT use markdown.
Do NOT use **or special formatting.
Return clean plain text only.

Keep it clear, structured, and professional.

Transcript:
${transcriptText}
`
        }
      ]
    });

    const summary = response.choices[0].message.content;

    // 3️⃣ Return summary (DO NOT STORE)
    return res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error("Summarize route error:", error);
    return res.status(500).json({
      error: "Failed to summarize transcript"
    });
  }
});


// ==========================================
// 🔥 Generic Text Summarization API
// ==========================================
app.post("/api/ai/summarize-text", async (req, res) => {
  try {
    const text = req.body?.text;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are a professional summarization assistant. Return clean plain text only. Do not use markdown or special formatting."
        },
        {
          role: "user",
          content: `Summarize the following text clearly and concisely:\n\n${text}`
        }
      ]
    });

    const summary = response.choices[0].message.content.trim();

    return res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error("Text summarization error:", error);
    return res.status(500).json({
      error: "Failed to summarize text"
    });
  }
});


// 🎤 Text-to-Speech Route
app.post("/api/tts", async (req, res) => {
  try {
    const { text, languageCode = "en-IN" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }


    const client = new textToSpeech.TextToSpeechClient({
      keyFilename: path.join(__dirname, "secrets", "google_gokul.json")
    });

    const request = {
      input: { text },
      voice: {
        languageCode: languageCode,
        name: languageCode === "ta-IN" ? "ta-IN-Wavenet-A" : "en-IN-Wavenet-A"
      },
      audioConfig: {
        audioEncoding: "MP3"
      }
    };

    const [response] = await client.synthesizeSpeech(request);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Disposition": "attachment; filename=voice.mp3"
    });

    res.send(response.audioContent);

  } catch (error) {
    console.error("TTS Error:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});


// ── Add this to your main Express app (e.g. server.js / app.js) ──────────────
//
// This tiny route reads the country from the incoming request headers.
// Hosting providers inject these automatically:
//   • Cloudflare:  CF-IPCountry
//   • Vercel:      x-vercel-ip-country
//   • Railway/Render: typically forwarded via CF-IPCountry too
//
// Because it's on YOUR domain (e.g. api.zeromedixine.com/api/geo),
// no ad blocker or tracking prevention will ever touch it.



// In your routes file or directly in server.js:
// app.get("/api/geo", (req, res) => {
//   // Try each header source in priority order
//   const country =
//     req.headers["cf-ipcountry"]          ||   // Cloudflare (most reliable)
//     req.headers["x-vercel-ip-country"]   ||   // Vercel
//     req.headers["x-country-code"]        ||   // some CDNs
//     null;

//   // Cloudflare sends "XX" for unknown/Tor exit nodes — treat as fallback
//   if (!country || country === "XX" || country === "T1") {
//     return res.json({ country: "IN", source: "fallback" });
//   }

//   return res.json({ country: country.toUpperCase(), source: "header" });
// });

app.get("/api/geo", (req, res) => {
  // 1. Get the real visitor IP
  //    x-forwarded-for is set by Cloudflare/nginx/any reverse proxy
  //    We take the FIRST IP in the list (the original client IP)
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (forwarded ? forwarded.split(",")[0].trim() : null) ||
    req.socket.remoteAddress ||
    "";
 
  // 2. Strip IPv6 loopback prefix (e.g. "::ffff:127.0.0.1" → "127.0.0.1")
  const cleanIp = ip.replace(/^::ffff:/, "");
 
  // 3. Lookup country from local geoip database (no external API call)
  const geo = geoip.lookup(cleanIp);
  const country = geo?.country || null;
 
  console.log(`[geo] ip=${cleanIp} → country=${country || "unknown (fallback IN)"}`);
  res.set("Cache-Control", "private, max-age=3600");

 
  // 4. If localhost/private IP or lookup fails → fallback to IN
  if (!country) {
    return res.json({ country: "IN", source: "fallback", ip: cleanIp });
  }
 
  return res.json({ country, source: "geoip-lite", ip: cleanIp });
});

// ── If you're NOT behind Cloudflare/Vercel, use a lightweight IP lookup ──────
// Install: npm install geoip-lite
// Then replace the route above with:

/*
const geoip = require("geoip-lite");

app.get("/api/geo", (req, res) => {
  // Get real IP (works behind nginx / any reverse proxy)
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";

  const geo = geoip.lookup(ip);
  const country = geo?.country || "IN";

  return res.json({ country, ip, source: "geoip-lite" });
});
*/

// Start server
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));


// ── STEP 1: Install the package ───────────────────────────────────────────────
// Run this in your backend folder:
//   npm install geoip-lite
//
// ── STEP 2: Replace your current /api/geo route in server.js ─────────────────
// Find this block in server.js:
//
//   app.get("/api/geo", (req, res) => { ... });
//
// And replace the entire thing with the code below.
// ─────────────────────────────────────────────────────────────────────────────
