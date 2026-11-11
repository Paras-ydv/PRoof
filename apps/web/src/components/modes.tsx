import { CircleDashed, EyeOff, Radio } from "lucide-react";
import type { SegmentOption } from "./Form";

export type Mode = "off" | "shadow" | "live";

/** Off / Shadow / Live, with the tone each one reads in. Used wherever a check's mode is set. */
export const MODE_OPTIONS: SegmentOption<Mode>[] = [
  { value: "off", label: "Off", icon: <CircleDashed />, tone: "muted", title: "Doesn't run" },
  { value: "shadow", label: "Shadow", icon: <EyeOff />, tone: "private", title: "Runs, but only maintainers see the result" },
  { value: "live", label: "Live", icon: <Radio />, tone: "pass", title: "Shown on the PR and counted in the public score" },
];
