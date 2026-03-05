const express = require("express");
const router = express.Router();
const multer = require("multer");
const { Readable } = require("stream");
const mongoose = require("mongoose");
const { getGfs } = require("../mongo_db/mongodb");
const { PhotoModel } = require("../mongo_db/user");
const { v4: uuidv4 } = require("uuid");

// Use memory storage with multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

/**
 * @route POST /upload
 * @description Uploads an image file to GridFS and creates a metadata document.
 */
router.post("/upload", upload.single("photo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  const gfs = getGfs();
  const { originalname, mimetype, buffer } = req.file;
  const { username } = req.body;

  // Create a readable stream from the buffer
  const readablePhotoStream = new Readable();
  readablePhotoStream.push(buffer);
  readablePhotoStream.push(null);

  const uploadStream = gfs.openUploadStream(originalname, {
    contentType: mimetype,
    metadata: { username },
  });

  readablePhotoStream.pipe(uploadStream);

  uploadStream.on("error", (error) => {
    console.error("GridFS upload error:", error);
    res.status(500).json({ message: "Error uploading file to GridFS." });
  });

  uploadStream.on("finish", async () => {
    try {
      const photoDoc = new PhotoModel({
        fileId: uploadStream.id,
        filename: originalname,
        contentType: mimetype,
        username: username,
        uniqueID: uuidv4(),
        views: 0,
      });

      await photoDoc.save();

      res.status(201).json({
        message: "File uploaded successfully.",
        fileId: uploadStream.id,
        photoDoc: photoDoc,
      });
    } catch (error) {
      console.error("Error saving photo metadata:", error);
      // If metadata save fails, delete the orphaned GridFS file.
      gfs
        .delete(uploadStream.id)
        .catch((err) =>
          console.error(
            "Error deleting GridFS file after metadata save failure:",
            err,
          ),
        );
      res.status(500).json({ message: "Error saving photo metadata." });
    }
  });
});

/**
 * @route GET /image/:fileId
 * @description Streams an image from GridFS.
 */
router.get("/image/:fileId", async (req, res) => {
  const gfs = getGfs();
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);

    const files = await gfs.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found." });
    }

    const file = files[0];
    res.set("Content-Type", file.contentType);
    res.set("Content-Disposition", `inline; filename="${file.filename}"`);

    const downloadStream = gfs.openDownloadStream(fileId);
    downloadStream.pipe(res);
  } catch (error) {
    console.error("Error retrieving image:", error);
    if (error.name === "BSONError") {
      return res.status(400).json({ message: "Invalid file ID format." });
    }
    res.status(500).json({ message: "Internal server error." });
  }
});

/**
 * @route GET /photos
 * @description Retrieves all photo metadata in a randomized order.
 */
router.get("/photos", async (req, res) => {
  try {
    const photos = await PhotoModel.find({});

    // Fischer-Yates Shuffle for randomization
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }

    res.status(200).json(photos);
  } catch (error) {
    console.error("Error fetching photos:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

module.exports = router;
