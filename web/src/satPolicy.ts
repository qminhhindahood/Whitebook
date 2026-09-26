export const READING_AND_WRITING = "Reading and Writing";
export const MATH = "Math";

/** SAT policy: question count of one standard Section Module. */
export function standardModuleCount(section: string): number {
  return section === READING_AND_WRITING ? 27 : 22;
}

/** SAT policy: standard countdown for one complete Module, in seconds. */
export function standardModuleSeconds(section: string): number {
  return section === READING_AND_WRITING ? 32 * 60 : 35 * 60;
}

/** SAT policy: length of the Simulation break between Sections, in seconds. */
export const BREAK_SECONDS = 10 * 60;
