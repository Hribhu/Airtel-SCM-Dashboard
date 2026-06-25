/* ===================================================
   server.js
   Airtel SCM Platform — backend API
=================================================== */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const uploadRoute = require("./routes/upload");
const historyRoute = require("./routes/history");

const app = express();
const PORT = process.env.PORT || 4000;

// CORS_ORIGIN can be a comma-separated list, e.g.
// "https://airtel-scm-dashboard.vercel.app,http://localhost:5500"
const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

app.use("/api/upload", uploadRoute);
app.use("/api/history", historyRoute);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler (multer errors, parser errors, etc.)
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Max size is 15MB." });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Airtel SCM backend running on http://localhost:${PORT}`);
});

// Safety nets: log and keep running instead of silently dying on a bug
// in a request handler that escapes Express's normal error pipeline.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

module.exports = app;
