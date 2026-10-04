type Bridge = { zoomToSelection: () => void };

export const canvasBridge: { current: Bridge | null } = { current: null };
