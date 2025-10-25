import { createServer } from "node:net";

const PORT = Number(process.env.PORT ?? 5001);
const SEND_ACK = (process.env.SEND_ACK || "true").toLowerCase() === "true";

const server = createServer();

type ParsedPacket = {
  manufacturer: string;
  imei: string;
  type: string;
  time_hhmmss: string;
  valid: "A" | "V";
  lat: number;
  lon: number;
  speed_knots: number;
  direction_deg: number;
  raw: string;
};

function logParsed(peer: string, pkt: ParsedPacket) {
  console.log(JSON.stringify({
    lvl: "info",
    ev: "parsed",
    peer,
    imei: pkt.imei,
    lat: isFinite(pkt.lat) ? +pkt.lat.toFixed(6) : null,
    lon: isFinite(pkt.lon) ? +pkt.lon.toFixed(6) : null,
    spd_kn: pkt.speed_knots,
    dir_deg: pkt.direction_deg,
    valid: pkt.valid,
    type: pkt.type
  }));
}

function logUnparsed(peer: string, frame: string) {
  console.warn(JSON.stringify({
    lvl: "warn",
    ev: "unparsed",
    peer,
    frame
  }));
}

function logAck(peer: string, ack: string) {
  console.log(JSON.stringify({
    lvl: "info",
    ev: "ack",
    peer,
    ack
  }));
}


/** Build a simple heartbeat ACK (R12). 
 * Format: *<MFG>,<IMEI>,R12,HHMMSS#
 */
function buildAckR12(manufacturer: string | undefined, imei: string) : string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmmss = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `*${manufacturer || "HQ"},${imei},R12,${hhmmss}#`;
}

/** Convert "DDMM.mmmm" or "DDDMM.mmmm" to decimal degrees. */
function ddmmToDegrees(ddmm: string | undefined, isLon = false): number {
  if (!ddmm) return NaN;

  const [whole, frac = "0"] = ddmm.split(".");

  const degDigits = whole.length - 2;
  if (degDigits <= 0) return NaN;

  const deg = Number(whole.slice(0, degDigits));
  const minutesWhole = Number(whole.slice(degDigits));
  const minutesFrac = Number(`0.${frac}`);
  const minutes = minutesWhole + minutesFrac;

  return deg + minutes / 60;
}

function parseFrame(frame: string): ParsedPacket | null {
  if (!frame.startsWith("*") || !frame.endsWith("#")) return null;

  const body = frame.slice(1, -1);
  const parts = body.split(",").map(s => s.trim());

  const manufacturer = parts[0] ?? "HQ";
  const imei         = parts[1] ?? "";
  const type         = parts[2] ?? "";
  const hhmmss       = parts[3] ?? "";
  const valid        = (parts[4] ?? "V") as "A" | "V";
  const latStr       = parts[5];
  const latHem       = parts[6];
  const lonStr       = parts[7];
  const lonHem       = parts[8];
  const speedKnots   = parts[9];
  const directionDeg = parts[10];

  let lat = ddmmToDegrees(latStr, false);
  if (latHem === "S") lat = -lat;

  let lon = ddmmToDegrees(lonStr, true);
  if (lonHem === "W") lon = -lon;

  const speed = Number(speedKnots ?? 0);
  const direction = Number(directionDeg ?? 0);

  if (!imei) return null;

  return {
    manufacturer,
    imei,
    type,
    time_hhmmss: hhmmss,
    valid,
    lat,
    lon,
    speed_knots: speed,
    direction_deg: direction,
    raw: frame
  };
}
/**
 * Returns a per-connection function that:
 *  - appends incoming bytes to a buffer
 *  - emits complete frames whenever it finds '#'
 */
function makeFrameExtractor() {
  let buf = "";

  return (chunk: Buffer, onFrame: (frame: string) => void) => {
    buf += chunk.toString("utf8");

    let i: number;
    while ((i = buf.indexOf("#")) >= 0) {
      const frame = buf.slice(0, i + 1);
      buf = buf.slice(i + 1);
      onFrame(frame.trim());
    }
  };
}

function hardenSocket(socket: import("node:net").Socket) {
  socket.setKeepAlive(true, 30_000);
  socket.setTimeout(120_000);
  socket.on("timeout", () => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    console.warn(JSON.stringify({ lvl:"warn", ev:"timeout", peer }));
    socket.destroy();
  });
}



server.on("connection", (socket) => {
  hardenSocket(socket);
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`CONNECTED <- ${peer}`);

  const onChunk = makeFrameExtractor();

  socket.on("data", (chunk: Buffer) => {
    onChunk(chunk, (frame) => {
      const peer = `${socket.remoteAddress}:${socket.remotePort}`;
      const ts = new Date().toISOString();

      const pkt = parseFrame(frame);
      if (!pkt) {
        logUnparsed(peer, frame);
        return;
      }
      logParsed(peer, pkt);
      console.log(
        `[${ts}] PARSED (${peer}) IMEI=${pkt.imei} ` +
          `lat=${isFinite(pkt.lat) ? pkt.lat.toFixed(6) : "NaN"} ` +
          `lon=${isFinite(pkt.lon) ? pkt.lon.toFixed(6) : "NaN"} ` +
          `speed(kn)=${pkt.speed_knots} dir=${pkt.direction_deg} valid=${pkt.valid}`
      );

      if (SEND_ACK && pkt.imei) {
        const ack = buildAckR12(pkt.manufacturer, pkt.imei);
        socket.write(ack);
        logAck(peer, ack);
      }
    });
  });

  socket.on("close", () => console.log(`CLOSED   <- ${peer}`));
  socket.on("error", (e) => console.error(`ERROR (${peer})`, (e as Error).message));
});

server.listen(
  {
    host: "0.0.0.0",
    port: PORT,
    // Fly allocates both IPv4 and IPv6 addresses. Listening on 0.0.0.0 keeps the
    // server reachable from the IPv4 address and still allows IPv6 connections
    // thanks to the default dual-stack behaviour.
    // See https://fly.io/docs/about/ports-and-services/#listening-on-0-0-0-0
    ipv6Only: false
  },
  () => {
    console.log(`LISTENING on port ${PORT}`);
  }
);
