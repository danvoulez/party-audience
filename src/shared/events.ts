import { z } from "zod";

/** Eventos básicos de reprodução enviados pelo cliente para POST /api/events. */
export const playbackEventSchema = z.object({
  type: z.enum(["tv_loading", "tv_playing", "tv_unavailable", "tv_unmuted", "tv_retry"]),
  mode: z.enum(["iframe", "hls", "unavailable"]),
  at: z.string().datetime(),
  detail: z.string().max(200).optional(),
});

export type PlaybackEvent = z.infer<typeof playbackEventSchema>;

export const MAX_EVENT_BODY_BYTES = 2_048;
