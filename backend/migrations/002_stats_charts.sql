CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
CREATE INDEX IF NOT EXISTS idx_play_history_track_id ON play_history(track_id);

-- kind: user | weekly_top | monthly_top | quarterly_top | yearly_top
ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'user';
