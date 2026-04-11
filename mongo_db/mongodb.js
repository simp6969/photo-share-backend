import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { configDotenv } from "dotenv";
const dotenv = configDotenv();
const url = process.env.MONGO_DB_CONNECTION_STRING;

let gfs;

export const connect = async () => {
  try {
    await mongoose.connect(url);
    const db = mongoose.connection.db;
    gfs = new GridFSBucket(db, {
      bucketName: "photos",
    });
    console.log("Successfully connected to MongoDB and GridFS initialized.");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

export const getGfs = () => {
  if (!gfs) throw new Error("GridFS not initialized.");
  return gfs;
};
