import type { APIRoute, GetStaticPaths } from "astro";
import { docMarkdown, type DocSource } from "../../../llms/markdown";
import { docSources } from "../../../llms/sources";

export const getStaticPaths: GetStaticPaths = async () => (await docSources("en")).map((source) => ({ params: { slug: source.doc.slug.en }, props: { source } }));

export const GET: APIRoute = ({ props }) => new Response(`${docMarkdown((props as { source: DocSource }).source, "en")}\n`, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
