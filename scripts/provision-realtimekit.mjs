#!/usr/bin/env node

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const requestedAppId = process.env.REALTIMEKIT_APP_ID;
const appName = process.env.REALTIMEKIT_APP_NAME ?? "party-audience-production";
const apiBase = "https://api.cloudflare.com/client/v4";

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN são obrigatórios");
}

async function cloudflare(path, init = {}) {
  const response = await globalThis.fetch(`${apiBase}/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

const designTokens = {
  border_radius: "rounded",
  border_width: "thin",
  colors: {
    background: {
      "600": "#394150",
      "700": "#2f3745",
      "800": "#252c38",
      "900": "#1b2029",
      "1000": "#11151b",
    },
    brand: {
      "300": "#9cbcff",
      "400": "#759fff",
      "500": "#4f82ff",
      "600": "#3268e6",
      "700": "#2451b8",
    },
    danger: "#ef4444",
    success: "#22c55e",
    text: "#f8fafc",
    text_on_brand: "#ffffff",
    video_bg: "#090c10",
    warning: "#f59e0b",
  },
  spacing_base: 4,
  theme: "darkest",
};

function permissions({ moderate, publish, livestream }) {
  return {
    accept_waiting_requests: moderate,
    can_accept_production_requests: moderate,
    can_change_participant_permissions: moderate,
    can_edit_display_name: true,
    can_livestream: livestream,
    can_record: moderate,
    can_spotlight: moderate,
    chat: {
      private: { can_receive: true, can_send: true, files: false, text: true },
      public: { can_send: true, files: false, text: true },
    },
    connected_meetings: {
      can_alter_connected_meetings: moderate,
      can_switch_connected_meetings: true,
      can_switch_to_parent_meeting: true,
    },
    disable_participant_audio: moderate,
    disable_participant_screensharing: moderate,
    disable_participant_video: moderate,
    hidden_participant: false,
    is_recorder: false,
    kick_participant: moderate,
    media: {
      audio: { can_produce: publish ? "ALLOWED" : "NOT_ALLOWED" },
      screenshare: { can_produce: publish ? "ALLOWED" : "NOT_ALLOWED" },
      video: { can_produce: publish ? "ALLOWED" : "NOT_ALLOWED" },
    },
    pin_participant: moderate,
    plugins: { can_close: moderate, can_edit_config: moderate, can_start: moderate, config: {} },
    polls: { can_create: moderate, can_view: true, can_vote: true },
    recorder_type: "NONE",
    show_participant_list: true,
    waiting_room_type: "SKIP",
  };
}

function preset(name, viewType, options) {
  return {
    name,
    config: {
      max_screenshare_count: options.publish ? 4 : 0,
      max_video_streams: { desktop: 16, mobile: 8 },
      media: {
        screenshare: { frame_rate: 15, quality: "hd" },
        video: { frame_rate: 30, quality: "hd" },
        audio: { enable_high_bitrate: true, enable_stereo: false },
      },
      view_type: viewType,
    },
    permissions: permissions(options),
    ui: { config_diff: {}, design_tokens: designTokens },
  };
}

const requiredPresets = [
  preset("group-call-host", "GROUP_CALL", { moderate: true, publish: true, livestream: false }),
  preset("group-call-participant", "GROUP_CALL", { moderate: false, publish: true, livestream: false }),
  preset("livestream-host", "LIVESTREAM", { moderate: true, publish: true, livestream: true }),
  preset("livestream-viewer", "LIVESTREAM", { moderate: false, publish: false, livestream: false }),
];

const appsResponse = await cloudflare("/realtime/kit/apps");
const apps = Array.isArray(appsResponse.data) ? appsResponse.data : [];
let app = requestedAppId ? apps.find((candidate) => candidate.id === requestedAppId) : apps.find((candidate) => candidate.name === appName);

if (!app && requestedAppId) {
  throw new Error(`RealtimeKit App não encontrado: ${requestedAppId}`);
}
if (!app) {
  const created = await cloudflare("/realtime/kit/apps", {
    method: "POST",
    body: JSON.stringify({ name: appName }),
  });
  app = created.data?.app;
}
if (!app?.id) throw new Error("Cloudflare não devolveu o App ID");

const presetsResponse = await cloudflare(`/realtime/kit/${app.id}/presets`);
const existing = new Set((presetsResponse.data ?? []).map((item) => item.name));

for (const body of requiredPresets) {
  if (existing.has(body.name)) {
    console.log(`= preset ${body.name}`);
    continue;
  }
  await cloudflare(`/realtime/kit/${app.id}/presets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`+ preset ${body.name}`);
}

console.log(JSON.stringify({ appId: app.id, appName: app.name, presets: requiredPresets.map((item) => item.name) }));
