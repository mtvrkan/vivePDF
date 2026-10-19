import type { APIRoute } from "astro";
import { llmsIndex } from "../llms/markdown";
import { docSources } from "../llms/sources";

export const GET: APIRoute = async () => {
  const [tr, en] = await Promise.all([docSources("tr"), docSources("en")]);
  return new Response(llmsIndex({ tr, en }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
