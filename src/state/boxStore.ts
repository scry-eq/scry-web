import { create } from 'zustand';

// Multibox view (Stage 4 of ../scry-cpp/docs/MULTIBOX_PLAN.md).
// The daemon broadcasts BoxListUpdated whenever its registry of
// observed EQ clients changes; this store mirrors that for the UI
// picker. Not persisted — box identity is captured-session-scoped,
// and the daemon re-emits on every reconnect.

export interface BoxView {
  boxId:        string;
  displayName:  string;  // empty until daemon-side NamePromoter fires
  clientIp:     string;
  packetCount:  number;
  zone:         string;  // short zone name; empty until the box zones in
  level:        number;  // player level; 0 until OP_PlayerProfile decodes
}

interface BoxState {
  boxes:       BoxView[];
  activeBoxId: string;

  setBoxes: (boxes: BoxView[], activeBoxId: string) => void;
}

export const useBoxStore = create<BoxState>((set) => ({
  boxes: [],
  activeBoxId: '',
  setBoxes: (boxes, activeBoxId) => set({ boxes, activeBoxId }),
}));
