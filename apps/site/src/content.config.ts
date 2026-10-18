import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { DOCS, type DocKey } from "./docs/structure";

const keys = DOCS.map((d) => d.key) as [DocKey, ...DocKey[]];

const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
  schema: z.object({
    key: z.enum(keys),
    title: z.string().min(1),
    description: z.string().min(50).max(170),
    updated: z.coerce.date(),
    faq: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).optional(),
  }),
});

export const collections = { docs };
