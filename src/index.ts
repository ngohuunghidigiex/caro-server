import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { CaroRoom } from "./rooms/CaroRoom";

const PORT = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());
app.use("/colyseus", monitor());

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
