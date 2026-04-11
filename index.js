import express from "express";
import { connect } from "./mongo_db/mongodb.js";
import router from "./mongo_db/upload.js";
import cors from "cors";
import dotenv from "dotenv";
const app = express();
dotenv.config();
// Connect to MongoDB and GridFS
connect();

app.use(express.json());

// Enable All CORS Requests
app.use(cors());

// Routes
app.use("/api", router);

app.get("/", (req, res) => {
  res.status(200);
  res.send("psdaoaoaoaoo");
});

export default app;
