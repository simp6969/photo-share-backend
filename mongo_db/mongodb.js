const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
require("dotenv").config();
const url = process.env.MONGO_DB_CONNECTION_STRING;

let gfs;

const connect = async () => {
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

const getGfs = () => {
  if (!gfs) throw new Error("GridFS not initialized.");
  return gfs;
};

module.exports = { connect, getGfs };
