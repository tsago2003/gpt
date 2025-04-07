import OpenAI from "openai";
import { initOpenAIClient } from "./../apis/chatgpt-api";
import { logger } from "../logger/logger";
import { getRemoteConfig } from "../middlewares/authmiddleware";

export async function processChat(
  transcriptionText: string,
  chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  newMessage: string
) {
  //   if (!openaiClient) {
  //     console.log(
  //       "OpenAI client not available. Using fallback summary generation."
  //     );
  //     return {
  //       emoji: "📝",
  //       summary: `Chat not available`,
  //     };
  //   }

  async function waitForOpenAI() {
    let retries = 10;
    const openaiClient = await initOpenAIClient();
    while (!openaiClient && retries > 0) {
      await new Promise((r) => setTimeout(r, 100));
      retries--;
    }
    if (!openaiClient) {
      throw new Error("OpenAI client failed to initialize in time");
    }
    return openaiClient;
  }

  const open = await waitForOpenAI();
  // Append the new user message to the chat history
  chatHistory.push({ role: "user", content: newMessage });

  // Add the video transcription as context (if it's the start of a new video or topic)
  const systemPrompt = `
  You are INNOVAPP's AI assistant. Your role is to:
  1. You must act like INNOVAPP LLC AI assistant .
  2. respond with new message.
  3. Answer user questions about the note topic.
  4. Engage in a discussion about the note content.
  5. You must use max_tokens: 150 for full rseponse
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
    const data = await getRemoteConfig();
    const model = (data.openAiModel.defaultValue as any)?.value;
    const response = await open.chat.completions.create({
      model: model,
      max_tokens: 150,
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
