import { Room, Client } from "colyseus";
import { CaroState, UserSchema } from "./schema/CaroState";
import { caroRoomRegistry } from "./CaroRoomRegistry";

const GRID_SIZE = 15;
const BLITZ_INITIAL_MS = 300000; // 5 minutes

export class CaroRoom extends Room {
    declare state: CaroState;
    maxClients = 50;
    private clockInterval: any = null;
    private lastTurnTimestamp: number = 0;

    onCreate(options: any) {
        this.setState(new CaroState());

        if (options && options.roomName) {
            this.state.roomName = options.roomName;
        }
        if (options && typeof options.timeLimit === "number") {
            this.state.timeLimit = options.timeLimit;
        }

        // Initialize 15x15 = 225 empty cells
        for (let i = 0; i < 225; i++) {
            this.state.board.push("");
        }

        caroRoomRegistry.registerRoom(this.roomId, this.state.roomName, options?.name || "Player");
        this.updateRoomMetadata();

        // Start 1-second simulation clock loop for Blitz countdown
        this.clockInterval = this.setSimulationInterval(() => {
            if (this.state.status !== "playing") return;
            if (this.state.timeLimit === 0) return;

            const now = Date.now();
            const elapsed = now - (this.lastTurnTimestamp || now);
            this.lastTurnTimestamp = now;

            if (this.state.currentTurn === this.state.playerXSessionId) {
                this.state.playerXTimeRemaining = Math.max(0, this.state.playerXTimeRemaining - elapsed);
                if (this.state.playerXTimeRemaining <= 0) {
                    this.endGame(this.state.playerOSessionId, "O", "timeout");
                }
            } else if (this.state.currentTurn === this.state.playerOSessionId) {
                this.state.playerOTimeRemaining = Math.max(0, this.state.playerOTimeRemaining - elapsed);
                if (this.state.playerOTimeRemaining <= 0) {
                    this.endGame(this.state.playerXSessionId, "X", "timeout");
                }
            }
        }, 1000);

        // Handle Set Time Limit Request
        this.onMessage("set_time_limit", (client, data: { timeLimit: number }) => {
            if (this.state.status !== "waiting") return;
            const isHost = client.sessionId === this.state.playerXSessionId;
            if (!isHost) return;

            const timeLimit = typeof data?.timeLimit === "number" ? data.timeLimit : 5;
            this.state.timeLimit = timeLimit;
            this.updateRoomMetadata();
        });

        // Handle Move Message
        this.onMessage("make_move", (client, data: { x: number; y: number }) => {
            if (this.state.status !== "playing") return;
            if (this.state.currentTurn !== client.sessionId) return;

            const { x, y } = data;
            if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;

            const index = y * GRID_SIZE + x;
            if (this.state.board[index] !== "") return;

            const user = this.state.players.get(client.sessionId);
            if (!user || user.role !== "player" || !user.symbol) return;

            // Apply move
            this.state.board[index] = user.symbol;
            this.state.lastMoveX = x;
            this.state.lastMoveY = y;

            // Check Win Condition (5 in a row)
            const winLine = this.checkWin(x, y, user.symbol);
            if (winLine) {
                this.state.winningLine.clear();
                winLine.forEach((idx) => this.state.winningLine.push(idx));
                this.endGame(client.sessionId, user.symbol, "win");
                return;
            }

            // Check Draw (Board full)
            if (this.state.board.every((cell) => cell !== "")) {
                this.endGame("draw", "", "draw");
                return;
            }

            // Swap Turn
            const nextTurnSessionId =
                client.sessionId === this.state.playerXSessionId
                    ? this.state.playerOSessionId
                    : this.state.playerXSessionId;

            this.state.currentTurn = nextTurnSessionId;
            this.lastTurnTimestamp = Date.now();
        });

        // Handle Surrender Message
        this.onMessage("surrender", (client) => {
            if (this.state.status !== "playing") return;
            if (
                client.sessionId !== this.state.playerXSessionId &&
                client.sessionId !== this.state.playerOSessionId
            )
                return;

            const winnerSessionId =
                client.sessionId === this.state.playerXSessionId
                    ? this.state.playerOSessionId
                    : this.state.playerXSessionId;

            const winnerUser = this.state.players.get(winnerSessionId);
            this.endGame(winnerSessionId, winnerUser?.symbol || "", "surrender");
        });

        // Handle Rematch Request
        this.onMessage("request_rematch", (client) => {
            if (this.state.status !== "ended") return;

            if (client.sessionId === this.state.playerXSessionId) {
                this.state.playerXRematchRequested = true;
            } else if (client.sessionId === this.state.playerOSessionId) {
                this.state.playerORematchRequested = true;
            }

            // If both players requested rematch, start new match & swap sides!
            if (this.state.playerXRematchRequested && this.state.playerORematchRequested) {
                this.restartMatchWithSwappedSides();
            }
        });

        // Handle Quick Emoji Broadcast
        this.onMessage("send_reaction", (client, data: { emoji: string }) => {
            const user = this.state.players.get(client.sessionId);
            this.broadcast("reaction_received", {
                sessionId: client.sessionId,
                userName: user?.name || "Player",
                emoji: data.emoji,
            });
        });

        // Handle Swap Side Request (Host can swap starting symbol between X and O in waiting room)
        this.onMessage("swap_side", (client) => {
            if (this.state.status !== "waiting") return;
            if (
                client.sessionId !== this.state.playerXSessionId &&
                client.sessionId !== this.state.playerOSessionId
            )
                return;

            const oldX = this.state.playerXSessionId;
            const oldO = this.state.playerOSessionId;

            this.state.playerXSessionId = oldO;
            this.state.playerOSessionId = oldX;

            const userOldX = this.state.players.get(oldX);
            const userOldO = this.state.players.get(oldO);

            if (userOldX) {
                userOldX.symbol = oldX === this.state.playerXSessionId ? "X" : "O";
                userOldX.isReady = false;
            }
            if (userOldO) {
                userOldO.symbol = oldO === this.state.playerOSessionId ? "O" : "X";
                userOldO.isReady = false;
            }

            this.updateRoomMetadata();
        });

        // Handle Toggle Ready Request
        this.onMessage("toggle_ready", (client) => {
            if (this.state.status !== "waiting") return;
            const user = this.state.players.get(client.sessionId);
            if (!user) return;

            const isPlayerX = client.sessionId === this.state.playerXSessionId;
            const isPlayerO = client.sessionId === this.state.playerOSessionId;

            if (isPlayerX || isPlayerO || user.role === "player") {
                user.role = "player";
                user.isReady = !user.isReady;

                const playerXUser = this.state.playerXSessionId ? this.state.players.get(this.state.playerXSessionId) : null;
                const playerOUser = this.state.playerOSessionId ? this.state.players.get(this.state.playerOSessionId) : null;

                // Start match ONLY when both Player X & Player O have clicked Ready!
                if (
                    playerXUser &&
                    playerOUser &&
                    playerXUser.isReady &&
                    playerOUser.isReady &&
                    (this.state.status === "waiting" || this.state.status === "ended")
                ) {
                    this.startMatch();
                }
            }
        });

        // Handle Spectator Join as Player Request
        this.onMessage("join_as_player", (client, data?: { preferredSymbol?: "X" | "O" }) => {
            if (this.state.status !== "waiting") return;
            const user = this.state.players.get(client.sessionId);
            if (!user || user.role === "player") return;

            const preferredSymbol = data?.preferredSymbol || "X";

            if (preferredSymbol === "X" && !this.state.playerXSessionId) {
                this.state.playerXSessionId = client.sessionId;
                user.role = "player";
                user.symbol = "X";
                user.isReady = false;
            } else if (preferredSymbol === "O" && !this.state.playerOSessionId) {
                this.state.playerOSessionId = client.sessionId;
                user.role = "player";
                user.symbol = "O";
                user.isReady = false;
            } else if (!this.state.playerXSessionId) {
                this.state.playerXSessionId = client.sessionId;
                user.role = "player";
                user.symbol = "X";
                user.isReady = false;
            } else if (!this.state.playerOSessionId) {
                this.state.playerOSessionId = client.sessionId;
                user.role = "player";
                user.symbol = "O";
                user.isReady = false;
            }

            this.updateSpectatorCount();
            this.updateRoomMetadata();
        });

        // Handle Player Switch to Spectator Request
        this.onMessage("switch_to_spectator", (client) => {
            if (this.state.status !== "waiting") return;
            const user = this.state.players.get(client.sessionId);
            if (!user) return;

            const isPlayerX = client.sessionId === this.state.playerXSessionId;
            const isPlayerO = client.sessionId === this.state.playerOSessionId;

            if (isPlayerX) {
                this.state.playerXSessionId = "";
            }
            if (isPlayerO) {
                this.state.playerOSessionId = "";
            }

            user.role = "spectator";
            user.symbol = "";
            user.isReady = false;

            this.updateSpectatorCount();
            this.updateRoomMetadata();
        });
    }

