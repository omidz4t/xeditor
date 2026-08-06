import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { applyUpdateV2, encodeStateAsUpdateV2, encodeStateVector, type Doc } from 'yjs'

export const messageYjsSyncStep1 = 0
export const messageYjsSyncStep2 = 1
export const messageYjsUpdate = 2

const writeSyncStep1 = (encoder: encoding.Encoder, doc: Doc) => {
  encoding.writeVarUint(encoder, messageYjsSyncStep1)
  encoding.writeVarUint8Array(encoder, encodeStateVector(doc))
}

const writeSyncStep2 = (
  encoder: encoding.Encoder,
  doc: Doc,
  encodedStateVector: Uint8Array,
) => {
  encoding.writeVarUint(encoder, messageYjsSyncStep2)
  encoding.writeVarUint8Array(encoder, encodeStateAsUpdateV2(doc, encodedStateVector))
}

const readSyncStep1 = (decoder: decoding.Decoder, encoder: encoding.Encoder, doc: Doc) =>
  writeSyncStep2(encoder, doc, decoding.readVarUint8Array(decoder))

const readSyncStep2 = (decoder: decoding.Decoder, doc: Doc, transactionOrigin: unknown) => {
  applyUpdateV2(doc, decoding.readVarUint8Array(decoder), transactionOrigin)
}

const readSyncMessage = (
  decoder: decoding.Decoder,
  encoder: encoding.Encoder,
  doc: Doc,
  transactionOrigin: unknown,
) => {
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case messageYjsSyncStep1:
      readSyncStep1(decoder, encoder, doc)
      break
    case messageYjsSyncStep2:
    case messageYjsUpdate:
      readSyncStep2(decoder, doc, transactionOrigin)
      break
    default:
      throw new Error('Unknown Yjs sync message type')
  }
  return messageType
}

export const encodeSyncStep1 = (doc: Doc) => {
  const encoder = encoding.createEncoder()
  writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

export const encodeSyncUpdate = (update: Uint8Array) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageYjsUpdate)
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

export const processSyncMessage = (
  doc: Doc,
  message: Uint8Array,
  transactionOrigin: unknown,
): Uint8Array | null => {
  const decoder = decoding.createDecoder(message)
  const encoder = encoding.createEncoder()
  readSyncMessage(decoder, encoder, doc, transactionOrigin)
  return encoding.length(encoder) > 0 ? encoding.toUint8Array(encoder) : null
}