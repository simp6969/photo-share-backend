require("dotenv").config();
const express = require("express");
const { connect, getBucket } = require("./mongo_db/mongodb");
const uploadRoutes = require("./mongo_db/upload");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB and GridFS
connect();

app.use(express.json());

// Enable All CORS Requests
app.use(cors());

// Routes
app.use("/api", uploadRoutes);

app.get("/photo", (req, res) => {
  const bucket = getBucket();
  
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
