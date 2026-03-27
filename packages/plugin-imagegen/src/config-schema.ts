import type { ConfigSchema } from "./types.js";

export const imagegenConfigSchema: ConfigSchema = {
  title: "Image Generation",
  description: "Configure AI image generation settings",
  fields: [
    {
      name: "defaultModel",
      type: "select",
      label: "Default Model",
      options: [
        { value: "flux", label: "Flux" },
        { value: "sdxl", label: "SDXL" },
        { value: "dall-e", label: "DALL-E" },
      ],
      default: "flux",
      description: "Default model for /imagine when --model is not specified",
    },
    {
      name: "defaultSize",
      type: "select",
      label: "Default Size",
      options: [
        { value: "512x512", label: "512x512" },
        { value: "768x768", label: "768x768" },
        { value: "1024x1024", label: "1024x1024" },
        { value: "1024x768", label: "1024x768 (landscape)" },
        { value: "768x1024", label: "768x1024 (portrait)" },
      ],
      default: "1024x1024",
      description: "Default image dimensions when --size is not specified",
    },
    {
      name: "defaultStyle",
      type: "select",
      label: "Default Style",
      options: [
        { value: "auto", label: "Auto" },
        { value: "photorealistic", label: "Photorealistic" },
        { value: "artistic", label: "Artistic" },
        { value: "anime", label: "Anime" },
        { value: "pixel-art", label: "Pixel Art" },
      ],
      default: "auto",
      description: "Default style preset when --style is not specified",
    },
    {
      name: "maxPromptLength",
      type: "number",
      label: "Max Prompt Length",
      default: 1000,
      description: "Maximum character length for image prompts (safety limit)",
    },
  ],
};
