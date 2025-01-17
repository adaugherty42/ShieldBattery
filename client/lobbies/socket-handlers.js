import {
  ACTIVE_GAME_LAUNCH,
  LOBBIES_COUNT_UPDATE,
  LOBBIES_LIST_UPDATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_BAN,
  LOBBY_UPDATE_BAN_SELF,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_KICK,
  LOBBY_UPDATE_KICK_SELF,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
  LOBBY_UPDATE_SLOT_DELETED,
  LOBBY_UPDATE_STATUS,
} from '../actions'
import { MAP_STORE_DOWNLOAD_MAP, NEW_CHAT_MESSAGE } from '../../common/ipc-constants'

import { Slot } from './lobby-reducer'
import { dispatch } from '../dispatch-registry'
import { replace } from '../navigation/routing'
import rallyPointManager from '../network/rally-point-manager-instance'
import * as activeGameManagerIpc from '../active-game/active-game-manager-ipc'
import audioManager, { SOUNDS } from '../audio/audio-manager-instance'
import { getIngameLobbySlotsWithIndexes } from '../../common/lobbies'
import { openSnackbar } from '../snackbars/action-creators'
import { makeServerUrl } from '../network/server-url'
import { urlPath } from '../network/urls'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

const countdownState = {
  timer: null,
  sound: null,
  atmosphere: null,
}
function fadeAtmosphere(fast = true) {
  const { atmosphere } = countdownState
  if (atmosphere) {
    const timing = fast ? 1.5 : 3
    atmosphere.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + timing)
    atmosphere.source.stop(audioManager.currentTime + timing + 0.1)
    countdownState.atmosphere = null
  }
}
function clearCountdownTimer(leaveAtmosphere = false) {
  const { timer, sound, atmosphere } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = null
  }
  if (sound) {
    sound.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + 0.5)
    sound.source.stop(audioManager.currentTime + 0.6)
    countdownState.sound = null
  }
  if (!leaveAtmosphere && atmosphere) {
    fadeAtmosphere()
  }
}

