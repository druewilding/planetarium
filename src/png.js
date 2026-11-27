// Decoding PNG tiles by hand.

/**
 * Decode an 8-bit RGB(A) PNG into packed bytes, keeping the channels in `pick`
 * (red, green and blue by default; [3] for just the alpha). Done by hand rather
 * than via a canvas, because browsers may colour-manage canvas pixels and some
 * (Brave) add noise to them on purpose: in an elevation tile one step in red is
 * 256 m of mountain.
 */
export async function decodePNG(bytes, pick = [0, 1, 2]) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      channels = { 2: 3, 6: 4 }[colour];
      if (depth !== 8 || !channels || interlace) throw new Error("Unexpected PNG format");
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const stride = width * channels;
  if (pick.some((c) => c >= channels)) throw new Error("The PNG has no such channel");
  const n = pick.length;
  const out = new Uint8Array(width * height * n);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const filter = raw[row];
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      let v = raw[row + 1 + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const c = i >= channels ? prev[i - channels] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < n; k++) out[(y * width + x) * n + k] = cur[x * channels + pick[k]];
    }
    [prev, cur] = [cur, prev];
  }
  return out;
}
