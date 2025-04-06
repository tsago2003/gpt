export interface TaskStatusResponse {
  task_id: string;
  status: string;
  transcript?: string;
  summary?: string;
  emoji?: string;
  title?: string;
  error?: string;
  lengthInSeconds?: string;
}
