/** Call before awaiting network work, while the learner's click is still active. */
export async function requestExamFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  try {
    if (!document.documentElement.requestFullscreen) return false;
    await document.documentElement.requestFullscreen();
    return true;
  } catch { return false; }
}
