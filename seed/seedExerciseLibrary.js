// seed/seedExerciseLibrary.js
//
// Run once against your dev/staging DB to give Stage 2 something to match
// against: `node seed/seedExerciseLibrary.js`
//
// This is placeholder starter data covering the 4 conditions used in your
// worked example (back, knee, neck, shoulder) at mild/moderate severity.
// Replace the exercise details, precautions, and video URLs with your
// physios' actual protocol library before relying on this in production —
// the exercise selections and contraindications here are illustrative only,
// not a validated clinical protocol.

require("dotenv").config();
const mongoose = require("mongoose");
const Exercise = require("../Models/Exercise");
const ProtocolRule = require("../Models/ProtocolRule");

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected. Clearing existing exerciselibrary/protocolrules...");
  await Exercise.deleteMany({});
  await ProtocolRule.deleteMany({});

  // ── BACK ──
  const back = await Exercise.insertMany([
    {
      name: "Pelvic Tilts",
      targetCondition: "back",
      targetJoint: "lumbar spine",
      difficultyLevel: "beginner",
      description: "Gentle lumbar mobility drill, lying on back.",
      defaultSets: 3,
      defaultReps: 10,
      minReps: 8,
      maxReps: 15,
      precautions: "Move within a pain-free range only.",
      contraindications: ["pain > 8"],
    },
    {
      name: "Bird Dog",
      targetCondition: "back",
      targetJoint: "core/lumbar",
      difficultyLevel: "beginner",
      description: "Core stability exercise on hands and knees.",
      defaultSets: 3,
      defaultReps: 8,
      minReps: 6,
      maxReps: 12,
      precautions: "Keep the spine neutral, avoid arching.",
      contraindications: ["pain > 7"],
    },
    {
      name: "Cat-Cow Stretch",
      targetCondition: "back",
      targetJoint: "thoracolumbar spine",
      difficultyLevel: "beginner",
      description: "Segmental spinal mobility flow.",
      defaultSets: 2,
      defaultReps: 10,
      minReps: 6,
      maxReps: 15,
      precautions: "Slow, controlled movement only.",
      contraindications: [],
    },
  ]);

  // ── KNEE ──
  const knee = await Exercise.insertMany([
    {
      name: "Quad Sets",
      targetCondition: "knee",
      targetJoint: "knee/quadriceps",
      difficultyLevel: "beginner",
      description: "Isometric quad contraction, no joint movement.",
      defaultSets: 3,
      defaultReps: 15,
      minReps: 10,
      maxReps: 20,
      precautions: "Should not increase joint pain.",
      contraindications: [],
    },
    {
      name: "Straight Leg Raise",
      targetCondition: "knee",
      targetJoint: "knee/hip flexor",
      difficultyLevel: "beginner",
      description: "Lying leg raise with knee locked straight.",
      defaultSets: 3,
      defaultReps: 10,
      minReps: 8,
      maxReps: 15,
      precautions: "Keep lower back flat against the floor.",
      contraindications: ["swelling"],
    },
    {
      name: "Heel Slides",
      targetCondition: "knee",
      targetJoint: "knee",
      difficultyLevel: "beginner",
      description: "Supported knee flexion/extension in a lying position.",
      defaultSets: 3,
      defaultReps: 10,
      minReps: 8,
      maxReps: 15,
      precautions: "Stop short of sharp pain, not just discomfort.",
      contraindications: [],
    },
  ]);

  // ── NECK ──
  const neck = await Exercise.insertMany([
    {
      name: "Chin Tucks",
      targetCondition: "neck",
      targetJoint: "cervical spine",
      difficultyLevel: "beginner",
      description: "Deep neck flexor activation, postural correction.",
      defaultSets: 3,
      defaultReps: 10,
      minReps: 8,
      maxReps: 15,
      precautions: "Small, controlled movement — no forcing.",
      contraindications: ["numbness"],
    },
    {
      name: "Neck Rotation Stretch",
      targetCondition: "neck",
      targetJoint: "cervical spine",
      difficultyLevel: "beginner",
      description: "Gentle active rotation to end-range, held briefly.",
      defaultSets: 2,
      defaultReps: 8,
      minReps: 5,
      maxReps: 12,
      precautions: "Avoid if dizziness occurs.",
      contraindications: ["numbness"],
    },
  ]);

  // ── SHOULDER ──
  const shoulder = await Exercise.insertMany([
    {
      name: "Pendulum Swings",
      targetCondition: "shoulder",
      targetJoint: "glenohumeral joint",
      difficultyLevel: "beginner",
      description: "Passive gravity-assisted shoulder mobility.",
      defaultSets: 3,
      defaultReps: 10,
      minReps: 8,
      maxReps: 15,
      precautions: "Let the arm hang loose — no active lifting.",
      contraindications: [],
    },
    {
      name: "Scapular Retractions",
      targetCondition: "shoulder",
      targetJoint: "scapula/upper back",
      difficultyLevel: "beginner",
      description: "Shoulder blade squeeze for postural strength.",
      defaultSets: 3,
      defaultReps: 12,
      minReps: 8,
      maxReps: 15,
      precautions: "",
      contraindications: [],
    },
  ]);

  await ProtocolRule.insertMany([
    {
      conditionType: "back",
      severityLevels: ["mild", "moderate"],
      painRangeMin: 0,
      painRangeMax: 7,
      ageRangeMin: 1,
      ageRangeMax: 120,
      recommendedExerciseIds: back.map((e) => e._id),
      progressionTrigger: "painReducedBy20pct AND adherence>80pct",
    },
    {
      conditionType: "knee",
      severityLevels: ["mild", "moderate"],
      painRangeMin: 0,
      painRangeMax: 7,
      ageRangeMin: 1,
      ageRangeMax: 120,
      recommendedExerciseIds: knee.map((e) => e._id),
      progressionTrigger: "painReducedBy20pct AND adherence>80pct",
    },
    {
      conditionType: "neck",
      severityLevels: ["mild", "moderate"],
      painRangeMin: 0,
      painRangeMax: 6,
      ageRangeMin: 1,
      ageRangeMax: 120,
      recommendedExerciseIds: neck.map((e) => e._id),
      progressionTrigger: "painReducedBy20pct AND adherence>80pct",
    },
    {
      conditionType: "shoulder",
      severityLevels: ["mild", "moderate"],
      painRangeMin: 0,
      painRangeMax: 7,
      ageRangeMin: 1,
      ageRangeMax: 120,
      recommendedExerciseIds: shoulder.map((e) => e._id),
      progressionTrigger: "painReducedBy20pct AND adherence>80pct",
    },
    // Severe cases and hip/other: no auto-rule on purpose -> falls through
    // to "no matching protocol rule" in the controller, which routes to a
    // physio-built plan instead of an AI-generated one.
  ]);

  console.log("Seed complete: exerciselibrary + protocolrules populated for back/knee/neck/shoulder.");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
