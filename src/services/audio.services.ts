import axios from "axios";
import { initOpenAIClient } from "./../apis/chatgpt-api";
import path from "path";
import fs from "fs";
import { generateSummary, updateTaskStatus } from "./tasks.services";
import { logger } from "../logger/logger";

async function downloadAudioAsBuffer(audioUrl: string): Promise<Buffer> {
  const response = await axios.get(audioUrl, { responseType: "arraybuffer" });
  return Buffer.from(response.data); // Convert the response to a Buffer
}

export async function transcribeAudio(
  audioUrl: string,
  audioId: string,
  outputLanguagelanguage: string,
  inputLanguage: string
): Promise<void> {
  try {
    const openaiClient = await initOpenAIClient();
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

    let transcription;
    try {
      const options: any = {
        model: "whisper-1",
        file: audioStream,
      };

      if (inputLanguage !== "auto") {
        options.language = inputLanguage;
      }

      transcription = await openaiClient.audio.transcriptions.create(options);
    } catch (whisperError) {
      console.error("Whisper error:", whisperError);
      await updateTaskStatus(audioId, "failed", { error: whisperError });

      return;
    }

    if (transcription) {
      const summaryResult = await generateSummary(
        transcription.text,
        outputLanguagelanguage,
        "sound"
      );
      let title = `Video ${audioId}`;
      let emoji = "📝";
      emoji = summaryResult.emoji;
      await updateTaskStatus(audioId, "completed", {
        emoji: emoji,
        summary: summaryResult.summary,
        title: summaryResult.title !== "" ? summaryResult.title : title,
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
