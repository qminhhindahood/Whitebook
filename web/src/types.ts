export type Diagnostic = {
  code: string;
  row: number | null;
  field: string | null;
  message: string;
};

export type Region = {
  id?: string;
  ordinal?: number;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confirmed: boolean;
};

export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "asset"; src: string; alt: string }
  | { kind: "region"; region: Region; alt?: string };

export type QuestionPresentation = {
  version: 1;
  stimulus: ContentBlock[];
  stem: ContentBlock[];
  choices?: { id: "A" | "B" | "C" | "D"; content: ContentBlock[] }[];
};

export type DraftQuestion = {
  presentation?: QuestionPresentation;
  index: number;
  section: string;
  module: number;
  questionNumber: number;
  responseType: "multiple_choice" | "student_produced_response";
  acceptedAnswers: string[];
  category: string | null;
  regions: Region[];
};

export type ImportDraft = {
  id: string;
  title: string;
  originalFilename: string;
  status: "invalid" | "mapping" | "published";
  editable: boolean;
  questionCount: number;
  diagnostics: Diagnostic[];
  questions: DraftQuestion[];
  mappingProgress: { confirmed: number; total: number };
  nextUnmappedQuestion: number | null;
  sourcePdfUrl: string | null;
  publishedPackageId: string | null;
};

export type PackageQuestion = {
  presentation?: QuestionPresentation;
  id: string;
  index: number;
  section: string;
  module: number;
  question_number: number;
  response_type: "multiple_choice" | "student_produced_response";
  accepted_answers: string[];
  category: string | null;
  regions: Region[];
};

export type TestPackage = {
  id: string;
  familyId: string;
  revision: number;
  title: string;
  originalFilename: string;
  questionCount: number;
  sections: string[];
  practiceEligible: boolean;
  simulationEligible: boolean;
  eligibilityReasons: string[];
  sectionExamEligible: boolean;
  sectionExamSection: string | null;
  sectionExamQuestionCount: number;
  sectionExamEligibilityReasons: string[];
  archived: boolean;
  createdAt: string;
  questions: PackageQuestion[];
  sourcePdfUrl: string;
};

export type GateStage = {
  name: string;
  status: "ready" | "loading" | "failed";
};

export type MathTool = {
  mode: "desmos" | "scientific";
  status: "ready" | "loading" | "failed";
  scriptUrl?: string;
  options?: Record<string, boolean>;
  diagnostics?: Array<{ code: string; message: string }>;
  failedCheck?: string;
};

export type AttemptGate = {
  sourcePdfUrl: string;
  questions: PackageQuestion[];
  setupId: string;
  packageId: string;
  kind: "practice" | "simulation" | "section_exam";
  selection: Record<string, unknown>;
  status: "ready" | "loading" | "failed";
  failedStage: string | null;
  allowedActions: string[];
  stages: GateStage[];
  mathTool: MathTool | null;
};

export type ReviewState = { marked: boolean; eliminatedChoices: string[] };

export type ResultQuestion = {
  presentation?: QuestionPresentation;
  id: string;
  section: string;
  module: number;
  questionNumber: number;
  category: string | null;
  responseType: string;
  learnerResponse: string | null;
  acceptedAnswers: string[];
  status: "correct" | "incorrect" | "unanswered";
  marked: boolean;
  elapsedSeconds: number;
  regions: Region[];
};

export type AttemptResult = {
  correct: number;
  incorrect: number;
  unanswered: number;
  total: number;
  percentage: number;
  elapsedSeconds: number;
  questions: ResultQuestion[];
  bySection: Record<
    string,
    { correct: number; total: number; elapsedSeconds?: number }
  >;
  byModule: Record<
    string,
    { correct: number; total: number; elapsedSeconds?: number }
  >;
  byCategory: Record<
    string,
    { correct: number; total: number; elapsedSeconds?: number }
  >;
};

export type Attempt = {
  id: string;
  packageId: string;
  kind: "practice" | "simulation" | "section_exam";
  status: "active" | "paused" | "transition" | "break" | "completed";
  plan: {
    packageId: string;
    packageTitle: string;
    packageRevision: number;
    sourcePdfUrl: string;
    selection: Record<string, unknown>;
    questions: PackageQuestion[];
    modules: Array<{
      section: string;
      module: number;
      questionIds: string[];
      durationSeconds?: number | null;
    }>;
  };
  questions: PackageQuestion[];
  currentQuestionId: string;
  activeModuleIndex: number;
  responses: Record<string, string>;
  reviewState: Record<string, ReviewState>;
  lockedModules: number[];
  elapsedSeconds: number;
  questionSeconds: Record<string, number>;
  remainingSeconds: number | null;
  breakRemainingSeconds: number | null;
  calculatorState: Record<string, unknown> | null;
  calculatorMode: "none" | "desmos" | "scientific";
  result: AttemptResult | null;
  createdAt: string;
  updatedAt: string;
};
