CREATE TABLE study_plan_versions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  primary_date TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (account_id, version)
);
CREATE INDEX study_plan_versions_account ON study_plan_versions(account_id, version DESC);

CREATE TABLE study_plan_tasks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES study_plan_versions(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cards', 'review', 'practice')),
  title TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 5 AND 240),
  action_json TEXT NOT NULL,
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  tentative INTEGER NOT NULL CHECK (tentative IN (0, 1)),
  explanation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'skipped')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX study_plan_tasks_version ON study_plan_tasks(account_id, version_id, scheduled_date);

CREATE TABLE study_plan_task_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES study_plan_versions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES study_plan_tasks(id) ON DELETE CASCADE,
  event_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX study_plan_events_version ON study_plan_task_events(account_id, version_id, created_at_ms);

CREATE TRIGGER study_plan_task_insert_guard BEFORE INSERT ON study_plan_tasks
BEGIN
  SELECT RAISE(ABORT, 'invalid_plan_day') WHERE NOT EXISTS (
    SELECT 1 FROM study_plan_versions v, json_each(v.settings_json, '$.studyDays') day
    WHERE v.id = NEW.version_id AND v.account_id = NEW.account_id
      AND NEW.scheduled_date < v.primary_date
      AND CAST(day.value AS INTEGER) = CAST(strftime('%w', NEW.scheduled_date) AS INTEGER)
  );
  SELECT RAISE(ABORT, 'day_full') WHERE NEW.status != 'skipped' AND
    NEW.estimated_minutes + COALESCE((SELECT SUM(t.estimated_minutes) FROM study_plan_tasks t
      WHERE t.version_id = NEW.version_id AND t.scheduled_date = NEW.scheduled_date AND t.status != 'skipped'), 0)
    > CAST((SELECT json_extract(v.settings_json, '$.dailyMinutes') FROM study_plan_versions v WHERE v.id = NEW.version_id) AS INTEGER);
END;

CREATE TRIGGER study_plan_task_update_guard BEFORE UPDATE OF scheduled_date, estimated_minutes, status ON study_plan_tasks
BEGIN
  SELECT RAISE(ABORT, 'invalid_plan_day') WHERE NOT EXISTS (
    SELECT 1 FROM study_plan_versions v, json_each(v.settings_json, '$.studyDays') day
    WHERE v.id = NEW.version_id AND v.account_id = NEW.account_id
      AND NEW.scheduled_date < v.primary_date
      AND CAST(day.value AS INTEGER) = CAST(strftime('%w', NEW.scheduled_date) AS INTEGER)
  );
  SELECT RAISE(ABORT, 'day_full') WHERE NEW.status != 'skipped' AND
    NEW.estimated_minutes + COALESCE((SELECT SUM(t.estimated_minutes) FROM study_plan_tasks t
      WHERE t.version_id = NEW.version_id AND t.scheduled_date = NEW.scheduled_date AND t.status != 'skipped' AND t.id != NEW.id), 0)
    > CAST((SELECT json_extract(v.settings_json, '$.dailyMinutes') FROM study_plan_versions v WHERE v.id = NEW.version_id) AS INTEGER);
END;
