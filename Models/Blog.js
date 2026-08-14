const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, unique: true },
    content: { type: String, required: true },

    blogImage: {
      type: String // Google Drive webViewLink
    },

    author: {
      type: String,
      default: "Zeromedixine Team"
    },

    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published"
    },

    publishedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Blog", blogSchema);
