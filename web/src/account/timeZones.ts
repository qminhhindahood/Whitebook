export const POPULAR_TIME_ZONES = [
  { value: "Asia/Ho_Chi_Minh", label: "Vietnam (Asia/Ho_Chi_Minh - GMT+7)" },
  { value: "Asia/Bangkok", label: "Bangkok (Asia/Bangkok - GMT+7)" },
  { value: "Asia/Singapore", label: "Singapore (Asia/Singapore - GMT+8)" },
  { value: "Asia/Tokyo", label: "Tokyo / Japan (Asia/Tokyo - GMT+9)" },
  { value: "Asia/Seoul", label: "Seoul / Korea (Asia/Seoul - GMT+9)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (Asia/Hong_Kong - GMT+8)" },
  { value: "America/New_York", label: "New York / US Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Chicago / US Central (America/Chicago)" },
  { value: "America/Denver", label: "Denver / US Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Los Angeles / US Pacific (America/Los_Angeles)" },
  { value: "Europe/London", label: "London / UK (Europe/London)" },
  { value: "Europe/Paris", label: "Paris / Central Europe (Europe/Paris)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];

export function getAllTimeZones(): string[] {
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as any).supportedValuesOf === "function") {
      return (Intl as any).supportedValuesOf("timeZone");
    }
  } catch {
    // Fallback if not supported
  }
  return POPULAR_TIME_ZONES.map(z => z.value);
}