const eventToAction = {
  init: (name, event) => {
    clearCountdownTimer()
    const { hash, mapData, mapUrl } = event.lobby.map
    ipcRenderer.invoke(MAP_STORE_DOWNLOAD_MAP, hash, mapData.format, mapUrl).catch(err => {
      // TODO(tec27): Report this to the server so the loading is canceled immediately

      // This is already logged to our file by the map store, so we just log it to the console for
      // easy visibility during development
      console.error('Error downloading map: ' + err + '\n' + err.stack)
    })
    rallyPointManager.refreshPings()

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    }
  },

  diff: (name, event) => dispatch => {
    for (const diffEvent of event.diffEvents) {
      const diffAction = eventToAction[diffEvent.type](name, diffEvent)
      if (diffAction) dispatch(diffAction)
    }
  },

  slotCreate: (name, event) => {
    if (event.slot.type === 'human') {
      audioManager.playSound(SOUNDS.JOIN_ALERT)
    }

    return {
      type: LOBBY_UPDATE_SLOT_CREATE,
      payload: event,
    }
  },

  raceChange: (name, event) => ({
    type: LOBBY_UPDATE_RACE_CHANGE,
    payload: event,
  }),

  leave: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: LOBBY_UPDATE_LEAVE_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_LEAVE,
        payload: event,
      })
    }
  },

  kick: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // We have been kicked from a lobby
      clearCountdownTimer()
      dispatch(openSnackbar({ message: 'You have been kicked from the lobby.' }))
      dispatch({
        type: LOBBY_UPDATE_KICK_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_KICK,
        payload: event,
      })
    }
  },

  ban: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // It was us who have been banned from a lobby (shame on us!)
      clearCountdownTimer()
      dispatch(openSnackbar({ message: 'You have been banned from the lobby.' }))
      dispatch({
        type: LOBBY_UPDATE_BAN_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_BAN,
        payload: event,
      })
    }
  },

  hostChange: (name, event) => ({
    type: LOBBY_UPDATE_HOST_CHANGE,
    payload: event.host,
  }),

  slotChange: (name, event) => ({
    type: LOBBY_UPDATE_SLOT_CHANGE,
    payload: event,
  }),

  slotDeleted: (name, event) => ({
    type: LOBBY_UPDATE_SLOT_DELETED,
    payload: event,
  }),

  startCountdown: (name, event, { siteSocket }) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: LOBBY_UPDATE_COUNTDOWN_START,
      payload: tick,
    })
    countdownState.sound = audioManager.playFadeableSound(SOUNDS.COUNTDOWN)
    countdownState.atmosphere = audioManager.playFadeableSound(SOUNDS.ATMOSPHERE)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: LOBBY_UPDATE_COUNTDOWN_TICK,
        payload: tick,
      })
      if (!tick) {
        clearCountdownTimer(true /* leaveAtmosphere */)
        dispatch({ type: LOBBY_UPDATE_LOADING_START })

        const { lobby } = getState()

        const currentPath = location.pathname
        if (currentPath === urlPath`/lobbies/${lobby.info.name}`) {
          replace(urlPath`/lobbies/${lobby.info.name}/loading-game`)
        }
      }
    }, 1000)
  },

  cancelCountdown: (name, event) => {
    clearCountdownTimer()
    return {
      type: LOBBY_UPDATE_COUNTDOWN_CANCELED,
    }
  },

  setupGame: (name, event) => (dispatch, getState) => {
    const {
      lobby,
      settings,
      auth: { user },
    } = getState()
    // We tack on `teamId` to each slot here so we don't have to send two different things to game
    const slots = getIngameLobbySlotsWithIndexes(lobby.info)
      .map(
        ([teamIndex, , slot]) =>
          new Slot({ ...slot.toJS(), teamId: lobby.info.teams.get(teamIndex).teamId }),
      )
      .toJS()
    const {
      info: { name: lobbyName, map, gameType, gameSubType, host },
    } = lobby
    const config = {
      localUser: user.toJS(),
      settings: settings.toJS(),
      setup: {
        gameId: event.setup.gameId,
        name: lobbyName,
        map: map.toJS(),
        gameType,
        gameSubType,
        slots,
        host: host.toJS(),
        seed: event.setup.seed,
        resultCode: event.resultCode,
        serverUrl: makeServerUrl(''),
      },
    }

    dispatch({ type: ACTIVE_GAME_LAUNCH, payload: activeGameManagerIpc.setGameConfig(config) })
  },

  setRoutes: (name, event) => dispatch => {
    const { routes, gameId } = event

    activeGameManagerIpc.setGameRoutes(gameId, routes)
  },

  startWhenReady: (name, event) => {
    const { gameId } = event

    activeGameManagerIpc.startWhenReady(gameId)
  },

  cancelLoading: (name, event) => (dispatch, getState) => {
    fadeAtmosphere()

    const { lobby } = getState()
    const currentPath = location.pathname
    if (currentPath === urlPath`/lobbies/${lobby.info.name}/loading-game`) {
      replace(urlPath`/lobbies/${lobby.info.name}`)
    }

    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: activeGameManagerIpc.setGameConfig({}),
    })
    dispatch({ type: LOBBY_UPDATE_LOADING_CANCELED })
  },

  gameStarted: (name, event) => (dispatch, getState) => {
    fadeAtmosphere(false /* fast */)

    const { lobby } = getState()

    const currentPath = location.pathname
    if (currentPath === urlPath`/lobbies/${lobby.info.name}/loading-game`) {
      replace(urlPath`/lobbies/${lobby.info.name}/active-game`)
    }
    dispatch({
      type: LOBBY_UPDATE_GAME_STARTED,
      payload: {
        lobby,
      },
    })
  },

  chat: (name, event) => {
    if (ipcRenderer) {
      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send(NEW_CHAT_MESSAGE, { user: event.from, message: event.text })
    }

    return {
      type: LOBBY_UPDATE_CHAT_MESSAGE,
      payload: event,
    }
  },

  status: (name, event) => ({
    type: LOBBY_UPDATE_STATUS,
    payload: event,
  }),
}

export default function registerModule({ siteSocket }) {
  const lobbyHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.lobby, event, { siteSocket })
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/lobbies/:lobby', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobby/:playerName', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobby/:userId/:clientId', lobbyHandler)

  siteSocket.registerRoute('/lobbies', (route, event) => {
    const { action, payload } = event
    dispatch({
      type: LOBBIES_LIST_UPDATE,
      payload: {
        message: action,
        data: payload,
      },
    })
  })

  siteSocket.registerRoute('/lobbiesCount', (route, event) => {
    const { count } = event
    dispatch({
      type: LOBBIES_COUNT_UPDATE,
      payload: {
        count,
      },
    })
  })
}
