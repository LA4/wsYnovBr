const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const {
  GameStateManager,
  MAX_PLAYERS,
  ALLOWED_GRID_SIZES,
} = require("./gameState");

const PORT = process.env.PORT || 3000;

const app = express();
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const game = new GameStateManager();
const clients = new Map(); // ws -> { type: 'player'|'spectator', playerId? }

const stringify = (type, payload) => JSON.stringify({ type, payload });

const send = (ws, type, payload) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(stringify(type, payload));
  }
};

const broadcast = (type, payload) => {
  const message = stringify(type, payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const broadcastGameState = () => {
  broadcast("GAME_STATE_UPDATE", game.getSnapshot());
  if (game.state.gameStatus === "Finished") {
    broadcast("GAME_OVER", { winnerPseudo: game.state.winner });
  }
};

const parseGridSize = (value) => {
  const parsed = parseInt(value, 10);
  return ALLOWED_GRID_SIZES.includes(parsed) ? parsed : null;
};

wss.on("connection", (ws) => {
  clients.set(ws, { type: "spectator" });
  send(ws, "GAME_STATE_UPDATE", game.getSnapshot());

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      send(ws, "ACTION_INVALID", { message: "Message JSON invalide." });
      return;
    }
    const { type, payload } = message;
    switch (type) {
      case "JOIN_GAME":
        handleJoin(ws, payload);
        break;
      case "REQUEST_ACTION":
        handleRequestAction(ws, payload);
        break;
      case "RESET_GAME":
        handleResetGame(ws);
        break;
      default:
        send(ws, "ACTION_INVALID", { message: "Type de message inconnu." });
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
    clients.delete(ws);
  });
});

const handleJoin = (ws, payload = {}) => {
  const clientMeta = clients.get(ws);
  if (clientMeta.type === "player") {
    send(ws, "ACTION_INVALID", { message: "Joueur déjà inscrit." });
    return;
  }

  if (
    game.state.players.length >= MAX_PLAYERS ||
    game.state.gameStatus !== "Lobby"
  ) {
    send(ws, "JOINED_AS_SPECTATOR", {
      message: "Partie complète ou en cours, vous êtes spectateur.",
    });
    return;
  }

  try {
    const player = game.addPlayer({
      pseudo: payload.pseudo,
      color: payload.couleur || payload.color,
      gridSizeOverride: parseGridSize(payload.gridSize),
    });
    clients.set(ws, { type: "player", playerId: player.id });
    send(ws, "JOINED_AS_PLAYER", { playerId: player.id });
    broadcastGameState();
  } catch (error) {
    send(ws, "ACTION_INVALID", { message: error.message });
  }
};

const handleRequestAction = (ws, payload = {}) => {
  const clientMeta = clients.get(ws);
  if (!clientMeta || clientMeta.type !== "player") {
    send(ws, "ACTION_INVALID", { message: "Spectateurs non autorisés." });
    return;
  }
  const { playerId } = clientMeta;
  if (game.state.gameStatus !== "InProgress") {
    send(ws, "ACTION_INVALID", { message: "La partie doit être en cours." });
    return;
  }
  if (game.state.currentPlayerTurn !== playerId) {
    send(ws, "ACTION_INVALID", { message: "Ce n'est pas votre tour." });
    return;
  }

  try {
    switch (payload.actionType) {
      case "MOVE":
        game.executeMove(playerId, payload.target);
        break;
      case "ATTACK":
        game.executeAttack(playerId, payload.target);
        break;
      case "PLACE_OBSTACLE":
        game.executePlaceObstacle(playerId, payload.target);
        break;
      default:
        throw new Error("Action inconnue.");
    }
    broadcastGameState();
  } catch (error) {
    send(ws, "ACTION_INVALID", { message: error.message });
  }
};

const handleResetGame = (ws) => {
  if (game.state.gameStatus !== "Finished") {
    send(ws, "ACTION_INVALID", {
      message: "La partie n'est pas terminée.",
    });
    return;
  }

  game.resetGame();

  clients.forEach((meta, clientWs) => {
    clients.set(clientWs, { type: "spectator" });
    send(clientWs, "GAME_RESET", {
      message: "Nouvelle partie disponible. Rejoignez le lobby.",
    });
  });

  broadcastGameState();
};

const handleDisconnect = (ws) => {
  const meta = clients.get(ws);
  if (!meta || meta.type !== "player") return;
  game.removePlayer(meta.playerId);
  broadcastGameState();
};

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
