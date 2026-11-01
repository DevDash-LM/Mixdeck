/** A strip's "Edit routing" opens the Routing view with that row highlighted. */
import { registerMixerActions } from "@/features/mixer/extensions";
import { openRouting } from "./routingStore";

registerMixerActions({ editRouting: (i) => openRouting(i) });
