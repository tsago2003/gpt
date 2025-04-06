export interface VideoRequest {
  video_link: string;
  model?: string;
  summaryLanguage?: string;
}

export interface TranscriptResponse {
  transcriptionAsText?: string;
  title?: string;
  transcription?: Array<{ subtitle?: string }>;
  [key: string]: any;
}
