export interface CaroRoomListing {
    roomId: string;
    roomName: string;
    hostName: string;
    playerCount: number;
    spectatorCount: number;
    status: string;
    timeLimit?: number;
    createdAt: number;
}

class RoomRegistryManager {
    private rooms = new Map<string, CaroRoomListing>();

    constructor() {
        setInterval(() => {
            const now = Date.now();
            for (const [id, room] of this.rooms.entries()) {
                if (now - (room.createdAt || 0) > 10 * 60 * 1000 && room.playerCount <= 0) {
                    this.rooms.delete(id);
                }
            }
        }, 60000);
    }

    registerRoom(roomId: string, name: string, hostName: string): void {
        this.rooms.set(roomId, {
            roomId,
            roomName: name || "Caro 1v1 Room",
            hostName: hostName || "Player",
            playerCount: 1,
            spectatorCount: 0,
            status: "waiting",
            createdAt: Date.now(),
        });
    }

    updateRoom(roomId: string, updates: Partial<CaroRoomListing>): void {
        const existing = this.rooms.get(roomId);
        if (existing) {
            this.rooms.set(roomId, { ...existing, ...updates });
        }
    }

    unregisterRoom(roomId: string): void {
        this.rooms.delete(roomId);
    }

    getAllRooms(): CaroRoomListing[] {
        return Array.from(this.rooms.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
}

export const caroRoomRegistry = new RoomRegistryManager();
