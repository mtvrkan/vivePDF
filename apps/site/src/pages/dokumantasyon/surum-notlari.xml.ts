import type { APIRoute } from "astro";
import { releaseFeed } from "../../feeds/releases";

export const GET: APIRoute = () => new Response(releaseFeed("tr"), { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
