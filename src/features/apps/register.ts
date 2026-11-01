/**
 * Plugs the apps feature into the Mixer slots and Settings. One import line in
 * `app/routes.ts` loads this file; no strip, bus or settings component is edited.
 */
import { registerBusSource, registerStripApps, registerStripSource } from "@/features/mixer/extensions";
import { registerSettingsSection } from "@/features/settings/sections";
import { StripApps } from "./AppList";
import AppsSection from "./AppsSection";
import { EndpointCard } from "./EndpointCard";
import { ListeningApps } from "./ListeningApps";

registerStripSource("virtual", EndpointCard);
registerStripApps("virtual", StripApps);
registerBusSource("virtual", ListeningApps);
registerSettingsSection({ id: "apps", title: "Apps", component: AppsSection, order: 40 });
