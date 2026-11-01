/** Plugs the device pickers into the Mixer's device chips (HW strips, A1–A5). */
import { registerDevicePicker } from "@/features/mixer/extensions";
import { BusDevicePicker, StripDevicePicker } from "./DevicePicker";

registerDevicePicker("strip", StripDevicePicker);
registerDevicePicker("bus", BusDevicePicker);
