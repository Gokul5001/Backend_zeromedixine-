const express = require("express");
const multer = require("multer");
const OpenAI = require("openai");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// OpenAI model used for X-ray reasoning. Must be a vision-capable model
// that supports structured outputs (json_schema + strict mode).
const XRAY_MODEL = process.env.OPENAI_XRAY_MODEL || "gpt-4o";

// URL of the FastAPI BiomedCLIP microservice. Point this at wherever
// uvicorn is running (docker-compose service name, k8s service, etc).
const BIOMEDCLIP_SERVICE_URL = process.env.BIOMEDCLIP_SERVICE_URL || "http://localhost:8001/classify";
const BIOMEDCLIP_TIMEOUT_MS = 20000;

// ── System prompt ────────────────────────────────────────────────────────
// Unchanged from the Gemini version — same radiologist framing, plus rule
// 11 telling the model how to treat the BiomedCLIP hint (advisory only).
const XRAY_SYSTEM_PROMPT = `
You are an experienced Musculoskeletal (MSK) Radiologist specializing in interpreting plain X-ray radiographs for orthopedic and physiotherapy patients.

Your primary responsibility is to describe ONLY what is directly visible in the image.

GENERAL RULES

1. First verify whether the uploaded image is actually an X-ray.
   - If it is not an X-ray, set isXray=false and explain why.
   - Never attempt medical diagnosis on non-X-ray images.

2. Never guess.
   - If image quality is poor, anatomy is partially visible, or findings are uncertain, explicitly state that the diagnosis is uncertain.
   - Use "unclear" severity whenever appropriate.

3. Do NOT diagnose fractures unless ALL of the following are visible:
   - Definite cortical disruption
   - Clear fracture line
   - Consistent bone alignment changes if applicable

4. Do NOT confuse:
   - Osteophytes
   - Joint-space narrowing
   - Sclerosis
   - Degenerative arthritis
   - Calcifications
   with fractures.

5. Before diagnosing a fracture, actively consider whether the appearance could instead represent:
   - Osteoarthritis
   - Degenerative joint disease
   - Old healed fracture
   - Normal anatomical variation
   - Projection artifact
   - Overlapping bones

6. If only a single projection is available, mention that additional views may be required before confirming a fracture.

7. If findings are ambiguous, report:
   "Possible fracture cannot be confirmed on this single image."

8. Never invent findings that are not directly visible.

9. Describe exactly what you see before suggesting a diagnosis.

10. Confidence must reflect image certainty, not language confidence.

11. You may be given a "PRELIMINARY COMPUTATIONAL SCREENING" block produced by a fast zero-shot image classifier (BiomedCLIP). Treat it strictly as a supplementary hint, not a finding:
    - It compares the image against a fixed label list using embedding similarity — it does not reason about the image.
    - It frequently confuses degenerative changes with fractures, and can be wrong about modality.
    - Weigh it only as a mild prior. Your own visual analysis of the image always takes precedence. If your reading disagrees with the screening result, trust your own reading and you may briefly note the disagreement in "limitations".

ANALYSIS CHECKLIST

Evaluate:

- Image quality
- Anatomical region
- Bone alignment
- Cortical continuity
- Joint alignment
- Joint-space narrowing
- Osteophytes
- Sclerosis
- Bone density
- Dislocation
- Surgical hardware
- Soft tissue abnormalities if visible

COMMON FINDINGS TO IDENTIFY

Fractures:
- Clavicle fracture
- Proximal humerus fracture
- Radius fracture
- Ulna fracture
- Femur fracture
- Tibia fracture
- Fibula fracture
- Wrist fracture
- Ankle fracture

Degenerative:
- Osteoarthritis
- Glenohumeral osteoarthritis
- AC joint osteoarthritis
- Knee osteoarthritis
- Hip osteoarthritis

Other:
- Dislocation
- Subluxation
- Osteopenia
- Osteoporosis
- Surgical fixation
- Normal study

RULES FOR DIFFERENTIAL DIAGNOSIS

Provide up to 3 possible diagnoses ranked by probability. The probabilities should approximately sum to 1.0.

Example:

[
  { "condition": "Glenohumeral osteoarthritis", "probability": 0.82 },
  { "condition": "Old healed clavicle fracture", "probability": 0.12 },
  { "condition": "Acute clavicle fracture", "probability": 0.06 }
]

LIMITATIONS

Always mention important limitations such as:
- Single AP view only
- Image quality
- Partial anatomy
- Additional views recommended if appropriate

DISCLAIMER

Always state that:
"This assessment is generated using AI-based statistical image pattern recognition and is not a definitive medical diagnosis. All findings should be confirmed by a licensed radiologist or orthopedic physician before making treatment decisions."
`;

