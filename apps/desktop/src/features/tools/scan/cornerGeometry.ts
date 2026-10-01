export type Corner = [number, number];
export type FrameSize = [number, number];
export type PhotoCornerState = { all: Corner[] | null; allSize?: FrameSize; frames: Record<number, Corner[]> };

export const CORNER_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
const FINE_STEP = 0.005;
const COARSE_STEP = 0.025;

export function clampCorner(point: Corner, width: number, height: number): Corner {
  return [Math.min(Math.max(point[0], 0), width - 1), Math.min(Math.max(point[1], 0), height - 1)];
}

export function pointFromClient(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, width: number, height: number): Corner {
  if (box.width <= 0 || box.height <= 0) return [0, 0];
  return clampCorner([((clientX - box.left) / box.width) * width, ((clientY - box.top) / box.height) * height], width, height);
}

export function nudgeCorner(corners: Corner[], index: number, key: string, coarse: boolean, width: number, height: number): Corner[] | null {
  if (!(CORNER_KEYS as readonly string[]).includes(key)) return null;
  const share = coarse ? COARSE_STEP : FINE_STEP;
  const stepX = Math.max(1, width * share);
  const stepY = Math.max(1, height * share);
  const [x, y] = corners[index];
  const moved: Corner =
    key === "ArrowLeft" ? [x - stepX, y] : key === "ArrowRight" ? [x + stepX, y] : key === "ArrowUp" ? [x, y - stepY] : [x, y + stepY];
  return corners.map((corner, position) => (position === index ? clampCorner(moved, width, height) : corner));
}

export function sameCorners(first: Corner[] | null, second: Corner[] | null): boolean {
  if (!first || !second) return first === second;
  return first.every((corner, index) => Math.abs(corner[0] - second[index][0]) < 0.5 && Math.abs(corner[1] - second[index][1]) < 0.5);
}

export const EMPTY_CORNER_STATE: PhotoCornerState = { all: null, frames: {} };

export function hasCorners(state: PhotoCornerState | undefined): boolean {
  return !!state && (state.all !== null || Object.keys(state.frames).length > 0);
}

export function scaleCorners(corners: Corner[], from: FrameSize, to: FrameSize): Corner[] {
  if (from[0] <= 0 || from[1] <= 0 || (from[0] === to[0] && from[1] === to[1])) return corners;
  return corners.map(([x, y]) => clampCorner([(x / from[0]) * to[0], (y / from[1]) * to[1]], to[0], to[1]));
}

function sharedCorners(state: PhotoCornerState, size?: FrameSize): Corner[] | null {
  if (!state.all || !size || !state.allSize) return state.all;
  return scaleCorners(state.all, state.allSize, size);
}

export function cornersFor(state: PhotoCornerState, frame: number, applyAll: boolean, size?: FrameSize): Corner[] | null {
  if (applyAll) return sharedCorners(state, size);
  return state.frames[frame] ?? sharedCorners(state, size);
}

export function withFrameCorners(state: PhotoCornerState, frame: number, applyAll: boolean, corners: Corner[] | null, size?: FrameSize): PhotoCornerState {
  if (applyAll) return corners && size ? { all: corners, allSize: size, frames: {} } : { all: corners, frames: {} };
  const frames = Object.fromEntries(Object.entries(state.frames).filter(([key]) => Number(key) !== frame));
  const shared = state.allSize ? { all: state.all, allSize: state.allSize } : { all: state.all };
  return { ...shared, frames: corners ? { ...frames, [frame]: corners } : frames };
}

export function withPhotoState(record: Record<string, PhotoCornerState>, path: string, state: PhotoCornerState | null): Record<string, PhotoCornerState> {
  const next = Object.fromEntries(Object.entries(record).filter(([key]) => key !== path));
  return state && hasCorners(state) ? { ...next, [path]: state } : next;
}

export function cornerParams(
  photos: string[],
  record: Record<string, PhotoCornerState>,
): { corners?: Array<Corner[] | null>; cornerSizes?: Array<FrameSize | null>; frameCorners?: Array<Array<Corner[] | null> | null> } {
  const states = photos.map((path) => record[path]);
  const corners = states.some((state) => state?.all) ? states.map((state) => state?.all ?? null) : undefined;
  const cornerSizes = states.some((state) => state?.all && state.allSize) ? states.map((state) => (state?.all && state.allSize ? state.allSize : null)) : undefined;
  const frameCorners = states.some((state) => state && Object.keys(state.frames).length > 0)
    ? states.map((state) => {
        const indices = Object.keys(state?.frames ?? {}).map(Number);
        if (!state || indices.length === 0) return null;
        return Array.from({ length: Math.max(...indices) + 1 }, (_unused, frame) => state.frames[frame] ?? null);
      })
    : undefined;
  return { corners, cornerSizes, frameCorners };
}
