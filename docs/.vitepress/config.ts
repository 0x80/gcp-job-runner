import { defineConfig } from "vitepress";

export default defineConfig({
  title: "GCP Job Runner",
  description:
    "A schema-driven CLI job runner with Zod validation and auto-generated help",
  cleanUrls: true,
  themeConfig: {
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
          { text: "Defining Jobs", link: "/defining-jobs" },
          { text: "CLI Usage", link: "/cli-usage" },
        ],
      },
      {
        text: "Examples",
        items: [{ text: "Database Migration", link: "/migration-example" }],
      },
      {
        text: "In Depth",
        items: [
          { text: "Schema & Validation", link: "/schema-validation" },
          { text: "Help Generation", link: "/help-generation" },
          { text: "Job Discovery", link: "/job-discovery" },
          { text: "Service Integration", link: "/integration" },
          { text: "Cloud Jobs", link: "/cloud-jobs" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/0x80/gcp-job-runner" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Thijs Koerselman",
    },
  },
});
