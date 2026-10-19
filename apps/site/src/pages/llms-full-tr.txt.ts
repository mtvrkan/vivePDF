import type { APIRoute } from "astro";
import { llmsFull } from "../llms/markdown";
import { docSources } from "../llms/sources";

export const GET: APIRoute = async () => new Response(llmsFull("tr", await docSources("tr")), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
