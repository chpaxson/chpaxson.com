import { reactive, watch } from 'vue'

export type TimestampFormat = 'time' | 'time-ms' | 'iso' | 'unix'
export interface GlobalSettings {
  numColumns: number
  bufferSize: number
  tsFormat: TimestampFormat
  darkMode: boolean
}

export function defaultColumnSettings(index: number) {
  return {
    label: `Port ${index + 1}`,
    baud: 9600,
    dataBits: 8 as 7 | 8,
    stopBits: 1 as 1 | 2,
    parity: 'none' as 'none' | 'even' | 'odd',
    flowControl: 'none' as 'none' | 'hardware',
    sendCR: false,
    sendLF: true,
    hexEscape: false,
    keyEscape: false,
    showTimestamps: true,
    showOutgoing: true,
    showMsgNum: false,
    logMetadata: true,
    logIncludeBuffered: false,
    optionsOpen: false,
    autoScroll: true,
    hexView: false,
    hexViewWidth: 170,
  }
}
export type ColumnSettings = ReturnType<typeof defaultColumnSettings>

export function boundedInteger(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function savedSettings<T extends object>(
  name: string,
  defaults: T,
  validate: (settings: T) => void,
  report: (message: string) => void,
) {
  const settings = { ...defaults }
  try {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
    if (cookie) {
      const saved: unknown = JSON.parse(decodeURIComponent(cookie.slice(name.length + 1)))
      if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
        throw new Error('Expected a settings object')
      }
      for (const key of Object.keys(defaults) as (keyof T)[]) {
        if (key in saved) {
          const value = saved[key as keyof typeof saved]
          if (typeof value !== typeof defaults[key]) throw new Error(`Invalid setting: ${String(key)}`)
          Object.assign(settings, { [key]: value })
        }
      }
    }
    validate(settings)
  } catch (error) {
    report(`Could not restore ${name}; using defaults. ${errorMessage(error)}`)
    Object.assign(settings, defaults)
  }
  const state = reactive(settings)
  watch(state, () => {
    try {
      const value = encodeURIComponent(JSON.stringify(state))
      document.cookie = `${name}=${value};max-age=34560000;path=/;SameSite=Lax`
      if (!document.cookie.split('; ').includes(`${name}=${value}`)) {
        throw new Error('Cookies are blocked or full')
      }
    } catch (error) {
      report(`Could not save preferences. ${errorMessage(error)}`)
    }
  })
  return state
}

export function validateGlobal(settings: GlobalSettings) {
  settings.numColumns = boundedInteger(settings.numColumns, 1, 8, 2)
  settings.bufferSize = boundedInteger(settings.bufferSize, 10, 20000, 500)
  if (!['time', 'time-ms', 'iso', 'unix'].includes(settings.tsFormat)) {
    throw new Error('Invalid timestamp format')
  }
}

export function validateColumn(settings: ColumnSettings) {
  if (!Number.isInteger(settings.baud) || settings.baud < 1 ||
      ![7, 8].includes(settings.dataBits) || ![1, 2].includes(settings.stopBits) ||
      !['none', 'even', 'odd'].includes(settings.parity) ||
      !['none', 'hardware'].includes(settings.flowControl)) {
    throw new Error('Invalid port settings')
  }
  settings.hexViewWidth = boundedInteger(settings.hexViewWidth, 80, 2000, 170)
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
