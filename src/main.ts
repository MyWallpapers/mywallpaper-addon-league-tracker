import type { AddonValues, CanvasAddonMountContext } from '../generated/mywallpaper-runtime'
import './styles.css'

type Layout = 'detailed' | 'compact'
type LoadState = 'configure' | 'loading' | 'ready' | 'error'

interface Settings {
  gameName: string
  tagLine: string
  platform: string
  autoRefresh: boolean
  refreshInterval: number
  layout: Layout
  accentColor: string
  textColor: string
  secondaryColor: string
  backgroundColor: string
  cornerRadius: number
  backgroundBlur: number
}

interface QueueEntry {
  queue: string
  tier: string
  division: string
  leaguePoints: number
  wins: number
  losses: number
}

interface Activity {
  state: 'in-game' | 'not-in-game'
  gameId: string | null
  gameMode: string | null
  gameType: string | null
  queueId: number | null
  mapId: number | null
  gameStartTimeMs: number | null
}

interface PlayerResponse {
  gameName: string
  tagLine: string
  platform: string
  profileIconId: number
  summonerLevel: number
  ranked: QueueEntry[]
  activity: Activity
}

const defaults: Settings = {
  gameName: '',
  tagLine: '',
  platform: 'euw1',
  autoRefresh: true,
  refreshInterval: 60,
  layout: 'detailed',
  accentColor: '#c89b3c',
  textColor: '#f5f3ea',
  secondaryColor: '#a9b2c3',
  backgroundColor: '#08111ee8',
  cornerRadius: 24,
  backgroundBlur: 18,
}

const endpoint = '/api/integrations/league-of-legends/player'

