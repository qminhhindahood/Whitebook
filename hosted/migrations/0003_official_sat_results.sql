CREATE TABLE official_sat_results (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  administration_date TEXT NOT NULL,
  total_score INTEGER NOT NULL CHECK (total_score BETWEEN 400 AND 1600 AND total_score % 10 = 0),
  reading_writing_score INTEGER NOT NULL CHECK (reading_writing_score BETWEEN 200 AND 800 AND reading_writing_score % 10 = 0),
  math_score INTEGER NOT NULL CHECK (math_score BETWEEN 200 AND 800 AND math_score % 10 = 0),
  band_information_ideas INTEGER CHECK (band_information_ideas IS NULL OR (band_information_ideas BETWEEN 1 AND 7 AND band_information_ideas = CAST(band_information_ideas AS INTEGER))),
  band_craft_structure INTEGER CHECK (band_craft_structure IS NULL OR (band_craft_structure BETWEEN 1 AND 7 AND band_craft_structure = CAST(band_craft_structure AS INTEGER))),
  band_expression_of_ideas INTEGER CHECK (band_expression_of_ideas IS NULL OR (band_expression_of_ideas BETWEEN 1 AND 7 AND band_expression_of_ideas = CAST(band_expression_of_ideas AS INTEGER))),
  band_standard_english_conventions INTEGER CHECK (band_standard_english_conventions IS NULL OR (band_standard_english_conventions BETWEEN 1 AND 7 AND band_standard_english_conventions = CAST(band_standard_english_conventions AS INTEGER))),
  band_algebra INTEGER CHECK (band_algebra IS NULL OR (band_algebra BETWEEN 1 AND 7 AND band_algebra = CAST(band_algebra AS INTEGER))),
  band_advanced_math INTEGER CHECK (band_advanced_math IS NULL OR (band_advanced_math BETWEEN 1 AND 7 AND band_advanced_math = CAST(band_advanced_math AS INTEGER))),
  band_problem_solving_data_analysis INTEGER CHECK (band_problem_solving_data_analysis IS NULL OR (band_problem_solving_data_analysis BETWEEN 1 AND 7 AND band_problem_solving_data_analysis = CAST(band_problem_solving_data_analysis AS INTEGER))),
  band_geometry_trigonometry INTEGER CHECK (band_geometry_trigonometry IS NULL OR (band_geometry_trigonometry BETWEEN 1 AND 7 AND band_geometry_trigonometry = CAST(band_geometry_trigonometry AS INTEGER))),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX official_sat_results_account ON official_sat_results(account_id, administration_date);
