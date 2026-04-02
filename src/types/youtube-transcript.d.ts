declare module "youtube-transcript" {
  export type TranscriptItem = {
    text: string;
    duration?: number;
    offset?: number;
    lang?: string;
  };

  export class YoutubeTranscript {
    static fetchTranscript(videoId: string): Promise<TranscriptItem[]>;
  }
}
