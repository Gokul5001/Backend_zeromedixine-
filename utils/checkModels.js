const path = require("path");

// Load .env from backend/.env
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

async function checkModels() {
  console.log("Current directory:", process.cwd());
  console.log("Loaded API Key:", process.env.GEMINI_API_KEY?.substring(0, 10) + "...");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );

    const data = await res.json();

    console.log("\n===== RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

checkModels();