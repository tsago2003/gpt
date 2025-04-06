import express, { Request, Response, NextFunction } from "express";
import { json } from "body-parser";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { Pool, PoolConfig } from "pg";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { Blob } from "fetch-blob"; // Import Blob from fetch-blob
import FormData from "form-data";
import moment, { lang } from "moment";
import fs from "fs";
import path from "path";
import { createLogger, format, transports } from "winston";
import bufferToStream from "buffer-to-stream"; // To convert buffer to stream
import OpenAI from "openai";
import { FsReadStream } from "openai/_shims/auto/types";
import { error } from "console";

// import { authenticateToken } from "./authmiddleware";
// import { getRemoteConfig } from "./authmiddleware";
import router from "./src/routes/main.router";
import { getDbConnection } from "./src/database/db.config";
// --------------------------
// Environment Configuration
// --------------------------
dotenv.config();

getDbConnection();

// --------------------------
const app = express();

// Middleware
app.use(json());
app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use("/", router);
app.listen(5000, () => {
  console.log("server is started on port ");
});
