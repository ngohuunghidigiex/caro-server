import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

export class UserSchema extends Schema {
    @type("string") declare id: string;
    @type("string") declare name: string;
    @type("string") declare avatar: string;
    @type("string") declare role: string;
    @type("string") declare symbol: string;

    constructor(id = "", name = "", avatar = "", role = "spectator", symbol = "") {
        super();
        this.id = id;
        this.name = name;
        this.avatar = avatar;
        this.role = role;
        this.symbol = symbol;
    }
}

export class CaroState extends Schema {
    @type(["string"]) declare board: ArraySchema<string>;
    @type({ map: UserSchema }) declare players: MapSchema<UserSchema>;
    @type("string") declare playerXSessionId: string;
    @type("string") declare playerOSessionId: string;
    @type("string") declare currentTurn: string;
    @type("string") declare winner: string;
    @type("string") declare status: string;
    @type("number") declare turnDeadline: number;
    @type("number") declare spectatorCount: number;
    @type("number") declare lastMoveX: number;
    @type("number") declare lastMoveY: number;

    constructor() {
        super();
        this.board = new ArraySchema<string>();
        this.players = new MapSchema<UserSchema>();
        this.playerXSessionId = "";
        this.playerOSessionId = "";
        this.currentTurn = "";
        this.winner = "";
        this.status = "waiting";
        this.turnDeadline = 0;
        this.spectatorCount = 0;
        this.lastMoveX = -1;
        this.lastMoveY = -1;
    }
}