    onJoin(client: Client, options: any) {
        const user = new UserSchema();
        user.id = options.userId || client.sessionId;
        user.name = options.name || "Player";
        user.avatar = options.avatar || "";
        user.isReady = false;

        const requestedRole = options.role || "auto";
        const preferredSymbol = options.preferredSymbol || "X";

        // Check if an existing player slot belongs to the same userId (reconnect / page refresh)
        let reconnectedSlot: "X" | "O" | null = null;
        if (options.userId && options.userId !== "guest") {
            if (this.state.playerXSessionId) {
                const playerXUser = this.state.players.get(this.state.playerXSessionId);
                if (playerXUser && playerXUser.id === options.userId) {
                    reconnectedSlot = "X";
                    this.state.players.delete(this.state.playerXSessionId);
                }
            }
            if (!reconnectedSlot && this.state.playerOSessionId) {
                const playerOUser = this.state.players.get(this.state.playerOSessionId);
                if (playerOUser && playerOUser.id === options.userId) {
                    reconnectedSlot = "O";
                    this.state.players.delete(this.state.playerOSessionId);
                }
            }
        }

        // Assign Roles
        if (reconnectedSlot === "X") {
            this.state.playerXSessionId = client.sessionId;
            user.role = "player";
            user.symbol = "X";
        } else if (reconnectedSlot === "O") {
            this.state.playerOSessionId = client.sessionId;
            user.role = "player";
            user.symbol = "O";
        } else if (requestedRole === "spectator") {
            user.role = "spectator";
            user.symbol = "";
        } else if (preferredSymbol === "O" && !this.state.playerOSessionId) {
            this.state.playerOSessionId = client.sessionId;
            user.role = "player";
            user.symbol = "O";
        } else if (!this.state.playerXSessionId) {
            this.state.playerXSessionId = client.sessionId;
            user.role = "player";
            user.symbol = "X";
        } else if (!this.state.playerOSessionId) {
            this.state.playerOSessionId = client.sessionId;
            user.role = "player";
            user.symbol = "O";
        } else {
            user.role = "spectator";
            user.symbol = "";
        }

                this.state.players.set(client.sessionId, user);
        this.updateSpectatorCount();
        this.updateRoomMetadata();
    }

