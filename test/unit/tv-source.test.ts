import { describe, expect, it } from "vitest";
import { parseTvSource, resolvePlayback } from "../../src/shared/tv-source";

describe("parseTvSource", () => {
  it("aceita fonte HLS válida com timeout padrão", () => {
    const source = parseTvSource('{"kind":"hls","url":"https://tv.example.com/live.m3u8"}');
    expect(source).toEqual({ kind: "hls", url: "https://tv.example.com/live.m3u8", timeoutMs: 15000 });
  });

  it("aceita iframe com timeout customizado", () => {
    const source = parseTvSource(
      '{"kind":"iframe","embedUrl":"https://player.parceiro.tv/embed/canal","timeoutMs":5000}',
    );
    expect(source).toMatchObject({ kind: "iframe", timeoutMs: 5000 });
  });

  it("rejeita http:// fora de localhost", () => {
    expect(parseTvSource('{"kind":"hls","url":"http://tv.example.com/live.m3u8"}')).toBeUndefined();
  });

  it("aceita http://127.0.0.1 para dev e testes", () => {
    expect(parseTvSource('{"kind":"hls","url":"http://127.0.0.1:8787/live.m3u8"}')).toBeDefined();
  });

  it("rejeita kind desconhecido, JSON inválido, vazio e ausente", () => {
    expect(parseTvSource('{"kind":"webrtc","url":"https://x.example"}')).toBeUndefined();
    expect(parseTvSource("not json")).toBeUndefined();
    expect(parseTvSource("")).toBeUndefined();
    expect(parseTvSource(undefined)).toBeUndefined();
  });

  it("rejeita timeout fora dos limites", () => {
    expect(
      parseTvSource('{"kind":"hls","url":"https://tv.example.com/live.m3u8","timeoutMs":100}'),
    ).toBeUndefined();
  });
});

describe("resolvePlayback", () => {
  it("fonte ausente vira unavailable/unconfigured", () => {
    expect(resolvePlayback(undefined)).toEqual({ mode: "unavailable", reason: "unconfigured" });
  });

  it("dash é aceito na configuração mas fica indisponível nesta etapa", () => {
    const source = parseTvSource('{"kind":"dash","url":"https://tv.example.com/live.mpd"}');
    expect(source).toBeDefined();
    expect(resolvePlayback(source)).toEqual({ mode: "unavailable", reason: "unsupported_format" });
  });

  it("cloudflare_stream resolve para o embed iframe do Stream", () => {
    const source = parseTvSource(
      '{"kind":"cloudflare_stream","customerSubdomain":"customer-abc","videoId":"31c9291ab41f"}',
    );
    const playback = resolvePlayback(source);
    expect(playback).toMatchObject({
      mode: "iframe",
      src: "https://customer-abc.cloudflarestream.com/31c9291ab41f/iframe?muted=true&autoplay=true",
    });
  });
});
