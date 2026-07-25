import { describe, expect, it } from "vitest";
import { reduce } from "../../src/client/state";

describe("máquina de estados do player", () => {
  it("loading vai para playing quando a mídia inicia", () => {
    expect(reduce("loading", "MEDIA_PLAYING")).toBe("playing");
  });

  it("loading vai para unavailable em timeout ou erro", () => {
    expect(reduce("loading", "TIMEOUT")).toBe("unavailable");
    expect(reduce("loading", "MEDIA_ERROR")).toBe("unavailable");
  });

  it("playing vai para unavailable se a mídia falhar", () => {
    expect(reduce("playing", "MEDIA_ERROR")).toBe("unavailable");
  });

  it("playing ignora timeout atrasado", () => {
    expect(reduce("playing", "TIMEOUT")).toBe("playing");
  });

  it("unavailable volta a loading apenas com retry", () => {
    expect(reduce("unavailable", "RETRY")).toBe("loading");
    expect(reduce("unavailable", "MEDIA_PLAYING")).toBe("unavailable");
  });
});
