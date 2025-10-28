// server.js
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const appointmentRoutes = require("./Routes/AppointmentRoutes");
const cors=require('cors')

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors()) // Use this after the variable declaration

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected to", mongoose.connection.db.databaseName))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Routes
const concernRoutes = require("./routes/concernRoutes");
app.use("/api/concerns", concernRoutes);
app.use("/api/appointments", appointmentRoutes);



// Default route
app.get("/", (req, res) => res.send("Server and MongoDB are running smoothly!"));

// Start server
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));
