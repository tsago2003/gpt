import {
  authenticateToken,
  getRemoteConfig,
} from "../middlewares/authmiddleware";
import express, { Request, Response, NextFunction } from "express";
import { TaskStatusResponse } from "../interfaces/task-status-response.interface";
import { logger } from "../logger/logger";
import { v4 as uuidv4 } from "uuid";
import { VideoRequest } from "../interfaces/video-request.interface";
import { TaskResponse } from "../interfaces/task-response.interface";
import { getTask, insertTask } from "../services/tasks.services";
import { BackgroundTasks } from "../functions/backgroundtasks";
import { processVideo } from "../services/video.services";
import { transcribeAudio } from "../services/audio.services";
import { processChat } from "../services/message.services";

const router = express.Router();

router.get(
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

router.post(
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
        processVideo(video_id, task_id, model, summaryLanguage, "video")
      );

      return res.json({ task_id });
    } catch (error: any) {
      const errorMsg = error.message;
      logger.error(`Submission error: ${errorMsg}`);
      return res.status(400).json({ error: errorMsg });
    }
  }
);

router.get(
  "/task_status/:task_id",
  authenticateToken,
  async (
    req: Request<{ task_id: string }>,
    res: Response<TaskStatusResponse | { error: string }>
  ): Promise<any> => {
    const task_id = req.params.task_id;

    // Get task from database
    logger.info(`Fetching status for task ${task_id}`);
    const taskInfo = await getTask(task_id);

    if (!taskInfo) {
      console.log(`Task ID not found: ${task_id}`);
      return res.status(404).json({ error: "Task ID not found" });
    }

    const status = taskInfo.status;
    logger.info(`Task ${task_id} status: ${status}`);
    const response: TaskStatusResponse = { task_id, status };

    // If the task is completed, include the summary and emoji
    if (status === "completed") {
      console.log(taskInfo, "taskinfo");
      logger.info(`Returning completed task data for ${task_id}`);
      response.transcript = taskInfo.transcript;
      response.summary = taskInfo.summary;
      response.emoji = taskInfo.emoji;
      response.title = taskInfo.title;
      response.lengthInSeconds = taskInfo.lengthinseconds;
    }
    // If the task failed, include the error message
    else if (status === "failed") {
      logger.info(
        `Returning failed task data for ${task_id}: ${taskInfo.error}`
      );
      response.error = taskInfo.error || "Unknown error";
    }

    // console.log(response, "response");

    return res.json(response);
  }
);

router.post(
  "/submit_voice",
  authenticateToken,
  async (req: Request, res: Response): Promise<any> => {
    const { audio_link, outputLanguageCode, transcriptLanguageCode } = req.body;
    if (!audio_link || !outputLanguageCode || !transcriptLanguageCode) {
      return res.status(400).json({ error: "wrong request body" });
    }
    try {
      const soundUrlMatch = audio_link.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      if (!soundUrlMatch) {
        throw new Error("Invalid YouTube URL format");
      }
      const sound_id = soundUrlMatch[1];
      const task_id = uuidv4();

      const data = await getRemoteConfig();
      const model = (data.openAiModel.defaultValue as any)?.value;
      await insertTask(
        task_id,
        sound_id,
        audio_link,
        model,
        outputLanguageCode
      );

      BackgroundTasks.add(() =>
        transcribeAudio(
          audio_link,
          task_id,
          outputLanguageCode,
          transcriptLanguageCode
        )
      );
      return res.json({ task_id });
    } catch (err) {
      return res.status(400).json(err);
    }
  }
);
router.post(
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
export default router;
