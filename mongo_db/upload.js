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

/**
 * @route GET /migrate-to-webp
 * @description Scans all photos and converts non-WebP images to WebP.
 */
router.get("/migrate-to-webp", async (req, res) => {
  const gfs = getGfs();
  try {
    const photosToMigrate = await PhotoModel.find({
      contentType: { $ne: "image/webp" },
    });

    if (photosToMigrate.length === 0) {
      return res.json({ message: "No photos need migration." });
    }

    const results = {
      total: photosToMigrate.length,
      success: 0,
      failed: 0,
    };

    for (const photo of photosToMigrate) {
      try {
        // 1. Download old image
        const downloadStream = gfs.openDownloadStream(photo.fileId);
        const chunks = [];
        try {
          for await (const chunk of downloadStream) {
            chunks.push(chunk);
          }
        } catch (downloadError) {
          console.error(`Error downloading file ${photo.fileId}:`, downloadError);
          results.failed++;
          continue;
        }
        
        const buffer = Buffer.concat(chunks);

        // 2. Convert to WebP using sharp and resize for efficiency
        const webpBuffer = await sharp(buffer)
          .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 6 })
          .toBuffer();

        const newFilename = `${photo.filename.replace(/\.[^/.]+$/, "")}.webp`;
        const newMimetype = "image/webp";

        // 3. Upload new WebP image to GridFS
        const uploadStream = gfs.openUploadStream(newFilename, {
          contentType: newMimetype,
          metadata: { username: photo.username },
        });

        const readableStream = new Readable();
        readableStream.push(webpBuffer);
        readableStream.push(null);
        
        await new Promise((resolve, reject) => {
          readableStream.pipe(uploadStream)
            .on("finish", resolve)
            .on("error", reject);
        });

        // 4. Update Photo metadata in MongoDB
        const oldFileId = photo.fileId;
        photo.fileId = uploadStream.id;
        photo.filename = newFilename;
        photo.contentType = newMimetype;
        await photo.save();

        // 5. Delete the original non-WebP file from GridFS to save space
        try {
          await gfs.delete(oldFileId);
        } catch (deleteError) {
          console.error(`Warning: Failed to delete old file ${oldFileId}:`, deleteError);
          // We don't increment failure here because the new file is already saved and database updated
        }

        results.success++;
      } catch (err) {
        console.error(`Failed to migrate photo ${photo._id}:`, err);
        results.failed++;
      }
    }

    res.json({ message: "Migration complete", results });
  } catch (error) {
    console.error("Migration error:", error);
    res.status(500).json({ message: "Migration failed", error: error.message });
  }
});

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
    // Process image with sharp: convert to webp, compress, and resize for efficient loading
    const processedBuffer = await sharp(buffer)
      .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
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
    // Cache for 1 year since image contents are immutable
    res.set("Cache-Control", "public, max-age=31536000, immutable");

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
