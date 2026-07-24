# Colyseus Caro Server

Standalone Colyseus multiplayer game server for 1v1 Caro (Gomoku) with Live Spectator Mode.

## Features

- **Server-Authoritative Match Logic**: 15x15 Gomoku grid validation & 5-in-a-row win condition checking.
- **Turn Management**: Automatic 30-second turn countdown timer with timeout forfeit.
- **Spectator Mode**: First 2 clients join as active players (X/O), 3rd+ clients join as live viewers.
- **Colyseus Monitor Dashboard**: Real-time room inspection & analytics at `/colyseus`.

## Getting Started

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

The server listens on `http://localhost:2567`.
Colyseus Monitor is accessible at `http://localhost:2567/colyseus`.