    async onLeave(client: Client, code?: number) {
        const user = this.state.players.get(client.sessionId);
        const leavingSessionId = client.sessionId;

        const isPlayerXLeaving = leavingSessionId === this.state.playerXSessionId;
        const isPlayerOLeaving = leavingSessionId === this.state.playerOSessionId;
        const wasPlayer = user?.role === "player" || isPlayerXLeaving || isPlayerOLeaving;

        const isAbnormalLeave = code !== 1000;
        if (wasPlayer && this.state.status === "playing" && isAbnormalLeave) {
            try {
                // Allow 20s reconnection grace window for accidental refresh/drops
                await this.allowReconnection(client, 20);
                this.lastTurnTimestamp = Date.now();
                return;
            } catch (e) {
                // Disconnection grace window expired: forfeit game to the other player
                const winnerSessionId = isPlayerXLeaving ? this.state.playerOSessionId : this.state.playerXSessionId;
                const winnerSymbol = isPlayerXLeaving ? "O" : "X";
                if (winnerSessionId) {
                    this.endGame(winnerSessionId, winnerSymbol, "surrender");
                }
            }
        }

        // Clear player slot
        if (isPlayerXLeaving) {
            this.state.playerXSessionId = "";
        }
        if (isPlayerOLeaving) {
            this.state.playerOSessionId = "";
        }

        this.state.players.delete(client.sessionId);

        // When a player leaves at any time, return remaining player and spectators back to waiting room!
        if (wasPlayer) {
            this.state.status = "waiting";
            this.state.winner = "";
            this.state.endReason = "";
            this.state.currentTurn = "";
            this.state.playerXRematchRequested = false;
            this.state.playerORematchRequested = false;

            // Reset ready status for any remaining player
            this.state.players.forEach((p) => {
                p.isReady = false;
            });

            // Clear board
            for (let i = 0; i < 225; i++) {
                this.state.board[i] = "";
            }
        }

        this.updateSpectatorCount();
        this.updateRoomMetadata();
    }

