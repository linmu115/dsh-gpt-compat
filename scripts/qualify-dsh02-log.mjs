import { zstdDecompressSync } from 'node:zlib'

// Same frame structure as the RC2 JSONL backend's zstd.ts (MIT). Unlike its
// recoverable scanner, this qualification reader rejects every incomplete tail.
function frameEnd(bytes, start) {
  const need = (offset, count) => { if (offset + count > bytes.length) throw new Error('QUALIFIER_NATIVE_FRAME_INVALID') }
  need(start, 5)
  let cursor = start + 4
  const descriptor = bytes[cursor++]
  if (descriptor & 0x18) throw new Error('QUALIFIER_NATIVE_FRAME_INVALID')
  const single = !!(descriptor & 0x20), contentSizeFlag = descriptor >>> 6, dictionaryFlag = descriptor & 3
  cursor += (single ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (single ? 1 : 0) : 1 << contentSizeFlag)
  need(cursor, 0)
  for (;;) {
    need(cursor, 3)
    const header = bytes.readUIntLE(cursor, 3); cursor += 3
    const type = (header >>> 1) & 3, size = header >>> 3
    if (type === 3 || size > 128 * 1024) throw new Error('QUALIFIER_NATIVE_FRAME_INVALID')
    const length = type === 1 ? 1 : size
    need(cursor, length); cursor += length
    if (header & 1) break
  }
  if (descriptor & 4) { need(cursor, 4); cursor += 4 }
  return cursor
}

/** Strictly consume every native concatenated frame; Node's one-shot API stops after one frame. */
export function decodeNativeFrames(bytes) {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('QUALIFIER_NATIVE_LOG_SIZE')
  const frames = []; let offset = 0, outputBytes = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 4 || bytes.readUInt32LE(offset) !== 0xfd2fb528) throw new Error('QUALIFIER_NATIVE_FRAME_MAGIC')
    const end = frameEnd(bytes, offset)
    let decoded
    try { decoded = zstdDecompressSync(bytes.subarray(offset, end), { info: true, maxOutputLength: 64 * 1024 * 1024 }) }
    catch { throw new Error('QUALIFIER_NATIVE_FRAME_INVALID') }
    const consumed = decoded.engine.bytesWritten
    if (!Number.isSafeInteger(consumed) || consumed !== end - offset) throw new Error('QUALIFIER_NATIVE_FRAME_BOUNDARY')
    outputBytes += decoded.buffer.length
    if (outputBytes > 64 * 1024 * 1024) throw new Error('QUALIFIER_NATIVE_LOG_SIZE')
    frames.push(decoded.buffer); offset += consumed
  }
  return Buffer.concat(frames)
}
