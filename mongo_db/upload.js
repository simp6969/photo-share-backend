import express from "express";
import multer from "multer";
import { Readable } from "stream";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";

// Local imports - MUST include the .js extension
import { getGfs } from "../mongo_db/mongodb.js";
import { PhotoModel } from "../mongo_db/user.js";

// Initialize the router
const router = express.Router();

// ... your route logic goes here (e.g., router.post('/upload', ...))

export default router;
// Use memory storage with multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

/**
 * @route POST /upload
 * @description Uploads an image file to GridFS and creates a metadata document.
 */
router.post("/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  const gfs = getGfs();
  const { originalname, buffer } = req.file;
  const { username } = req.body;

  try {
    // Process image with sharp: convert to webp and compress
    const processedBuffer = await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer();

    const newFilename = `${originalname.split(".")[0]}.webp`;
    const newMimetype = "image/webp";

    // Create a readable stream from the processed buffer
    const readablePhotoStream = new Readable();
    readablePhotoStream.push(processedBuffer);
    readablePhotoStream.push(null);

    const uploadStream = gfs.openUploadStream(newFilename, {
      contentType: newMimetype,
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
          filename: newFilename,
          contentType: newMimetype,
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
  } catch (error) {
    console.error("Error processing image:", error);
    res.status(500).json({ message: "Error processing image upload." });
  }
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
 * @description Retrieves photo metadata in descending order with pagination.
 */
router.get("/photos", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch photos sorted by newest first with pagination
    const photos = await PhotoModel.find({})
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json(photos);
  } catch (error) {
    console.error("Error fetching photos:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});