// ── Structured output schema (OpenAI strict json_schema format) ─────────
// Strict mode requires: additionalProperties:false on every object, and
// every property listed in "required" (use a ["type","null"] union for
// fields that are logically optional, since OpenAI strict mode doesn't
// support "nullable" or omitted-but-not-required properties).
const XRAY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isXray: { type: "boolean" },
    anatomicalRegion: { type: "string" },
    imageQuality: { type: "string", enum: ["good", "acceptable", "poor"] },
    suspectedCondition: { type: "string" },
    differentialDiagnosis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          condition: { type: "string" },
          probability: { type: "number" },
        },
        required: ["condition", "probability"],
      },
    },
    severity: { type: "string", enum: ["mild", "moderate", "severe", "unclear", "not applicable"] },
    redFlag: { type: "boolean" },
    redFlagReason: { type: ["string", "null"] },
    findings: { type: "array", items: { type: "string" } },
    recommendedNextSteps: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    limitations: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: [
    "isXray",
    "anatomicalRegion",
    "imageQuality",
    "suspectedCondition",
    "differentialDiagnosis",
    "severity",
    "redFlag",
    "redFlagReason",
    "findings",
    "recommendedNextSteps",
    "confidence",
    "limitations",
    "disclaimer",
  ],
};

/**
 * Calls the BiomedCLIP FastAPI service for a fast zero-shot first-pass.
 * Best-effort: returns null on any failure/timeout so the route can
 * degrade gracefully to OpenAI-only analysis instead of failing the request.
 */
async function getBiomedClipScreening(buffer, mimetype, filename) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BIOMEDCLIP_TIMEOUT_MS);

  try {
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mimetype }), filename || "xray.jpg");

    const res = await fetch(BIOMEDCLIP_SERVICE_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`BiomedCLIP service returned ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn("BiomedCLIP screening unavailable:", err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Formats the BiomedCLIP result into a short text block to inject into
 * the user message. Keeps it to the top few candidates per category
 * so it reads as a hint, not a wall of numbers.
 */
function formatScreeningForPrompt(screening) {
  if (!screening) return "";

  const topModality = screening.modality
    .slice(0, 3)
    .map((m) => `${m.label} (${(m.probability * 100).toFixed(1)}%)`)
    .join(", ");
  const topFindings = screening.findings
    .slice(0, 5)
    .map((f) => `${f.label} (${(f.probability * 100).toFixed(1)}%)`)
    .join(", ");

  return `
PRELIMINARY COMPUTATIONAL SCREENING (BiomedCLIP zero-shot classifier — advisory only, see system rule 11):
Modality likelihoods: ${topModality}
Top finding-label similarities: ${topFindings}
`;
}

router.post(
  "/api/doctor-panel/appointments/:id/xray-analysis",
  upload.single("xray"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No X-ray image uploaded" });
      }

      // 1. Fast first-pass classification (non-blocking on failure).
      const screening = await getBiomedClipScreening(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      const screeningBlock = formatScreeningForPrompt(screening);

      // 2. Full reasoning + structured report from OpenAI, with the
      //    screening result (if we got one) folded into the prompt.
      const base64Image = req.file.buffer.toString("base64");
      const imageDataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

      const completion = await openai.chat.completions.create({
        model: XRAY_MODEL,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 1200,
        messages: [
          { role: "system", content: XRAY_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Analyze this X-ray image and return your findings in the required JSON format." +
                  screeningBlock,
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "xray_analysis",
            strict: true,
            schema: XRAY_RESPONSE_SCHEMA,
          },
        },
      });

      const raw = completion.choices?.[0]?.message?.content;
      if (!raw) {
        return res.status(502).json({ success: false, message: "AI returned an empty response" });
      }

      let analysis;
      try {
        analysis = JSON.parse(raw);
      } catch {
        return res.status(502).json({ success: false, message: "AI returned an unreadable response" });
      }

      return res.json({
        success: true,
        analysis,
        // Raw classifier output included for transparency/audit trail —
        // the frontend can choose to surface or hide this.
        preliminaryClassifier: screening
          ? {
              available: true,
              topModality: screening.topModality,
              topFinding: screening.topFinding,
              modality: screening.modality,
              findings: screening.findings,
            }
          : { available: false },
      });
    } catch (err) {
      console.error("xray-analysis error:", err);
      return res.status(500).json({ success: false, message: "X-ray analysis failed" });
    }
  }
);

module.exports = router;