import { Fragment, memo } from "react";
import type { StudioFinishRecipe, StudioFinishRegion, StudioFinishTexture } from "@/types/studio";
import { finishReach } from "../model/finish";
import { num } from "../model/shapes";

const INNER: Record<StudioFinishRegion, boolean> = { light: true, away: true, outerLight: false, outerAway: false };

function textureUrl(texture: StudioFinishTexture, width: number, height: number): string {
  const stops = texture.stops.map((stop) => `<stop offset="${num(stop.offset)}" stop-color="${stop.color}" stop-opacity="${num(stop.opacity)}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
    `<linearGradient id="t" gradientUnits="userSpaceOnUse" x1="${num(texture.x1)}" y1="${num(texture.y1)}" x2="${num(texture.x2)}" y2="${num(texture.y2)}">${stops}</linearGradient>` +
    `<rect width="${num(width)}" height="${num(height)}" fill="url(#t)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const FinishFilter = memo(function FinishFilter({ id, recipe, width, height }: { id: string; recipe: StudioFinishRecipe; width: number; height: number }) {
  const reach = finishReach(recipe);
  const merged: string[] = [];
  if (recipe.ink) merged.push("SourceGraphic");
  if (recipe.texture) merged.push("texture");
  const layers = [...recipe.layers].sort((a, b) => Number(INNER[a.region]) - Number(INNER[b.region]));
  layers.forEach((_, index) => merged.push(`layer${index}`));
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <filter id={id} filterUnits="userSpaceOnUse" x={-reach} y={-reach} width={width + 2 * reach} height={height + 2 * reach} colorInterpolationFilters="sRGB">
        <feOffset in="SourceAlpha" dx={num(recipe.dx)} dy={num(recipe.dy)} result="towardAway" />
        <feOffset in="SourceAlpha" dx={num(-recipe.dx)} dy={num(-recipe.dy)} result="towardLight" />
        <feComposite in="SourceAlpha" in2="towardAway" operator="out" result="light" />
        <feComposite in="SourceAlpha" in2="towardLight" operator="out" result="away" />
        <feComposite in="towardAway" in2="SourceAlpha" operator="out" result="outerAway" />
        <feComposite in="towardLight" in2="SourceAlpha" operator="out" result="outerLight" />
        {recipe.texture ? (
          <>
            <feImage href={textureUrl(recipe.texture, width, height)} x={0} y={0} width={width} height={height} preserveAspectRatio="none" result="textureImage" />
            <feComposite in="textureImage" in2="SourceAlpha" operator="in" result="texture" />
          </>
        ) : null}
        {layers.map((layer, index) => (
          <Fragment key={`${layer.region}-${index}`}>
            <feGaussianBlur in={layer.region} stdDeviation={num(layer.blur)} result={`blur${index}`} />
            <feComposite in={`blur${index}`} in2="SourceAlpha" operator={INNER[layer.region] ? "in" : "out"} result={`clip${index}`} />
            <feFlood floodColor={layer.color} floodOpacity={num(layer.opacity)} />
            <feComposite in2={`clip${index}`} operator="in" result={`layer${index}`} />
          </Fragment>
        ))}
        <feMerge>
          {merged.map((name) => (
            <feMergeNode key={name} in={name} />
          ))}
        </feMerge>
      </filter>
    </svg>
  );
});
