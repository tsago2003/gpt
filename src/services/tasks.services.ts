import { getRemoteConfig } from "../middlewares/authmiddleware";
import { initOpenAIClient } from "./../apis/chatgpt-api";
import { getDbConnection } from "../database/db.config";
import { SummaryResult } from "../interfaces/summary-result";
import { Task, TaskUpdateFields } from "../interfaces/task.interface";
import { logger } from "../logger/logger";

export async function getTask(taskId: string): Promise<Task | null> {
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

export async function insertTask(
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

export async function updateTaskStatus(
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

export async function generateSummary(
  transcriptText: string,
  summaryLanguage: string,
  sound: string
): Promise<SummaryResult> {
  const openaiClient = await initOpenAIClient();
  // Check if OpenAI client is available
  if (!openaiClient) {
    console.warn(
      "OpenAI client not available. Using fallback summary generation."
    );
    return {
      emoji: "📝",
      summary: `Summary not available - OpenAI API key not configured. Transcript length: ${transcriptText.length} characters.`,
    };
  }

  try {
    const prompt1 = `You are a voice sound summarizer. Complete the following three tasks:

    1. Summarize the entire sound transcript, providing the important points with proper sub-headings 
       in a concise manner (within 500 words).
    
    2. Choose a single emoji that best represents the main theme or topic of the audio.
    
    3. Provide a clear and relevant title for the summary (maximum 50 characters).
    
    4. Dont forget to write a title of given sound.

    Format your response as follows:
    TITLE: [your title here of voice sound - min 2 characters, max 50 characters]
    EMOJI: [single emoji here]
    
    SUMMARY:
    [your summary here with proper formatting to ${summaryLanguage} Language, don't forget to write it in ${summaryLanguage} — it's the most important thing here.]
    
    The transcript must be translated to ${summaryLanguage}.
    
    
    The transcript is: ${transcriptText}`;

    const prompt = `You are a YouTube video summarizer. Complete the following two tasks:
                    
1. Summarize the entire video transcript, providing the important points with proper sub-headings 
   in a concise manner (within ${sound == "voice" ? "250" : "500"} words).

2. Choose a single emoji that best represents the main theme or topic of the video.

Format your response as follows:
EMOJI: [single emoji here]

SUMMARY:
[your summary here with proper formatting to ${summaryLanguage} Language,  dont forget to write it in ${summaryLanguage} its the most important thing here.]

the transcript must be translated to ${summaryLanguage}

The transcript is: ${transcriptText}`;

    const data = await getRemoteConfig();
    const model = (data.openAiModel.defaultValue as any)?.value;

    const response = await openaiClient.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that summarizes ${
            sound == "video" ? "youtube" : "voice sound"
          } transcripts.`,
        },
        { role: "user", content: sound == "video" ? prompt : prompt1 },
      ],
      max_tokens: 1500,
      temperature: 0.5,
    });

    const responseText = response.choices[0]?.message?.content || "";
    console.log(responseText), "responsetext";
    let emoji = "📝";
    let summary = responseText;
    let title = "";

    try {
      const titlePart =
        responseText.split("TITLE:")[1]?.split("EMOJI:")[0]?.trim() || "";
      const emojiPart =
        responseText.split("EMOJI:")[1]?.split("SUMMARY:")[0]?.trim() || "";
      const summaryPart =
        responseText.split("SUMMARY:")[1]?.trim() || responseText;

      title = titlePart;
      emoji = emojiPart.split(/\s/)[0]; // Get first emoji only
      summary = summaryPart;

      console.log("TITLE:", title);
      console.log("EMOJI:", emoji);
      console.log("SUMMARY:", summary);
    } catch (e) {
      logger.warn("Couldn't parse summary response format");
    }

    return { emoji, summary, title };
  } catch (error: any) {
    logger.error(`Error generating summary: ${error.message}`);
    return {
      emoji: "❓",
      summary: `Error generating summary: ${error.message}`,
    };
  }
}
