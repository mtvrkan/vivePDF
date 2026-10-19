import type { APIRoute, GetStaticPaths } from "astro";
import { docMarkdown, type DocSource } from "../../llms/markdown";
import { docSources } from "../../llms/sources";

export const getStaticPaths: GetStaticPaths = async () => (await docSources("tr")).map((source) => ({ params: { slug: source.doc.slug.tr }, props: { source } }));

export const GET: APIRoute = ({ props }) => new Response(`${docMarkdown((props as { source: DocSource }).source, "tr")}\n`, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
