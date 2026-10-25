import actionRetrier from "@convex-dev/action-retrier/convex.config";
import { defineApp } from "convex/server";

// Components: action-retrier wraps the two Cartesia actions so a TTS/STT hiccup during a call is retried, not stuck.
const app = defineApp();
app.use(actionRetrier);
export default app;
