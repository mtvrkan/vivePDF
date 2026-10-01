import { usePresentationStore } from "@/shared/store/presentationStore";

export function BlackoutLayer() {
  const blackout = usePresentationStore((state) => state.blackout);
  if (blackout === "none") return null;
  return <div aria-hidden className={`presentation-blackout fixed inset-0 z-50 ${blackout === "black" ? "bg-black" : "bg-white"}`} />;
}
