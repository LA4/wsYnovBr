const joinForm = document.getElementById('join-form');
const pseudoInput = document.getElementById('pseudo');
const colorInput = document.getElementById('color');
const gridSelect = document.getElementById('grid-size');
const actionButtons = document.querySelectorAll('#action-buttons button');
const playersListEl = document.getElementById('players-list');
const gridEl = document.getElementById('grid');
const logEl = document.getElementById('log');
const gameStatusEl = document.getElementById('game-status');
const turnStatusEl = document.getElementById('turn-status');
const winnerStatusEl = document.getElementById('winner-status');

let socket;
let playerId = null;
let selectedAction = null;
let latestState = null;

const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}`;
};

const connectSocket = () => {
  socket = new WebSocket(getWsUrl());
  socket.addEventListener('open', () => {
    showLog('Connecté au serveur.');
  });
  socket.addEventListener('close', () => {
    showLog('Déconnecté du serveur. Rechargement conseillé.', 'error');
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      routeMessage(message);
    } catch (err) {
      console.error('Message non géré', err);
    }
  });
};

const routeMessage = ({ type, payload }) => {
  switch (type) {
    case 'GAME_STATE_UPDATE':
      latestState = payload;
      renderState();
      break;
    case 'ACTION_INVALID':
      showLog(payload?.message || 'Action refusée.', 'error');
      break;
    case 'JOINED_AS_PLAYER':
      playerId = payload.playerId;
      disableJoinForm();
      showLog('Inscription confirmée. En attente des autres joueurs.');
      break;
    case 'JOINED_AS_SPECTATOR':
      playerId = null;
      showLog(payload?.message || 'Vous observez la partie.');
      break;
    case 'GAME_OVER':
      if (payload?.winnerPseudo) {
        showLog(`Partie terminée. Gagnant : ${payload.winnerPseudo}`, 'success');
      } else {
        showLog('Partie terminée sans gagnant.', 'error');
      }
      break;
    default:
      break;
  }
};

const disableJoinForm = () => {
  joinForm.querySelectorAll('input, select, button').forEach((el) => {
    el.disabled = true;
  });
};

const sendMessage = (type, payload = {}) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showLog('Connexion WebSocket indisponible.', 'error');
    return;
  }
  socket.send(JSON.stringify({ type, payload }));
};

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) {
    showLog('Le pseudo est obligatoire.', 'error');
    return;
  }
  sendMessage('JOIN_GAME', {
    pseudo,
    couleur: colorInput.value,
    gridSize: Number(gridSelect.value),
  });
});

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!playerId) {
      showLog('Seuls les joueurs peuvent effectuer des actions.', 'error');
      return;
    }
    if (latestState?.gameStatus !== 'InProgress') {
      showLog('La partie doit être en cours.', 'error');
      return;
    }
    selectedAction = button.dataset.action;
    actionButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
    showLog(`Action sélectionnée : ${button.textContent}. Cliquez une case.`);
  });
});

gridEl.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || !selectedAction) return;
  if (!playerId) {
    showLog('Vous êtes spectateur.', 'error');
    return;
  }
  if (!latestState || latestState.currentPlayerTurn !== playerId) {
    showLog("Patiente jusqu'à ton tour.", 'error');
    return;
  }
  const target = {
    x: Number(cell.dataset.x),
    y: Number(cell.dataset.y),
  };
  sendMessage('REQUEST_ACTION', {
    actionType: selectedAction,
    target,
  });
});

const renderState = () => {
  if (!latestState) return;
  renderPlayers();
  renderStatus();
  renderGrid();
};

const renderPlayers = () => {
  playersListEl.innerHTML = '';
  latestState.players.forEach((player) => {
    const wrapper = document.createElement('div');
    wrapper.className = `player-item${player.status === 'Defeated' ? ' defeated' : ''}`;

    const info = document.createElement('div');
    info.className = 'player-info';

    const colorDot = document.createElement('span');
    colorDot.className = 'player-color';
    colorDot.style.backgroundColor = player.couleur;

    const name = document.createElement('span');
    name.textContent = player.pseudo;

    info.append(colorDot, name);

    const stats = document.createElement('span');
    stats.className = 'player-stats';
    stats.textContent = `PDV ${player.pdv} | Obst ${player.obstaclesRestants}`;

    if (player.id === latestState.currentPlayerTurn && latestState.gameStatus === 'InProgress') {
      stats.textContent += ' • Tour';
    }
    if (player.id === playerId) {
      name.textContent += ' (toi)';
    }

    wrapper.append(info, stats);
    playersListEl.appendChild(wrapper);
  });
};

const renderStatus = () => {
  if (!latestState) return;
  gameStatusEl.textContent = `Statut : ${latestState.gameStatus}`;
  const currentPlayer = latestState.players.find(
    (player) => player.id === latestState.currentPlayerTurn,
  );
  if (currentPlayer && latestState.gameStatus === 'InProgress') {
    turnStatusEl.textContent = `Tour de ${currentPlayer.pseudo}`;
  } else {
    turnStatusEl.textContent = '';
  }

  winnerStatusEl.textContent = latestState.winner
    ? `Gagnant : ${latestState.winner}`
    : '';
};

const renderGrid = () => {
  gridEl.innerHTML = '';
  if (!latestState) return;
  gridEl.style.setProperty('--grid-size', latestState.gridSize);

  const playersMap = new Map();
  latestState.players.forEach((player) => {
    if (player.position) {
      playersMap.set(`${player.position.x}-${player.position.y}`, player);
    }
  });

  const obstacleMap = new Map();
  latestState.obstacles.forEach((obstacle) => {
    obstacleMap.set(`${obstacle.position.x}-${obstacle.position.y}`, obstacle);
  });

  for (let y = 0; y < latestState.gridSize; y += 1) {
    for (let x = 0; x < latestState.gridSize; x += 1) {
      const key = `${x}-${y}`;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (playersMap.has(key)) {
        const occupant = playersMap.get(key);
        cell.classList.add('player');
        cell.style.backgroundColor = occupant.couleur;
        cell.textContent = occupant.pseudo[0]?.toUpperCase() ?? 'J';
        if (occupant.id === latestState.currentPlayerTurn) {
          cell.classList.add('current');
        }
        if (occupant.status === 'Defeated') {
          cell.classList.add('blocked');
        }
      } else if (obstacleMap.has(key)) {
        const obstacle = obstacleMap.get(key);
        cell.classList.add('obstacle');
        cell.textContent = obstacle.pdv;
        cell.title = `Obstacle (${obstacle.pdv} PDV)`;
      }

      gridEl.appendChild(cell);
    }
  }
};

const showLog = (message, level = 'info') => {
  if (!message) return;
  logEl.textContent = message;
  logEl.dataset.level = level;
};

connectSocket();
renderGrid();

