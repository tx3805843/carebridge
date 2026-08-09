import type { Config } from "tailwindcss";
import preset from "@carebridge/config/tailwind-preset.js";

const config: Config = {
  presets: [preset as unknown as Partial<Config>],
  content: ["./app/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
};

export default config;
