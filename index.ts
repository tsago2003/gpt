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

import { authenticateToken } from "./authmiddleware";
// --------------------------
// Environment Configuration
// --------------------------
dotenv.config();

// --------------------------
// Type Definitions
// --------------------------
interface BaseModel {
  [key: string]: any;
}

interface RapidApiConfig {
  key: string;
  host: string;
  transcriptApiUrl: string;
}

// --------------------------
// Logger Configuration
// --------------------------
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp} - ${service} - ${level} - ${message}`;
    })
  ),
  defaultMeta: { service: "youtube_summary" },
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/combined.log" }),
  ],
});

// --------------------------
// Service Clients Initialization
// --------------------------
// OpenAI Client
const openaiApiKey = process.env.OPENAI_API_KEY;
let openaiClient: OpenAI | null = null;

if (openaiApiKey) {
  try {
    openaiClient = new OpenAI({
      apiKey: openaiApiKey,
      timeout: 600000, // 600 seconds in ms
      maxRetries: 1,
    });
    logger.info("OpenAI client initialized successfully");
  } catch (e: any) {
    logger.error(`Failed to initialize OpenAI client: ${e.message}`);
  }
} else {
  console.warn(
    "OPENAI_API_KEY not found. Summary generation will use fallback method."
  );
}

// Database Configuration
const dbConfig: PoolConfig = {
  host: "database-2.cb24okyu4qtz.eu-north-1.rds.amazonaws.com",
  database: process.env.DB_NAME || "postgres",
  user: "postgres",
  password: "6HFRKfBMGyHctqLtcXIL",
  port: parseInt(process.env.DB_PORT || "5432"),
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false, // Enable SSL if DB_SSL is true
};

const dbPool = new Pool(dbConfig);

// RapidAPI Configuration
const rapidApiConfig: RapidApiConfig = {
  key:
    process.env.RAPIDAPI_KEY ||
    "802f09a86bmsh843f97e5c979abcp12042cjsnbe227ac79309",
  host: process.env.RAPIDAPI_HOST || "youtube-transcriptor.p.rapidapi.com",
  transcriptApiUrl: "https://youtube-transcriptor.p.rapidapi.com/transcript",
};

const rapidApiClient: AxiosInstance = axios.create({
  baseURL: rapidApiConfig.transcriptApiUrl,
  headers: {
    "X-RapidAPI-Key": rapidApiConfig.key,
    "X-RapidAPI-Host": rapidApiConfig.host,
  },
});

// --------------------------
// Express Application Setup
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

app.listen(5000, () => {
  console.log("server is started on port ");
});

// --------------------------
// Utility Classes
// --------------------------
class HTTPError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HTTPError";
  }
}

class BackgroundTasks {
  static async add(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err: any) {
      logger.error("Background task failed:", err.message);
    }
  }
}

// Utility functions
const generateUuid = (): string => uuidv4();
const getCurrentTime = (): string => moment().toISOString();

// --------------------------
// Error Handling Middleware
// --------------------------
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof HTTPError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    logger.error(err.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------------------------
// Database Models (Example)
// --------------------------
interface VideoSummary {
  id: string;
  video_id: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

// --------------------------
// Interface Definitions (equivalent to Pydantic models)
// --------------------------
interface VideoRequest {
  video_link: string;
  model?: string;
  summaryLanguage?: string;
}

interface TaskResponse {
  task_id: string;
}

interface TaskStatusResponse {
  task_id: string;
  status: string;
  transcript?: string;
  summary?: string;
  emoji?: string;
  title?: string;
  error?: string;
}

// --------------------------
// Database Setup
// --------------------------
async function setupDatabase() {
  let adminConn = null;
  let conn = null;

  try {
    // First connect to the default postgres database
    adminConn = new Pool({
      host: dbConfig.host,
      database: "postgres",
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
    });

    // Check if database exists, create if it doesn't
    const dbCheck = await adminConn.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbConfig.database]
    );

    if (dbCheck.rowCount === 0) {
      await adminConn.query(`CREATE DATABASE ${dbConfig.database}`);
      logger.info(`Database ${dbConfig.database} created`);
    }

    // Connect to our specific database
    conn = new Pool(dbConfig);

    // Create table if it doesn't exist
    await conn.query(`
      CREATE TABLE IF NOT EXISTS summaries (
        task_id VARCHAR(255) PRIMARY KEY,
        video_id VARCHAR(255) NOT NULL,
        video_link TEXT NOT NULL,
        model VARCHAR(50) NOT NULL,
        summary_language VARCHAR(50) NOT NULL,
        title TEXT,
        transcript TEXT,
        summary TEXT,
        emoji VARCHAR(10),
        status VARCHAR(20) NOT NULL,
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    logger.info("Database setup completed");
  } catch (error: any) {
    logger.error(`Database setup error: ${error.message}`);
    throw error;
  } finally {
    if (adminConn) await adminConn.end();
    if (conn) await conn.end();
  }
}