    onDispose() {
        caroRoomRegistry.unregisterRoom(this.roomId);
    }

    private startMatch(): void {
        this.state.status = "playing";
        this.state.currentTurn = this.state.playerXSessionId;
        const initialMs = this.state.timeLimit > 0 ? this.state.timeLimit * 60 * 1000 : 0;
        this.state.playerXTimeRemaining = initialMs;
        this.state.playerOTimeRemaining = initialMs;
        this.state.lastMoveX = -1;
        this.state.lastMoveY = -1;
        this.state.winner = "";
        this.state.endReason = "";
        this.state.playerXRematchRequested = false;
        this.state.playerORematchRequested = false;
        this.state.winningLine.clear();
        this.lastTurnTimestamp = Date.now();

        // Reset ready status
        this.state.players.forEach((p) => {
            p.isReady = false;
        });

        // Clear board
        for (let i = 0; i < 225; i++) {
            this.state.board[i] = "";
        }

        this.updateRoomMetadata();
    }

    private restartMatchWithSwappedSides(): void {
        // Swap Player X & Player O session IDs
        const oldX = this.state.playerXSessionId;
        const oldO = this.state.playerOSessionId;

        this.state.playerXSessionId = oldO;
        this.state.playerOSessionId = oldX;

        // Update player schema symbols
        const userOldX = this.state.players.get(oldX);
        const userOldO = this.state.players.get(oldO);

        if (userOldX) userOldX.symbol = "O";
        if (userOldO) userOldO.symbol = "X";

        this.startMatch();
    }

    private endGame(winnerSessionId: string, winnerSymbol: string, reason: string): void {
        this.state.status = "ended";
        this.state.winner = winnerSessionId;
        this.state.endReason = reason;
        this.state.currentTurn = "";

        this.updateRoomMetadata();
    }

    private updateSpectatorCount(): void {
        let count = 0;
        this.state.players.forEach((p, sessionId) => {
            if (sessionId !== this.state.playerXSessionId && sessionId !== this.state.playerOSessionId) {
                count++;
            }
        });
        this.state.spectatorCount = count;
    }

    private updateRoomMetadata(): void {
        const hostUser = this.state.playerXSessionId
            ? this.state.players.get(this.state.playerXSessionId)
            : this.state.playerOSessionId
            ? this.state.players.get(this.state.playerOSessionId)
            : null;

        let playerCount = 0;
        if (this.state.playerXSessionId) playerCount++;
        if (this.state.playerOSessionId) playerCount++;

        const metadata = {
            roomName: this.state.roomName,
            hostName: hostUser?.name || "Player",
            playerCount,
            spectatorCount: this.state.spectatorCount,
            status: this.state.status,
            timeLimit: this.state.timeLimit,
        };
        this.setMetadata(metadata);
        caroRoomRegistry.updateRoom(this.roomId, metadata);
    }

    private checkWin(startX: number, startY: number, symbol: string): number[] | null {
        const board = this.state.board;
        const directions = [
            [1, 0],  // Horizontal
            [0, 1],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1], // Anti-diagonal /
        ];

        for (const [dx, dy] of directions) {
            const line: number[] = [startY * GRID_SIZE + startX];

            // Positive direction
            for (let step = 1; step < 5; step++) {
                const nx = startX + dx * step;
                const ny = startY + dy * step;
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) break;
                const idx = ny * GRID_SIZE + nx;
                if (board[idx] === symbol) line.push(idx);
                else break;
            }

            // Negative direction
            for (let step = 1; step < 5; step++) {
                const nx = startX - dx * step;
                const ny = startY - dy * step;
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) break;
                const idx = ny * GRID_SIZE + nx;
                if (board[idx] === symbol) line.push(idx);
                else break;
            }

            if (line.length >= 5) return line;
        }

        return null;
    }
}
