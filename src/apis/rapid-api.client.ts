import axios, { AxiosInstance } from "axios";
interface RapidApiConfig {
  key: string;
  host: string;
  transcriptApiUrl: string;
}
const rapidApiConfig: RapidApiConfig = {
  key:
    process.env.RAPIDAPI_KEY ||
    "802f09a86bmsh843f97e5c979abcp12042cjsnbe227ac79309",
  host: process.env.RAPIDAPI_HOST || "youtube-transcriptor.p.rapidapi.com",
  transcriptApiUrl: "https://youtube-transcriptor.p.rapidapi.com/transcript",
};

export const rapidApiClient: AxiosInstance = axios.create({
  baseURL: rapidApiConfig.transcriptApiUrl,
  headers: {
    "X-RapidAPI-Key": rapidApiConfig.key,
    "X-RapidAPI-Host": rapidApiConfig.host,
  },
});
