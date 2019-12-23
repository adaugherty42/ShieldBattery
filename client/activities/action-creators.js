import { ACTIVITY_OVERLAY_OPEN, ACTIVITY_OVERLAY_CLOSE, ACTIVITY_OVERLAY_GO_BACK } from '../actions'

export function openOverlay(overlayType, initData = {}) {
  return {
    type: ACTIVITY_OVERLAY_OPEN,
    payload: {
      overlayType,
      initData,
    },
  }
}

export function closeOverlay() {
  return {
    type: ACTIVITY_OVERLAY_CLOSE,
  }
}

export function goBack() {
  return {
    type: ACTIVITY_OVERLAY_GO_BACK,
  }
}
