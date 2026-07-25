-- Núcleo de identidade, sessões, participações, canais, convites e bloqueios.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- Canal público permanente do usuário (dominio.com/<slug>).
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'offline',
  current_session_id TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- party | direct_call | personal_broadcast | random_call
  owner_user_id TEXT,
  parent_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- waiting | active | ended
  media_room_id TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX idx_sessions_type_status ON sessions(type, status);

CREATE TABLE memberships (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  can_publish_audio INTEGER NOT NULL,
  can_publish_video INTEGER NOT NULL,
  can_subscribe_media INTEGER NOT NULL,
  can_send_text INTEGER NOT NULL,
  can_moderate INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE call_invites (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  caller_user_id TEXT NOT NULL REFERENCES users(id),
  callee_user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL, -- ringing | accepted | declined | cancelled | expired | ended
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_call_invites_callee ON call_invites(callee_user_id, state);
CREATE INDEX idx_call_invites_caller ON call_invites(caller_user_id, state);

CREATE TABLE blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id),
  blocked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);
