export interface BradySdkPort {
  showDiscoveredBleDevices(): Promise<boolean>
  isConnected(): boolean
  getConnectionErrorMessage(): string
  disconnect(): Promise<boolean>
  feed(): Promise<boolean>
  cut(): Promise<boolean>
  setCopies(copies: number): void
  setCollate(collate: boolean): void
  setCutOption(option: number): void
  printBitmaps(images: HTMLImageElement[]): Promise<boolean>
  printerName?: unknown
  printerModel?: unknown
  status?: unknown
  supplyName?: unknown
  supplyDimensions?: unknown
  zoneDimensions?: unknown
  dotsPerInch?: unknown
  batteryLevelPercentage?: unknown
  supplyRemainingPercentage?: unknown
  mediaIsDieCut?: unknown
  isSupplyValid?: unknown
  isRibbonValid?: unknown
  message?: unknown
  messageTitle?: unknown
  messageRemedy?: unknown
}

export type CutOption = 0 | 1 | 2
export interface PrintSettings {
  copies: number
  collate: boolean
  cut: CutOption
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function printerMessage(title: unknown, message: unknown, remedy: unknown) {
  const initialized = new Set([
    'PrinterStatus_Initialized_Title', 'PrinterStatus_Initialized', 'PrinterStatus_Initialized_Remedy',
  ])
  return [title, message, remedy].map(text)
    .filter(value => value && !initialized.has(value)).join(' - ')
}

export class PrinterClient {
  constructor(private readonly sdk: BradySdkPort) {}

  get connected() { return this.sdk.isConnected() }

  get info() {
    const s = this.sdk
    return {
      name: text(s.printerName),
      model: text(s.printerModel),
      status: text(s.status),
      supply: text(s.supplyName),
      dimensions: text(s.supplyDimensions),
      dpi: text(s.dotsPerInch),
      battery: text(s.batteryLevelPercentage),
      remaining: text(s.supplyRemainingPercentage),
      media: s.mediaIsDieCut === true ? 'Die-cut' : s.mediaIsDieCut === false ? 'Continuous' : '',
      // M211 reports feed length x tape width, in inches; continuous length can be zero.
      mediaHeightInches: mediaHeight(s.supplyDimensions),
      supplyValid: typeof s.isSupplyValid === 'boolean' ? s.isSupplyValid : undefined,
      ribbonValid: typeof s.isRibbonValid === 'boolean' ? s.isRibbonValid : undefined,
      error: printerMessage(s.messageTitle, s.message, s.messageRemedy),
    }
  }

  async connect() {
    if (!await this.sdk.showDiscoveredBleDevices() || !this.connected) {
      throw new Error(this.sdk.getConnectionErrorMessage() || 'Connection cancelled or failed. Try again.')
    }
  }

  private requireM211() {
    if (!this.connected) throw new Error('Connect the printer first.')
    if (this.info.model.toUpperCase() !== 'M211') {
      throw new Error(`This interface targets M211 printers; connected model: ${this.info.model || 'unknown'}.`)
    }
  }

  async disconnect() {
    if (!await this.sdk.disconnect()) throw new Error('The SDK could not disconnect the printer.')
  }

  async feed() {
    this.requireM211()
    if (!await this.sdk.feed()) throw new Error(this.info.error || 'Forward feed failed.')
  }

  async cut() {
    this.requireM211()
    if (!await this.sdk.cut()) throw new Error(this.info.error || 'Cut failed.')
  }

  async print(images: HTMLImageElement[], settings: PrintSettings) {
    this.requireM211()
    if (!images.length || images.some(image => !image.complete || !image.naturalWidth)) {
      throw new Error('All label images must be fully decoded before printing.')
    }
    if (!Number.isInteger(settings.copies) || settings.copies < 1 || settings.copies > 100) {
      throw new Error('Copies must be a whole number from 1 to 100.')
    }
    if (![0, 1, 2].includes(settings.cut)) throw new Error('Unsupported M211 cut option.')
    // BLE M211 validity flags start false and are not confirmed true by its status updates.
    // Actual MediaIsInvalid messages and SDK print failures remain authoritative.
    if (/PrinterStatus_InvalidMedia|invalid (?:supply|ribbon|media)/i.test(this.info.error)) {
      throw new Error(this.info.error)
    }

    this.sdk.setCopies(settings.copies)
    this.sdk.setCollate(settings.collate)
    this.sdk.setCutOption(settings.cut)
    if (!await this.sdk.printBitmaps(images)) {
      throw new Error(this.info.error || 'The SDK reported a print failure. Check the printer before retrying; some labels may already have printed.')
    }
  }
}

export function mediaHeight(dimensions: unknown): number | undefined {
  if (typeof dimensions !== 'string') return undefined
  const match = /^\s*\d+(?:\.\d+)?\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(dimensions)
  const height = match ? Number(match[1]) : NaN
  return Number.isFinite(height) && height > 0 ? height : undefined
}

export async function loadPrinter(onUpdate: () => void): Promise<PrinterClient> {
  const url = `${import.meta.env.BASE_URL}brady-sdk/bundle.js`
  const module: { default: new (callback: () => void, analytics: boolean) => BradySdkPort } =
    await import(/* @vite-ignore */ url)
  return new PrinterClient(new module.default(onUpdate, false))
}