// --------------------------
// Database Helper Functions
// --------------------------
class DatabaseHelper {
  private pool: Pool;

  constructor() {
    this.pool = new Pool(dbConfig);
  }

  // Create a new task
  async createTask(
    taskId: string,
    videoLink: string,
    model: string = "Gemini",
    summaryLanguage: string = "Spanish"
  ): Promise<void> {
    const videoId = this.extractVideoId(videoLink);
    await this.pool.query(
      `INSERT INTO summaries (task_id, video_id, video_link, model, summary_language, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [taskId, videoId, videoLink, model, summaryLanguage]
    );
  }

  // Update task status
  async updateTaskStatus(
    taskId: string,
    updates: Partial<TaskStatusResponse>
  ): Promise<void> {
    const { status, transcript, summary, emoji, title, error } = updates;
    const query = `
      UPDATE summaries
      SET 
        status = COALESCE($2, status),
        transcript = COALESCE($3, transcript),
        summary = COALESCE($4, summary),
        emoji = COALESCE($5, emoji),
        title = COALESCE($6, title),
        error = COALESCE($7, error)
      WHERE task_id = $1
    `;
    await this.pool.query(query, [
      taskId,
      status,
      transcript,
      summary,
      emoji,
      title,
      error,
    ]);
  }

  // Get task status
  async getTaskStatus(taskId: string): Promise<TaskStatusResponse | null> {
    const result = await this.pool.query(
      `SELECT 
        task_id, 
        status, 
        transcript, 
        summary, 
        emoji, 
        title, 
        error
       FROM summaries WHERE task_id = $1`,
      [taskId]
    );

    if (result.rowCount === 0) return null;

    return result.rows[0] as TaskStatusResponse;
  }

  // Helper to extract video ID from URL
  private extractVideoId(url: string): string {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : "";
  }
}

// --------------------------
// Initialize Database
// --------------------------
const dbHelper = new DatabaseHelper();

// Run database setup when starting the app
setupDatabase()
  .then(() => logger.info("Database initialization complete"))
  .catch((err) => logger.error("Database initialization failed", err));
// --------------------------
// Database Connection Helper
// --------------------------
async function getDbConnection(): Promise<any> {
  return await dbPool.connect();
}

// --------------------------
// Task Operations
// --------------------------
async function insertTask(
  taskId: string,
  videoId: string,
  videoLink: string,
  model: string = "Gemini",
  summaryLanguage: string = "Spanish"
): Promise<void> {
  const client = await getDbConnection();
  try {
    await client.query(
      `INSERT INTO summaries 
       (task_id, video_id, video_link, model, summary_language, status) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [taskId, videoId, videoLink, model, summaryLanguage, "in progress"]
    );
  } catch (error: any) {
    logger.error(`Error inserting task: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

interface TaskUpdateFields {
  status?: string;
  transcript?: string;
  summary?: string;
  emoji?: string;
  title?: string;
  error?: string;
}

async function updateTaskStatus(
  taskId: string,
  status: string,
  updates: TaskUpdateFields = {}
): Promise<void> {
  const client = await getDbConnection();
  try {
    // Start with status as the first update
    const updateFields: string[] = ["status = $1"];
    const values: any[] = [status];
    let paramIndex = 2;

    // Add dynamic fields from updates
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    // Add taskId as the last parameter
    values.push(taskId);

    const query = `
      UPDATE summaries 
      SET ${updateFields.join(", ")} 
      WHERE task_id = $${paramIndex}
    `;

    await client.query(query, values);
  } catch (error: any) {
    logger.error(`Error updating task: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

interface Task {
  task_id: string;
  video_id: string;
  video_link: string;
  model: string;
  summary_language: string;
  title?: string;
  transcript?: string;
  summary?: string;
  emoji?: string;
  status: string;
  error?: string;
  created_at: Date;
}
async function getTask(taskId: string): Promise<Task | null> {
  const client = await getDbConnection();
  try {
    const result = await client.query(
      "SELECT * FROM summaries WHERE task_id = $1",
      [taskId]
    );

    if (result.rowCount === 0) return null;

    return result.rows[0] as Task;
  } catch (error: any) {
    logger.error(`Error fetching task: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

interface SummaryResult {
  emoji: string;
  summary: string;
}

async function generateSummary(
  transcriptText: string,
  summaryLanguage: string
): Promise<SummaryResult> {
  // Check if OpenAI client is available
  if (!openaiClient) {
    logger.warning(
      "OpenAI client not available. Using fallback summary generation."
    );
    return {
      emoji: "📝",
      summary: `Summary not available - OpenAI API key not configured. Transcript length: ${transcriptText.length} characters.`,
    };
  }

  try {
    const prompt = `You are a YouTube video summarizer. Complete the following two tasks:
                    
1. Summarize the entire video transcript, providing the important points with proper sub-headings 
   in a concise manner (within 500 words).

2. Choose a single emoji that best represents the main theme or topic of the video.

Format your response as follows:
EMOJI: [single emoji here]

SUMMARY:
[your summary here with proper formatting to ${summaryLanguage} Language]

The transcript is: ${transcriptText}`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that summarizes YouTube transcripts.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.5,
    });

    const responseText = response.choices[0]?.message?.content || "";
    let emoji = "📝";
    let summary = responseText;

    try {
      const emojiPart =
        responseText.split("EMOJI:")[1]?.split("SUMMARY:")[0]?.trim() || "";
      const summaryPart =
        responseText.split("SUMMARY:")[1]?.trim() || responseText;
      emoji = emojiPart.split(/\s/)[0]; // Get first emoji
      summary = summaryPart;
    } catch (e) {
      logger.warn("Couldn't parse summary response format");
    }

    return { emoji, summary };
  } catch (error: any) {
    logger.error(`Error generating summary: ${error.message}`);
    return {
      emoji: "❓",
      summary: `Error generating summary: ${error.message}`,
    };
  }
}

app.get(
  "/tasks/:taskId",
  authenticateToken,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const task = await getTask(req.params.taskId);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

interface TranscriptResponse {
  transcriptionAsText?: string;
  title?: string;
  transcription?: Array<{ subtitle?: string }>;
  [key: string]: any;
}

// --------------------------
// Video Processing Function
// --------------------------
async function processVideo(
  videoId: string,
  taskId: string,
  modelChoice: string = "Gemini",
  summaryLanguage: string = "Spanish"
): Promise<void> {
  try {
    // Update task status to processing
    await updateTaskStatus(taskId, "processing");
    logger.info(`Processing video ${videoId} with task ID ${taskId}`);

    // Set default values
    let title = `Video ${videoId}`;
    let transcriptText = "Failed to extract transcript.";
    let emoji = "📝";
    let summary = `Failed to generate summary for video ${videoId}.`;
    let status = "failed";
    // Try to extract transcript using RapidAPI
    try {
      logger.info(`Requesting transcript for video ${videoId}`);
      const response: AxiosResponse<TranscriptResponse | TranscriptResponse[]> =
        await rapidApiClient.get("", {
          params: {
            video_id: videoId,
            lang: "en",
          },
        });

      // Check if request was successful
      if (response.status === 200) {
        let data = response.data;
        logger.info(
          `Response data type: ${Array.isArray(data) ? "array" : typeof data}`
        );

        // Handle array response
        if (Array.isArray(data) && data.length > 0) {
          data = data[0];
        }

        // Extract transcript text
        if (typeof data === "object" && data !== null) {
          if ("transcriptionAsText" in data) {
            transcriptText = data.transcriptionAsText || transcriptText;
            logger.info(
              `Successfully extracted transcript of length ${transcriptText.length}`
            );

            if (data.title) {
              title = data.title;
            }
          } else {
            console.warn(
              `No transcriptionAsText found in response: ${Object.keys(data)}`
            );

            if ("transcription" in data && Array.isArray(data.transcription)) {
              const parts: string[] = [];
              for (const item of data.transcription) {
                if (item.subtitle) {
                  parts.push(item.subtitle);
                }
              }
              transcriptText = parts.join(" ");
              logger.info(
                `Built transcript from transcription list, length: ${transcriptText.length}`
              );
            }
          }
        }

        // Generate summary if we have valid transcript
        if (transcriptText !== "Failed to extract transcript.") {
          const summaryResult = await generateSummary(
            transcriptText,
            summaryLanguage
          );
          emoji = summaryResult.emoji;
          summary = summaryResult.summary;
          logger.info(`Generated summary with emoji ${emoji}`);
        } else {
          console.warn("No transcript extracted, cannot generate summary");
        }
      } else {
        console.log(response);
        logger.error(
          `Transcript extraction failed with status code ${response.status}`
        );
      }
    } catch (error: any) {
      logger.error(`Error during transcript extraction: ${error.message}`);
    }

    // Store results in the database
    logger.info(`Updating task ${taskId} as completed`);
    await updateTaskStatus(
      taskId,
      transcriptText == "Failed to extract transcript."
        ? "failed"
        : "completed",
      {
        transcript: transcriptText,
        title,
        summary,
        emoji,
      }
    );
    logger.info(`Task ${taskId} completed successfully`);
  } catch (error: any) {
    const errorMsg = error.message;
    logger.error(`Processing error for task ${taskId}: ${errorMsg}`);
    await updateTaskStatus(taskId, "failed", { error: errorMsg });
  }
}

app.post(
  "/submit_video",
  authenticateToken,
  async (
    req: Request<{}, {}, VideoRequest>,
    res: Response<TaskResponse | { error: string }>
  ): Promise<any> => {
    const { video_link, model, summaryLanguage } = req.body;

    logger.info(
      `Received video submission: ${video_link}, model: ${model}, language: ${summaryLanguage}`
    );

    if (!video_link) {
      // logger.warning("No video link provided in request");
      return res.status(400).json({ error: "No video link provided" });
    }

    try {
      // Extract video ID from the link
      const videoIdMatch = video_link.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      if (!videoIdMatch) {
        throw new Error("Invalid YouTube URL format");
      }
      const video_id = videoIdMatch[1];
      logger.info(`Extracted video ID: ${video_id}`);

      // Generate a unique task ID
      const task_id = uuidv4();
      logger.info(`Generated task ID: ${task_id}`);

      // Register the task in the database
      logger.info("Registering task in database");
      await insertTask(task_id, video_id, video_link, model, summaryLanguage);

      // Start processing in the background
      logger.info(`Starting background processing for task ${task_id}`);
      BackgroundTasks.add(() =>
        processVideo(video_id, task_id, model, summaryLanguage)
      );

      return res.json({ task_id });
    } catch (error: any) {
      const errorMsg = error.message;
      logger.error(`Submission error: ${errorMsg}`);
      return res.status(400).json({ error: errorMsg });
    }
  }
);

app.get(
  "/task_status/:task_id",
  async (
    req: Request<{ task_id: string }>,
    res: Response<TaskStatusResponse | { error: string }>
  ): Promise<any> => {
    const task_id = req.params.task_id;

    // Get task from database
    logger.info(`Fetching status for task ${task_id}`);
    const taskInfo = await getTask(task_id);

    if (!taskInfo) {
      logger.warning(`Task ID not found: ${task_id}`);
      return res.status(404).json({ error: "Task ID not found" });
    }

    const status = taskInfo.status;
    logger.info(`Task ${task_id} status: ${status}`);
    const response: TaskStatusResponse = { task_id, status };

    // If the task is completed, include the summary and emoji
    if (status === "completed") {
      logger.info(`Returning completed task data for ${task_id}`);
      response.transcript = taskInfo.transcript;
      response.summary = taskInfo.summary;
      response.emoji = taskInfo.emoji;
      response.title = taskInfo.title;
    }
    // If the task failed, include the error message
    else if (status === "failed") {
      logger.info(
        `Returning failed task data for ${task_id}: ${taskInfo.error}`
      );
      response.error = taskInfo.error || "Unknown error";
    }

    return res.json(response);
  }
);

app.post(
  "/message",
  authenticateToken,
  async (req: Request, res: Response): Promise<any> => {
    const text = req.body.transcriptionText;
    const history = req.body.chatHistory;
    const newMessage = req.body.newMessage;
    if (!text || !history || !newMessage) {
      return res.status(400).json({ error: "Wrong request body" });
    }
    return res.json(await processChat(text, history, newMessage));
  }
);
async function processChat(
  transcriptionText: string,
  chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  newMessage: string
) {
  if (!openaiClient) {
    logger.warning(
      "OpenAI client not available. Using fallback summary generation."
    );
    return {
      emoji: "📝",
      summary: `Chat not available`,
    };
  }
  // Append the new user message to the chat history
  chatHistory.push({ role: "user", content: newMessage });

  // Add the video transcription as context (if it's the start of a new video or topic)
  const systemPrompt = `
  You are InovApp's AI assistant. Your role is to:
  1. You must act like INNOVAPP LLC AI assistant .
  2. respond with new message.
  3. Answer user questions about the note topic.
  4. Engage in a discussion about the note content.
  You are always helpful, engaging, and informative.
`;

  // Include transcription in the system context, if necessary
  const fullChatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `The video transcript is: ${transcriptionText}`,
      }, // Add the transcription
      ...chatHistory,
    ];

  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "system",
          content: `The video transcript is: ${transcriptionText}`,
        }, // Add the transcription
        ...fullChatHistory,
      ],
    });

    // Get assistant's response
    const assistantMessage = response.choices[0].message.content;

    // Return response and update chat history
    chatHistory.push({ role: "assistant", content: assistantMessage });
    return assistantMessage;
  } catch (err) {
    return err;
  }
}

// Example usage

// --------------------------
// YouTube URL Helper
// --------------------------
function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}
// --------------------------
// Export Components
// --------------------------
async function downloadAudioAsBuffer(audioUrl: string): Promise<Buffer> {
  const response = await axios.get(audioUrl, { responseType: "arraybuffer" });
  return Buffer.from(response.data); // Convert the response to a Buffer
}

async function transcribeAudio(
  audioUrl: string,
  audioId: string,
  language: string
): Promise<void> {
  try {
    if (!openaiClient) {
      console.warn("OpenAI client not available.");
      return;
    }

    // Step 1: Download the audio file as a buffer from the URL
    const audioBuffer = await downloadAudioAsBuffer(audioUrl);

    // Step 2: Define the path to save the M4A file temporarily on the server
    const filePath = path.join(__dirname, "temp", "audio.m4a");

    // Ensure the directory exists or create it
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Step 3: Save the audio buffer as an M4A file temporarily on the server
    fs.writeFileSync(filePath, audioBuffer); // Write the buffer to the file

    // Step 4: Create a readable stream from the file for OpenAI API
    const audioStream = fs.createReadStream(filePath);

    // Step 5: Send the file to OpenAI's transcription API
    const transcription = await openaiClient.audio.transcriptions.create({
      model: "whisper-1",
      file: audioStream, // Send the readable stream
      language: language, // Optionally specify the language
    });

    // Step 6: Handle the transcription result
    console.log("Transcription:", transcription.text); // Output the transcribed text

    if (transcription) {
      const summaryResult = await generateSummary(transcription.text, language);
      let title = `Video ${audioId}`;
      let emoji = "📝";
      emoji = summaryResult.emoji;
      await updateTaskStatus(audioId, "completed", {
        emoji: emoji,
        summary: summaryResult.summary,
        title,
        transcript: transcription.text,
      });
    }
    // Generate summary if we have valid transcript

    logger.info(`Task ${audioId} completed successfully`);

    // Return the transcription text
    // return tra;
  } catch (error) {
    console.error("Error during transcription:", error);
    throw new Error("Transcription failed");
  } finally {
    // Step 7: Delete the temporary file after transcription is done
    try {
      fs.unlinkSync(path.join(__dirname, "temp", "audio.m4a"));
      console.log("Temporary audio file deleted.");
    } catch (err) {
      console.error("Error deleting temporary file:", err);
    }
  }
}

app.post(
  "/submit_voice",
  authenticateToken,
  async (req: Request, res: Response): Promise<any> => {
    const { audio_link, outputLanguageCode } = req.body;
    if (!audio_link || outputLanguageCode) {
      return res.status(400).json({ error: "wrong request body" });
    }
    try {
      const soundUrlMatch = audio_link.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      if (!soundUrlMatch) {
        throw new Error("Invalid YouTube URL format");
      }
      const sound_id = soundUrlMatch[1];
      const task_id = uuidv4();

      await insertTask(
        task_id,
        sound_id,
        audio_link,
        "gpt-4o-mini",
        outputLanguageCode
      );

      BackgroundTasks.add(() =>
        transcribeAudio(audio_link, task_id, outputLanguageCode)
      );
      return res.json({ task_id });
    } catch (err) {
      return res.status(400).json(err);
    }
  }
);

app.post(
  "/submit_video",
  authenticateToken,
  async (
    req: Request<{}, {}, VideoRequest>,
    res: Response<TaskResponse | { error: string }>
  ): Promise<any> => {
    const { video_link, model, summaryLanguage } = req.body;

    if (!video_link || !model || !summaryLanguage) {
      return res.status(400).json({ error: "wrong request body" });
    }
    logger.info(
      `Received video submission: ${video_link}, model: ${model}, language: ${summaryLanguage}`
    );

    if (!video_link) {
      // logger.warning("No video link provided in request");
      return res.status(400).json({ error: "No video link provided" });
    }

    try {
      // Extract video ID from the link
      const videoIdMatch = video_link.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      if (!videoIdMatch) {
        throw new Error("Invalid YouTube URL format");
      }
      const video_id = videoIdMatch[1];
      logger.info(`Extracted video ID: ${video_id}`);

      // Generate a unique task ID
      const task_id = uuidv4();
      logger.info(`Generated task ID: ${task_id}`);

      // Register the task in the database
      logger.info("Registering task in database");
      await insertTask(task_id, video_id, video_link, model, summaryLanguage);

      // Start processing in the background
      logger.info(`Starting background processing for task ${task_id}`);
      BackgroundTasks.add(() =>
        processVideo(video_id, task_id, "gpt-4o-mini", summaryLanguage)
      );

      return res.json({ task_id });
    } catch (error: any) {
      const errorMsg = error.message;
      logger.error(`Submission error: ${errorMsg}`);
      return res.status(400).json({ error: errorMsg });
    }
  }
);
