/**
 * Máquina de estados do player da TV, pura e sem DOM, para ser testável.
 *
 *   loading ──MEDIA_PLAYING──▶ playing
 *   loading ──TIMEOUT/MEDIA_ERROR──▶ unavailable
 *   playing ──MEDIA_ERROR──▶ unavailable
 *   unavailable ──RETRY──▶ loading
 */

export type PlayerState = "loading" | "playing" | "unavailable";

export type PlayerEvent = "MEDIA_PLAYING" | "MEDIA_ERROR" | "TIMEOUT" | "RETRY";

export function reduce(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (state) {
    case "loading":
      if (event === "MEDIA_PLAYING") return "playing";
      if (event === "TIMEOUT" || event === "MEDIA_ERROR") return "unavailable";
      return state;
    case "playing":
      if (event === "MEDIA_ERROR") return "unavailable";
      return state;
    case "unavailable":
      if (event === "RETRY") return "loading";
      return state;
  }
}
