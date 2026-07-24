import { Room, Client } from "colyseus";
import { CaroState, UserSchema } from "./schema/CaroState";

const GRID_SIZE = 15;
const TURN_TIMEOUT_MS = 30000;

export class CaroRoom extends Room {
    declare state: CaroState;
    maxClients = 50;
    private timerEvent: any = null;

    onCreate(options: any) {
        this.setState(new CaroState());

        // Initialize 15x15 = 225 empty cells
        for (let i = 0; i < 225; i++) {
            this.state.board.push("");
        }

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
            if (this.checkWin(x, y, user.symbol)) {
                this.endGame(client.sessionId, user.symbol);
                return;
            }

            // Check Draw (Board full)
            if (this.state.board.every((cell) => cell !== "")) {
                this.endGame("draw", "");
                return;
            }

            // Swap Turn
            const nextTurnSessionId =
                client.sessionId === this.state.playerXSessionId
                    ? this.state.playerOSessionId
                    : this.state.playerXSessionId;

            this.state.currentTurn = nextTurnSessionId;
            this.resetTurnTimer();
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
            this.endGame(winnerSessionId, winnerUser?.symbol || "");
        });
    }

    onJoin(client: Client, options: any) {
        const user = new UserSchema();
        user.id = options.userId || client.sessionId;
        user.name = options.name || "Player";
        user.avatar = options.avatar || "";

        // Assign Roles
        if (!this.state.playerXSessionId) {
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

        // Start match when 2 players are present
        if (
            this.state.playerXSessionId &&
            this.state.playerOSessionId &&
            this.state.status === "waiting"
        ) {
            this.state.status = "playing";
            this.state.currentTurn = this.state.playerXSessionId;
            this.resetTurnTimer();
        }
    }

    onLeave(client: Client) {
        const user = this.state.players.get(client.sessionId);
        const wasPlayer = user?.role === "player";

        this.state.players.delete(client.sessionId);
        this.updateSpectatorCount();

        if (wasPlayer && this.state.status === "playing") {
            const remainingWinnerId =
                client.sessionId === this.state.playerXSessionId
                    ? this.state.playerOSessionId
                    : this.state.playerXSessionId;

            const winnerUser = this.state.players.get(remainingWinnerId);
            this.endGame(remainingWinnerId, winnerUser?.symbol || "");
        }
    }

    private updateSpectatorCount(): void {
        let count = 0;
        this.state.players.forEach((p) => {
            if (p.role === "spectator") count++;
        });
        this.state.spectatorCount = count;
    }

    private resetTurnTimer(): void {
        if (this.timerEvent) {
            this.timerEvent.clear();
        }

        this.state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

        this.timerEvent = this.clock.setTimeout(() => {
            if (this.state.status !== "playing") return;

            // Timeout forfeit -> Opposite player wins
            const loserId = this.state.currentTurn;
            const winnerId =
                loserId === this.state.playerXSessionId
                    ? this.state.playerOSessionId
                    : this.state.playerXSessionId;

            const winnerUser = this.state.players.get(winnerId);
            this.endGame(winnerId, winnerUser?.symbol || "");
        }, TURN_TIMEOUT_MS);
    }

    private endGame(winnerSessionId: string, winnerSymbol: string): void {
        if (this.timerEvent) {
            this.timerEvent.clear();
            this.timerEvent = null;
        }

        this.state.status = "ended";
        this.state.winner = winnerSessionId;
        this.state.currentTurn = "";
        this.state.turnDeadline = 0;
    }

    private checkWin(startX: number, startY: number, symbol: string): boolean {
        const board = this.state.board;
        const directions = [
            [1, 0],  // Horizontal
            [0, 1],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1], // Anti-diagonal /
        ];

        for (const [dx, dy] of directions) {
            let count = 1;

            // Positive direction
            for (let step = 1; step < 5; step++) {
                const nx = startX + dx * step;
                const ny = startY + dy * step;
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) break;
                if (board[ny * GRID_SIZE + nx] === symbol) count++;
                else break;
            }

            // Negative direction
            for (let step = 1; step < 5; step++) {
                const nx = startX - dx * step;
                const ny = startY - dy * step;
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) break;
                if (board[ny * GRID_SIZE + nx] === symbol) count++;
                else break;
            }

            if (count >= 5) return true;
        }

        return false;
    }
}
