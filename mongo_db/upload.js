import express from "express";
import multer from "multer";
import { Readable } from "stream";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

import { getGfs } from "../mongo_db/mongodb.js";
import { PhotoModel } from "../mongo_db/user.js";
import {
  isHeifFormat,
  parseImageQuery,
  processToWebp,
  streamToBuffer,
} from "../mongo_db/imageProcess.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

function baseName(filename) {
  return filename.replace(/\.[^/.]+$/, "") || "photo";
}

/**
 * @route POST /upload
 * @description Uploads an image file to GridFS and creates a metadata document.
 */
router.post("/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  const gfs = getGfs();
  const { originalname, buffer, mimetype } = req.file;
  const { username } = req.body;

  try {
    const processedBuffer = await processToWebp(buffer, mimetype, originalname);
    const newFilename = `${baseName(originalname)}.webp`;
    const newMimetype = "image/webp";

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
    const hint = isHeifFormat(mimetype, originalname)
      ? " HEIF/HEIC conversion failed — try exporting as JPEG or PNG."
      : "";
    res.status(400).json({
      message: `Could not process image.${hint}`,
    });
  }
});

/**
 * @route GET /image/:fileId
 * @description Streams an image from GridFS. ?w=480&q=68 returns a smaller WebP thumbnail.
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
    const contentType = file.contentType || "";
    const filename = file.filename || "";
    const { width, quality } = parseImageQuery(req.query);
    const isHeif = isHeifFormat(contentType, filename);

    if (isHeif || width) {
      const downloadStream = gfs.openDownloadStream(fileId);
      const rawBuffer = await streamToBuffer(downloadStream);
      const webpBuffer = await processToWebp(rawBuffer, contentType, filename, {
        width: width ?? undefined,
        quality,
      });

      res.set("Content-Type", "image/webp");
      res.set(
        "Content-Disposition",
        `inline; filename="${baseName(filename)}${width ? `-w${width}` : ""}.webp"`,
      );
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(webpBuffer);
    }

    res.set("Content-Type", contentType || "application/octet-stream");
    res.set("Content-Disposition", `inline; filename="${filename}"`);
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
 * @description Cursor-based pagination (newest first). Supports optional search via ?q=
 */
router.get("/photos", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
    const cursor = req.query.cursor;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const filter = {};

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [{ filename: regex }, { username: regex }];
    }

    let photos;

    if (cursor) {
      if (!mongoose.Types.ObjectId.isValid(cursor)) {
        return res.status(400).json({ message: "Invalid cursor." });
      }
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    photos = await PhotoModel.find(filter).sort({ _id: -1 }).limit(limit);

    res.status(200).json(photos);
  } catch (error) {
    console.error("Error fetching photos:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

export default router;
