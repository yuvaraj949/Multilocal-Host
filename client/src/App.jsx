import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';
import Quiz from './games/Quiz';
import MrWhite from './games/MrWhite';
import Imposter from './games/Imposter';
import GoKart from './games/GoKart';
import Ludo from './games/Ludo';
import SnakeLadders from './games/SnakeLadders';
import Uno from './games/Uno';

const backendHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
const SERVER_URL = `http://${backendHost}:3000`;
const socket = io(SERVER_URL);

// Load saved username from localStorage
const savedName = localStorage.getItem('arcade_username') || '';
// Read room code from URL param: ?room=XXXX
const urlRoom = new URLSearchParams(window.location.search).get('room') || '';

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [username, setUsername] = useState(savedName);
  const [roomCode, setRoomCode] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState(urlRoom);
  const [roomState, setRoomState] = useState(null);
  const [errorLine, setErrorLine] = useState('');
  const [startError, setStartError] = useState('');
  const [networkIp, setNetworkIp] = useState(null);

  // Fetch network IP for QR code
  useEffect(() => {
    fetch(`${SERVER_URL}/api/ip`)
      .then(r => r.json())
      .then(d => setNetworkIp(d.ips?.[0] || null))
      .catch(() => { });
  }, []);

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => { setIsConnected(false); setRoomState(null); });
    socket.on('room_update', (roomData) => { setRoomState(roomData); setStartError(''); });
    socket.on('start_error', ({ error }) => setStartError(error));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room_update');
      socket.off('start_error');
    };
  }, []);

  // Persist username
  useEffect(() => {
    if (username.trim()) localStorage.setItem('arcade_username', username.trim());
  }, [username]);

  const handleCreateRoom = (gameType) => {
    if (!username.trim()) return setErrorLine('Please enter a nickname first.');
    setErrorLine('');
    socket.emit('create_room', { username: username.trim(), gameType }, (res) => {
      if (res.success) setRoomCode(res.roomCode);
      else setErrorLine('Failed to create room.');
    });
  };

  const handleJoinRoom = (code) => {
    const target = (code || inputRoomCode).trim().toUpperCase();
    if (!username.trim()) return setErrorLine('Please enter a nickname first.');
    if (!target) return setErrorLine('Please enter a room code.');
    setErrorLine('');
    socket.emit('join_room', { username: username.trim(), roomCode: target }, (res) => {
      if (res.success) setRoomCode(res.roomCode);
      else setErrorLine(res.error || 'Failed to join room.');
    });
  };

  const handleLeaveRoom = () => {
    socket.emit('leave_room');
    setRoomCode('');
    setRoomState(null);
    // Clean URL
    window.history.replaceState({}, '', '/');
  };

  const handleChangeGame = (newGame) => {
    if (roomCode) socket.emit('change_game', { roomCode, gameType: newGame });
  };

  // ── Connecting screen ──
  if (!isConnected) {
    return (
      <div className="app-container">
        <div className="glass-card loading">
          <h2>Connecting to Game Server...</h2>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  // ── In Room - LOBBY ──
  if (roomCode && roomState?.state === 'lobby') {
    const isHost = roomState.players.find(p => p.id === socket.id)?.isHost;
    // Build join URL for QR code
    const qrHost = networkIp || window.location.hostname;
    const qrPort = window.location.port ? `:${window.location.port}` : '';
    const joinUrl = `http://${qrHost}${qrPort}/?room=${roomCode}`;

    return (
      <div className="app-container">
        <header className="room-header">
          <h2>Room: <span className="highlight-text">{roomCode}</span></h2>
          <button className="btn-secondary" onClick={handleLeaveRoom}>Leave</button>
        </header>

        <main className="room-main">
          <section className="glass-card players-card">
            <h3>Players ({roomState.players.length}/{20})</h3>
            <ul className="player-list">
              {roomState.players.map(p => (
                <li key={p.id} className={p.id === socket.id ? 'me' : ''}>
                  {p.isHost && <span className="host-badge">👑</span>}
                  {p.name} {p.id === socket.id && '(You)'}
                </li>
              ))}
            </ul>
          </section>

          {/* QR Code for sharing */}
          <section className="glass-card qr-card">
            <h3>📱 Invite Friends</h3>
            <p style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: 8 }}>Scan to join on the same Wi-Fi</p>
            <div className="qr-wrapper">
              <QRCodeSVG value={joinUrl} size={160} bgColor="transparent" fgColor="#f8fafc" level="M" />
            </div>
            <p className="highlight-text" style={{ fontSize: '1.4em', fontWeight: 700, letterSpacing: 6, marginTop: 8 }}>{roomCode}</p>
            <p style={{ fontSize: '0.7em', opacity: 0.5, marginTop: 4, wordBreak: 'break-all' }}>{joinUrl}</p>
          </section>

          <section className="glass-card game-card">
            <h3>Game</h3>
            {isHost ? (
              <div className="game-selector">
                <select value={roomState.game} onChange={(e) => handleChangeGame(e.target.value)} className="premium-input">
                  <option value="quiz">🎯 Quiz</option>
                  <option value="mrwhite">🕵️ Mr. White</option>
                  <option value="imposter">👾 Imposter</option>
                  <option value="gokart">🏎️ Go Kart</option>
                  <option value="ludo">🔵 Ludo</option>
                  <option value="snakeladders">🐍 Snake &amp; Ladders</option>
                  <option value="uno">🃏 UNO</option>
                </select>
              </div>
            ) : (
              <div className="selected-game-display">
                <span className="game-badge">{roomState.game.toUpperCase()}</span>
              </div>
            )}

            {/* Game instructions */}
            <Instructions game={roomState.game} />

            <div className="start-game-container">
              {isHost ? (() => {
                const MIN = { quiz: 2, mrwhite: 3, imposter: 3, gokart: 2, ludo: 2, snakeladders: 2 };
                const minNeeded = MIN[roomState.game] ?? 2;
                const tooFew = roomState.players.length < minNeeded;
                return (
                  <>
                    {tooFew && (
                      <p className="min-players-warning">
                        ⚠️ Need at least {minNeeded} players for this game (currently {roomState.players.length})
                      </p>
                    )}
                    {startError && <p className="error-text">{startError}</p>}
                    <button
                      className="btn-primary start-btn"
                      disabled={tooFew}
                      style={tooFew ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                      onClick={() => socket.emit('start_game', roomCode)}
                    >
                      Start Game 🚀
                    </button>
                  </>
                );
              })() : (
                <p className="waiting-text">Waiting for host to start...</p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ── In Game ──
  if (roomCode && roomState && (roomState.state === 'playing' || roomState.state === 'finished')) {
    const handleReturnLobby = () => socket.emit('return_to_lobby', { roomCode });

    if (roomState.game === 'quiz') {
      return <div className="app-container"><Quiz roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'mrwhite') {
      return <div className="app-container"><MrWhite roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'imposter') {
      return <div className="app-container"><Imposter roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'gokart') {
      return <div className="app-container"><GoKart roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'ludo') {
      return <div className="app-container"><Ludo roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'snakeladders') {
      return <div className="app-container"><SnakeLadders roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else if (roomState.game === 'uno') {
      return <div className="app-container"><Uno roomState={roomState} socket={socket} roomCode={roomCode} onReturnLobby={handleReturnLobby} /></div>;
    } else {
      return (
        <div className="app-container">
          <div className="glass-card">
            <h2>{roomState.game.toUpperCase()} 🚧 Coming Soon</h2>
            <p style={{ opacity: 0.7 }}>This game is under construction!</p>
            {roomState.players.find(p => p.id === socket.id)?.isHost && (
              <button className="btn-secondary" style={{ marginTop: 16 }} onClick={handleReturnLobby}>Return to Lobby</button>
            )}
          </div>
        </div>
      );
    }
  }

  // ── Main Lobby (Pre-room) ──
  return (
    <div className="app-container">
      <div className="glass-card lobby-card">
        <h1 className="title">Arcade <span className="highlight-text">Hub</span></h1>
        <p style={{ opacity: 0.6, fontSize: '0.9em', marginBottom: 16 }}>Play party games with friends on the same Wi-Fi</p>

        {errorLine && <p className="error-text">{errorLine}</p>}

        <div className="input-group">
          <label>Your Nickname</label>
          <input
            type="text"
            placeholder="e.g. Yuvaraj"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="premium-input"
            maxLength={12}
          />
        </div>

        <div className="lobby-actions">
          <div className="action-box">
            <h3>🎮 Host a Game</h3>
            <p>Create a new room for your friends</p>
            <button className="btn-primary" onClick={() => handleCreateRoom('quiz')}>Create Room</button>
          </div>

          <div className="divider"><span>OR</span></div>

          <div className="action-box">
            <h3>🚀 Join a Room</h3>
            <input
              type="text"
              placeholder="4-Letter Code"
              value={inputRoomCode}
              onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
              className="premium-input code-input"
              maxLength={4}
            />
            <button className="btn-secondary" onClick={() => handleJoinRoom()}>Join Room</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Game Instructions ──
const INSTRUCTIONS = {
  quiz: [
    '🎯 All players answer the same multiple-choice questions.',
    '✅ +100 points for each correct answer.',
    '⚡ Answer first — everyone must submit before moving on.',
    '🏆 Most points after 7 questions wins!'
  ],
  mrwhite: [
    "🕵️ One player is secretly Mr. White — they don't know the word!",
    '💬 Each player describes the secret word without saying it directly.',
    '🗳️ After discussion, vote for who you think Mr. White is.',
    '🔄 If wrong player voted out, game continues. Mr. White wins if only 2 left.'
  ],
  imposter: [
    '👾 One player is secretly the Imposter.',
    '🌙 Night: Imposter picks someone to eliminate.',
    '☀️ Day: Everyone discusses and votes to eject the Imposter.',
    '🎯 Crewmates win by ejecting the Imposter. Imposter wins if ≤2 left.'
  ],
  gokart: [
    '🏎️ Up to 20 players race around a track — 3 laps to win!',
    '📱 Tilt your phone left/right to steer (or use on-screen buttons).',
    '🔴 Hold GAS to accelerate — let go to slow down.',
    '🏆 First to complete 3 laps wins the race!'
  ],
  ludo: [
    '🎲 Players take turns rolling the dice.',
    '🟡 Roll a 6 to bring a token out of the home yard.',
    '🟠 Move tokens around the 52-cell board — land on opponents to send them back!',
    '🏆 First to get all 4 tokens home wins!'
  ],
  snakeladders: [
    '🎲 Up to 20 players take turns rolling the dice.',
    '🐍 Land on a snake\'s head — you slide down!',
    '🪜 Land on a ladder\'s bottom — you climb up!',
    '🏁 Race to reach cell 100 first to win!'
  ],
  uno: [
    '🃏 Match the color or number of the top card on the discard pile.',
    '🎯 Use Action cards (Skip, Reverse, Draw Two) to mess with opponents.',
    '🌈 Play Wild cards to change the current color.',
    '⚠️ Call UNO when you have exactly TWO cards (before playing your second to last card) otherwise you risk drawing if penalized. But for this simplified version, just try to get rid of all your cards first!',
    '🏆 First player to empty their hand wins!'
  ],
};

function Instructions({ game }) {
  const [open, setOpen] = useState(false);
  const lines = INSTRUCTIONS[game] || [];
  return (
    <div className="instructions-box">
      <button className="instructions-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▲' : '▼'} How to Play
      </button>
      {open && (
        <ul className="instructions-list">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

export default App;
