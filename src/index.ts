import http from "http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { CaroRoom } from "./rooms/CaroRoom";
import { caroRoomRegistry } from "./rooms/CaroRoomRegistry";

const PORT = Number(process.env.PORT || 2567);
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/colyseus", monitor());

// Custom room listing endpoint for instant room discovery
app.get("/api/caro-rooms", (_req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.json(caroRoomRegistry.getAllRooms());
    } catch (err) {
        console.error("[CaroServer] Error querying room listing:", err);
        res.json([]);
    }
});

const server = http.createServer(app);
const gameServer = new Server({
    transport: new WebSocketTransport({
        server,
    }),
});

// Register CaroRoom
gameServer.define("caro_room", CaroRoom);

gameServer.listen(PORT).then(() => {
    console.log(`🎮 [Standalone Caro Server] Listening on http://localhost:${PORT}`);
    console.log(`📊 [Colyseus Monitor Dashboard] http://localhost:${PORT}/colyseus`);
}).catch((err) => {
    console.error("[Standalone Caro Server] Start error:", err);
});
