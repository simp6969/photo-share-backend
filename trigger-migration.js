import { connect, getGfs } from "./mongo_db/mongodb.js";
import { PhotoModel } from "./mongo_db/user.js";
import sharp from "sharp";
import { Readable } from "stream";

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await connect();
    const gfs = getGfs();
    
    console.log("Scanning for non-WebP images...");
    const photosToMigrate = await PhotoModel.find({
      contentType: { $ne: "image/webp" },
    });

    console.log(`Found ${photosToMigrate.length} photos to migrate.`);

    for (const photo of photosToMigrate) {
      try {
        console.log(`- Migrating photo: ${photo.filename} (ID: ${photo._id})`);
        
        // 1. Download
        const downloadStream = gfs.openDownloadStream(photo.fileId);
        const chunks = [];
        for await (const chunk of downloadStream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // 2. Convert
        const webpBuffer = await sharp(buffer)
          .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 6 })
          .toBuffer();

        const newFilename = `${photo.filename.replace(/\.[^/.]+$/, "")}.webp`;
        const newMimetype = "image/webp";

        // 3. Upload
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

        // 4. Update Database
        const oldFileId = photo.fileId;
        photo.fileId = uploadStream.id;
        photo.filename = newFilename;
        photo.contentType = newMimetype;
        await photo.save();

        // 5. Delete old file
        await gfs.delete(oldFileId);
        console.log(`  ✓ Successfully migrated to WebP (New FileID: ${uploadStream.id})`);
      } catch (err) {
        console.error(`  ✗ Failed to migrate photo ${photo._id}:`, err.message);
      }
    }
    
    console.log("\nMigration task completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Migration fatal error:", error);
    process.exit(1);
  }
}

run();
