const express = require("express");
const router = express.Router();
const multer = require("multer");
const slugify = require("slugify");

const Blog = require("../Models/Blog");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");

/* -----------------------------
   MULTER (MEMORY STORAGE)
------------------------------ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

/* =====================================================
   POST → CREATE BLOG (IMAGE → DRIVE ROOT)
   URL: /api/blogs
===================================================== */
router.post("/", upload.single("blogImage"), async (req, res) => {
  try {
    const { title, content, author } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required"
      });
    }

    let blogImage = null;

    /* ---------- Upload image to Google Drive ROOT ---------- */
    if (req.file && req.file.buffer) {
      const filename = `blog_${Date.now()}_${req.file.originalname}`;

      const result = await uploadToDriveOAuth(
        req.file.buffer,
        filename,
        req.file.mimetype
        // 👈 NO folderId passed
      );

      blogImage =
        result?.webViewLink ||
        (result?.id
          ? `https://drive.google.com/file/d/${result.id}/view`
          : null);
    }

    const blog = await Blog.create({
      title,
      slug: slugify(title, { lower: true, strict: true }),
      content,
      author: author || "Zeromedixine Team",
      blogImage
    });

    return res.status(201).json({
      success: true,
      message: "Blog created successfully",
      data: blog
    });

  } catch (err) {
    console.error("❌ Blog create error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while creating blog"
    });
  }
});

/* =====================================================
   GET → ALL BLOGS
===================================================== */
router.get("/", async (req, res) => {
  try {
    const blogs = await Blog.find({ status: "published" })
      .sort({ publishedAt: -1 });

    return res.json({
      success: true,
      blogs
    });

  } catch (err) {
    console.error("❌ Fetch blogs error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch blogs"
    });
  }
});

/* =====================================================
   GET → SINGLE BLOG BY SLUG
===================================================== */
router.get("/:slug", async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found"
      });
    }

    return res.json({
      success: true,
      blog
    });

  } catch (err) {
    console.error("❌ Fetch blog error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch blog"
    });
  }
});

module.exports = router;
