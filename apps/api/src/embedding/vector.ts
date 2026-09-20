// Vectors are stored in Postgres as raw 32-bit floats (768 numbers = 3,072 bytes), not as a list of decimal text.
// Half the space of a double per number, and a straight copy to a Float32Array when reading.

export function encodeVector(values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Float32Array.from(values).buffer);
}

export function decodeVector(bytes: Uint8Array, dimensions: number): Float32Array {
  if (bytes.byteLength !== dimensions * 4) {
    throw new Error(`A stored vector has ${bytes.byteLength / 4} numbers, expected ${dimensions}`);
  }
  // Copy into a fresh buffer: a Buffer from the database may not start on a 4-byte boundary.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}
