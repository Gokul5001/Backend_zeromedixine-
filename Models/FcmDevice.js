const mongoose = require("mongoose");

const fcmDeviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true, // prevents duplicates
    },
    deviceType: {
      type: String,
      enum: ["android", "web", "ios"],
      default: "android",
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("fcm_devices", fcmDeviceSchema);
