export interface Task {
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
  lengthinseconds: string;
}

export interface TaskUpdateFields {
  status?: string;
  transcript?: string;
  summary?: string;
  emoji?: string;
  title?: string;
  error?: string;
  lengthInSeconds?: string;
}
