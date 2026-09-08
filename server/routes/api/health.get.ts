import { defineHandler } from "nitro/h3";

export default defineHandler(() => ({
  status: "ok",
  service: "xfreedom",
  node: process.env.XF_NODE_NAME || "unknown",
  release: process.env.XF_RELEASE || "unknown",
  time: new Date().toISOString(),
}));
