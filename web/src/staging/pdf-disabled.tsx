import type { Region } from "../types";

export function RegionCrop(_props: { region: Region; alt?: string; document: unknown }) {
  return <span role="alert">This staging question has an unsupported source region.</span>;
}