export function mount({ layer }: CanvasAddonMountContext): () => void {
  const root = element('article', 'league-tracker')
  const heading = element('header', 'league-tracker__heading')
  const mark = element('span', 'league-tracker__mark', 'L')
  const identity = element('div', 'league-tracker__identity')
  const playerName = element('strong', 'league-tracker__player', 'League Tracker')
  const playerMeta = element('span', 'league-tracker__meta', 'Configure a Riot ID')
  const status = element('span', 'league-tracker__status', 'Setup required')
  const body = element('section', 'league-tracker__body')
  identity.append(playerName, playerMeta)
  heading.append(mark, identity, status)
  root.append(heading, body)
  layer.root.replaceChildren(root)

  let settings = readSettings(layer.settings.get())
  let player: PlayerResponse | null = null
  let state: LoadState = 'configure'
  let message = 'Enter a Riot game name and tag in the add-on settings.'
  let refreshTimer = 0
  let lookupTimer = 0
  let requestGeneration = 0
  let activeRequest: AbortController | null = null
  let previousLookup = lookupKey(settings)
  let disposed = false

  const render = (): void => {
    applyAppearance(root, settings)
    root.dataset.layout = settings.layout
    root.dataset.state = state
    status.textContent = statusLabel(state, player)

    if (!player) {
      playerName.textContent = state === 'loading' ? `${settings.gameName}#${settings.tagLine}` : 'League Tracker'
      playerMeta.textContent = platformLabel(settings.platform)
      const notice = element('div', 'league-tracker__notice')
      notice.append(
        element('span', 'league-tracker__notice-symbol', state === 'error' ? '!' : 'i'),
        element('p', 'league-tracker__notice-text', message),
      )
      body.replaceChildren(notice)
      return
    }

    playerName.textContent = `${player.gameName}#${player.tagLine}`
    playerMeta.textContent = `${platformLabel(player.platform)} · Level ${player.summonerLevel}`
    const activity = element('div', 'league-tracker__activity')
    activity.append(
      element('span', 'league-tracker__activity-dot'),
      element(
        'strong',
        'league-tracker__activity-title',
        player.activity.state === 'in-game' ? 'In an active match' : 'No active match detected',
      ),
      element('span', 'league-tracker__activity-detail', activityDetail(player.activity)),
    )

    const rankings = element('div', 'league-tracker__rankings')
    const entries = settings.layout === 'compact' ? player.ranked.slice(0, 1) : player.ranked.slice(0, 3)
    if (entries.length === 0) {
      rankings.append(element('p', 'league-tracker__empty', 'No ranked queue data for this player.'))
    } else {
      for (const entry of entries) rankings.append(renderQueue(entry))
    }
    body.replaceChildren(activity, rankings)
  }

  const scheduleRefresh = (): void => {
    window.clearInterval(refreshTimer)
    refreshTimer = 0
    if (!settings.autoRefresh || !hasIdentity(settings)) return
    refreshTimer = window.setInterval(() => void load(), settings.refreshInterval * 1_000)
  }

  const load = async (): Promise<void> => {
    const currentLookup = lookupKey(settings)
    if (!hasIdentity(settings)) {
      activeRequest?.abort()
      player = null
      state = 'configure'
      message = 'Enter a Riot game name and tag in the add-on settings.'
      render()
      return
    }

    activeRequest?.abort()
    const controller = new AbortController()
    activeRequest = controller
    const generation = ++requestGeneration
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 12_000)
    state = 'loading'
    message = 'Loading the latest Riot data…'
    render()

    try {
      const query = new URLSearchParams({
        gameName: settings.gameName.trim(),
        tagLine: settings.tagLine.trim(),
        platform: settings.platform,
      })
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (generation !== requestGeneration || disposed) return
      if (!response.ok) throw new TrackerError(await errorMessage(response))
      player = parsePlayer(await response.json())
      state = 'ready'
      message = ''
    } catch (error) {
      if (generation !== requestGeneration || disposed) return
      if (error instanceof DOMException && error.name === 'AbortError' && !timedOut) return
      player = null
      state = 'error'
      message = timedOut
        ? 'League data took too long to respond. Try refreshing again.'
        : error instanceof TrackerError
          ? error.message
          : 'League data is temporarily unavailable.'
    } finally {
      window.clearTimeout(timeout)
      if (generation === requestGeneration) activeRequest = null
      if (!disposed && currentLookup === lookupKey(settings)) render()
    }
  }

  const unsubscribeSettings = layer.settings.subscribe((values) => {
    const next = readSettings(values)
    const nextLookup = lookupKey(next)
    settings = next
    render()
    scheduleRefresh()
    if (nextLookup !== previousLookup) {
      previousLookup = nextLookup
      window.clearTimeout(lookupTimer)
      lookupTimer = window.setTimeout(() => void load(), 350)
    }
  })
  const unsubscribeRefresh = layer.actions.on('refreshNow', () => void load())

  render()
  scheduleRefresh()
  void load()

  return () => {
    disposed = true
    requestGeneration += 1
    activeRequest?.abort()
    window.clearInterval(refreshTimer)
    window.clearTimeout(lookupTimer)
    unsubscribeSettings()
    unsubscribeRefresh()
    layer.root.replaceChildren()
  }
}

class TrackerError extends Error {}

function renderQueue(entry: QueueEntry): HTMLElement {
  const card = element('section', 'league-tracker__rank')
  const title = element('span', 'league-tracker__queue', queueLabel(entry.queue))
  const rank = element('strong', 'league-tracker__tier', `${titleCase(entry.tier)} ${entry.division}`.trim())
  const total = entry.wins + entry.losses
  const winRate = total > 0 ? Math.round((entry.wins / total) * 100) : 0
  const detail = element(
    'span',
    'league-tracker__rank-detail',
    `${entry.leaguePoints} LP · ${entry.wins}W ${entry.losses}L · ${winRate}%`,
  )
  card.append(title, rank, detail)
  return card
}

