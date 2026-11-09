import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrinterClient, printerMessage, mediaHeight } from '../printer.ts'

function fixture() {
  const calls = []
  const sdk = {
    connected: true,
    printerModel: 'M211',
    isSupplyValid: true,
    isRibbonValid: true,
    isConnected() { return this.connected },
    async showDiscoveredBleDevices() { return this.connected },
    getConnectionErrorMessage() { return 'Pairing rejected' },
    async disconnect() { this.connected = false; return true },
    async feed() { calls.push(['feed']); return true },
    async cut() { calls.push(['cut']); return true },
    setCopies(value) { calls.push(['copies', value]) },
    setCollate(value) { calls.push(['collate', value]) },
    setCutOption(value) { calls.push(['cutOption', value]) },
    async printBitmaps(images) { calls.push(['print', images]); return true },
  }
  return { sdk, calls, client: new PrinterClient(sdk) }
}
const image = { complete: true, naturalWidth: 200 }
const settings = { copies: 2, collate: true, cut: 0 }

test('submits one ordered bitmap batch with exact copies, collation, and cut settings', async () => {
  const { client, calls } = fixture()
  const images = [image, { ...image, naturalWidth: 100 }]
  await client.print(images, settings)
  assert.deepEqual(calls, [['copies', 2], ['collate', true], ['cutOption', 0], ['print', images]])
})

test('all three supported cut options are forwarded without unsupported controls', async () => {
  for (const cut of [0, 1, 2]) {
    const { client, calls } = fixture()
    await client.print([image], { ...settings, cut })
    assert.deepEqual(calls[2], ['cutOption', cut])
  }
})

test('invalid counts, cut settings, and undecoded/empty images never send a job', async () => {
  for (const copies of [0, -1, 1.5, 101, NaN]) {
    const { client, calls } = fixture()
    await assert.rejects(client.print([image], { ...settings, copies }), /Copies/)
    assert.deepEqual(calls, [])
  }
  for (const images of [[], [{ complete: false, naturalWidth: 200 }], [{ complete: true, naturalWidth: 0 }]]) {
    const { client, calls } = fixture()
    await assert.rejects(client.print(images, settings), /decoded/)
    assert.deepEqual(calls, [])
  }
  const { client, calls } = fixture()
  await assert.rejects(client.print([image], { ...settings, cut: 3 }), /Unsupported/)
  assert.deepEqual(calls, [])
})

test('disconnects and non-M211 models block print, forward feed, and cut', async () => {
  for (const changes of [{ connected: false }, { printerModel: 'M511' }, { printerModel: undefined }]) {
    const { client, calls, sdk } = fixture()
    Object.assign(sdk, changes)
    await assert.rejects(client.print([image], settings))
    await assert.rejects(client.feed())
    await assert.rejects(client.cut())
    assert.deepEqual(calls, [])
  }
})

test('default BLE validity flags do not block printing; explicit invalid media does', async () => {
  for (const property of ['isSupplyValid', 'isRibbonValid']) {
    const { client, calls, sdk } = fixture()
    sdk[property] = false
    await client.print([image], settings)
    calls.length = 0
    sdk.message = 'PrinterStatus_InvalidMedia'
    sdk.messageRemedy = 'Check cartridge'
    await assert.rejects(client.print([image], settings), /Check cartridge/)
    assert.deepEqual(calls, [])
  }
})

test('M211 continuous dimensions report tape height even with zero feed length', () => {
  assert.equal(mediaHeight('0 x 0.5'), 0.5)
  assert.equal(mediaHeight('2 x 0.75'), 0.75)
  for (const value of ['', undefined, '0 x 0', 'unknown']) assert.equal(mediaHeight(value), undefined)
})

test('SDK false returns surface errors and failed jobs are never automatically retried', async () => {
  const { client, sdk, calls } = fixture()
  sdk.printBitmaps = async () => { calls.push(['failed print']); return false }
  await assert.rejects(client.print([image], settings), /some labels may already have printed/)
  assert.equal(calls.filter(call => call[0] === 'failed print').length, 1)
  sdk.feed = async () => false
  sdk.cut = async () => false
  sdk.disconnect = async () => false
  await assert.rejects(client.feed(), /Forward feed failed/)
  await assert.rejects(client.cut(), /Cut failed/)
  await assert.rejects(client.disconnect(), /could not disconnect/)
  sdk.connected = false
  await assert.rejects(client.connect(), /Pairing rejected/)
})

test('status preserves zero values and reports only actual connected state', async () => {
  const { client, sdk } = fixture()
  sdk.batteryLevelPercentage = 0
  sdk.supplyRemainingPercentage = 0
  assert.equal(client.info.battery, '0')
  assert.equal(client.info.remaining, '0')
  await client.disconnect()
  assert.equal(client.connected, false)
})

test('initialized localization keys are not presented as errors; real/unknown messages survive', () => {
  assert.equal(printerMessage('PrinterStatus_Initialized_Title', 'PrinterStatus_Initialized',
    'PrinterStatus_Initialized_Remedy'), '')
  assert.equal(printerMessage('PrinterStatus_Initialized_Title', 'Check cartridge', 'Replace ribbon'),
    'Check cartridge - Replace ribbon')
  assert.equal(printerMessage('PrinterStatus_Jammed_Title', 'PrinterStatus_Jammed', 'PrinterStatus_Jammed_Remedy'),
    'PrinterStatus_Jammed_Title - PrinterStatus_Jammed - PrinterStatus_Jammed_Remedy')
})
