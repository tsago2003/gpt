import { AxiosResponse } from "axios";
import { logger } from "../logger/logger";
import { rapidApiClient } from "../apis/rapid-api.client";
import { generateSummary, updateTaskStatus } from "./tasks.services";
import { TranscriptResponse } from "../interfaces/video-request.interface";

export async function processVideo(
  videoId: string,
  taskId: string,
  modelChoice: string = "Gemini",
  summaryLanguage: string = "Spanish",
  sound: string
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
    let lengthInSeconds = "";

    // Try to extract transcript using RapidAPI
    try {
      logger.info(`Requesting transcript for video ${videoId}`);
      const response: AxiosResponse<TranscriptResponse | TranscriptResponse[]> =
        await rapidApiClient.get("", {
          params: {
            video_id: videoId,
          },
        });

      // Check if request was successful
      if (response.status === 200) {
        let data = response.data;
        console.log(data, "data");
        logger.info(
          `Response data type: ${Array.isArray(data) ? "array" : typeof data}`
        );

        // Handle array response
        if (Array.isArray(data) && data.length > 0) {
          data = data[0];
        }

        // Extract transcript text
        if (typeof data === "object" && data !== null) {
          if (data["lengthInSeconds"]) {
            lengthInSeconds = data["lengthInSeconds"];
          }
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
            summaryLanguage,
            sound
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
        lengthInSeconds: lengthInSeconds,

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