function activityDetail(activity: Activity): string {
  if (activity.state !== 'in-game') return 'Riot does not expose general online, offline or queue presence.'
  const parts = [activity.gameMode, activity.queueId === null ? null : `Queue ${activity.queueId}`]
  if (activity.gameStartTimeMs && activity.gameStartTimeMs > 0) {
    parts.push(`Started ${new Date(activity.gameStartTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }
  return parts.filter(Boolean).join(' · ')
}

function readSettings(values: AddonValues): Settings {
  return {
    gameName: stringValue(values.gameName, defaults.gameName),
    tagLine: stringValue(values.tagLine, defaults.tagLine),
    platform: stringValue(values.platform, defaults.platform).toLowerCase(),
    autoRefresh: booleanValue(values.autoRefresh, defaults.autoRefresh),
    refreshInterval: numberFromString(values.refreshInterval, defaults.refreshInterval),
    layout: enumValue(values.layout, ['detailed', 'compact'], defaults.layout),
    accentColor: stringValue(values.accentColor, defaults.accentColor),
    textColor: stringValue(values.textColor, defaults.textColor),
    secondaryColor: stringValue(values.secondaryColor, defaults.secondaryColor),
    backgroundColor: stringValue(values.backgroundColor, defaults.backgroundColor),
    cornerRadius: numberValue(values.cornerRadius, defaults.cornerRadius),
    backgroundBlur: numberValue(values.backgroundBlur, defaults.backgroundBlur),
  }
}

function parsePlayer(value: unknown): PlayerResponse {
  if (!isRecord(value)
    || typeof value.gameName !== 'string'
    || typeof value.tagLine !== 'string'
    || typeof value.platform !== 'string'
    || typeof value.profileIconId !== 'number'
    || typeof value.summonerLevel !== 'number'
    || !Array.isArray(value.ranked)
    || !isRecord(value.activity)
    || (value.activity.state !== 'in-game' && value.activity.state !== 'not-in-game')) {
    throw new TrackerError('The League service returned an invalid response.')
  }
  return value as unknown as PlayerResponse
}

async function errorMessage(response: Response): Promise<string> {
  let code = ''
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.code === 'string') code = payload.code
  } catch {
    // The status code remains enough to return a safe, stable message.
  }
  switch (code) {
    case 'league-player-not-found': return 'No League player matched this Riot ID on the selected platform.'
    case 'league-integration-not-configured': return 'League tracking is not configured on this MyWallpaper environment yet.'
    case 'league-upstream-rate-limited': return 'Riot is rate-limiting lookups. Wait briefly, then refresh.'
    case 'invalid-league-player-lookup': return 'Check the Riot game name, tag and selected platform.'
    default: return response.status === 404
      ? 'No League player matched this Riot ID on the selected platform.'
      : 'League data is temporarily unavailable.'
  }
}

function applyAppearance(root: HTMLElement, settings: Settings): void {
  root.style.setProperty('--league-accent', settings.accentColor)
  root.style.setProperty('--league-text', settings.textColor)
  root.style.setProperty('--league-secondary', settings.secondaryColor)
  root.style.setProperty('--league-background', settings.backgroundColor)
  root.style.setProperty('--league-radius', `${clamp(settings.cornerRadius, 0, 64)}px`)
  root.style.setProperty('--league-blur', `${clamp(settings.backgroundBlur, 0, 48)}px`)
}

function statusLabel(state: LoadState, player: PlayerResponse | null): string {
  if (state === 'loading') return 'Refreshing'
  if (state === 'error') return 'Unavailable'
  if (state === 'configure') return 'Setup required'
  return player?.activity.state === 'in-game' ? 'Live' : 'Updated'
}

function queueLabel(queue: string): string {
  if (queue === 'RANKED_SOLO_5x5') return 'Ranked Solo'
  if (queue === 'RANKED_FLEX_SR') return 'Ranked Flex'
  return queue.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (value) => value.toUpperCase())
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    br1: 'Brazil', eun1: 'Europe Nordic & East', euw1: 'Europe West', jp1: 'Japan', kr: 'Korea',
    la1: 'Latin America North', la2: 'Latin America South', na1: 'North America', oc1: 'Oceania',
    ph2: 'Philippines', ru: 'Russia', sg2: 'Singapore', th2: 'Thailand', tr1: 'Türkiye',
    tw2: 'Taiwan', vn2: 'Vietnam',
  }
  return labels[platform] ?? platform.toUpperCase()
}

function lookupKey(settings: Settings): string {
  return `${settings.gameName.trim().toLocaleLowerCase()}\u0000${settings.tagLine.trim().toLocaleLowerCase()}\u0000${settings.platform}`
}

function hasIdentity(settings: Settings): boolean {
  return settings.gameName.trim().length > 0 && settings.tagLine.trim().length > 0
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag)
  value.className = className
  if (text !== undefined) value.textContent = text
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback }
function numberValue(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function stringValue(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback }
function numberFromString(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? clamp(parsed, 30, 300) : fallback
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}
