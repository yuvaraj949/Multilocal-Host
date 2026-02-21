import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { networkInterfaces } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve static React client files in production
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('/health', (req, res) => res.json({ status: 'Platform Server Running' }));

// Return local network IPs so clients can generate correct QR codes
app.get('/api/ip', (req, res) => {
    const nets = networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        }
    }
    res.json({ ips });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const rooms = {};
const MAX_PLAYERS = 20;

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// Build speaking order: Mr. White never first OR last
function generateSpeakingOrder(playerIds, mrWhiteId) {
    const others = playerIds.filter(id => id !== mrWhiteId).sort(() => Math.random() - 0.5);
    if (others.length >= 2) {
        // Random position between 1st and 2nd-to-last (inclusive)
        const insertPos = Math.floor(Math.random() * (others.length - 1)) + 1;
        others.splice(insertPos, 0, mrWhiteId);
    } else {
        // Edge case: only 2 players total, can't avoid edges
        others.push(mrWhiteId);
    }
    return others;
}

io.on('connection', (socket) => {
    console.log(`[+] User connected: ${socket.id}`);

    // ─── Create Room ───
    socket.on('create_room', (data, callback) => {
        const { username, gameType } = data;
        let roomCode = generateRoomCode();
        while (rooms[roomCode]) roomCode = generateRoomCode();

        rooms[roomCode] = {
            game: gameType || 'quiz',
            players: [{ id: socket.id, name: username, isHost: true, score: 0 }],
            state: 'lobby',
            gameState: null
        };

        socket.join(roomCode);
        console.log(`[Room] ${username} created room ${roomCode} (${gameType})`);
        if (callback) callback({ success: true, roomCode });
        io.to(roomCode).emit('room_update', rooms[roomCode]);
    });

    // ─── Join Room ───
    socket.on('join_room', (data, callback) => {
        const { username, roomCode } = data;
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) return callback?.({ success: false, error: 'Room not found' });
        if (room.state !== 'lobby') return callback?.({ success: false, error: 'Game already started' });
        if (room.players.length >= MAX_PLAYERS) return callback?.({ success: false, error: `Room is full (max ${MAX_PLAYERS})` });
        if (room.players.find(p => p.name === username)) return callback?.({ success: false, error: 'Username already taken' });

        room.players.push({ id: socket.id, name: username, isHost: false, score: 0 });
        socket.join(code);
        console.log(`[Room] ${username} joined room ${code}`);
        callback?.({ success: true, roomCode: code, game: room.game });
        io.to(code).emit('room_update', room);
    });

    // ─── Change Game (Host only, Lobby only) ───
    socket.on('change_game', (data) => {
        const { roomCode, gameType } = data;
        const room = rooms[roomCode];
        if (room?.state === 'lobby') {
            const player = room.players.find(p => p.id === socket.id);
            if (player?.isHost) {
                room.game = gameType;
                io.to(roomCode).emit('room_update', room);
            }
        }
    });

    // ─── Start Game ───
    socket.on('start_game', async (roomCode) => {
        console.log(`[Game] start_game for: ${roomCode}`);
        const room = rooms[roomCode];
        if (!room || room.state !== 'lobby') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;

        const MIN_PLAYERS = { quiz: 2, mrwhite: 3, imposter: 3, gokart: 2, ludo: 2, snakeladders: 2, uno: 2 };
        const minRequired = MIN_PLAYERS[room.game] ?? 2;
        if (room.players.length < minRequired) {
            socket.emit('start_error', { error: `Need at least ${minRequired} players to start ${room.game === 'mrwhite' ? 'Mr. White' : room.game}.` });
            return;
        }

        room.state = 'playing';

        // ── QUIZ ──
        if (room.game === 'quiz') {
            let questions = [];
            try {
                const res = await fetch('https://opentdb.com/api.php?amount=7&type=multiple');
                const data = await res.json();
                if (data.response_code !== 0) throw new Error('API error ' + data.response_code);
                const decode = (s) => s
                    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&ldquo;/g, '"')
                    .replace(/&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&laquo;/g, '«')
                    .replace(/&raquo;/g, '»').replace(/&eacute;/g, 'é').replace(/&ouml;/g, 'ö')
                    .replace(/&uuml;/g, 'ü').replace(/&szlig;/g, 'ß').replace(/&rsquo;/g, "'");
                questions = data.results.map(q => {
                    const correct = decode(q.correct_answer);
                    const opts = [...q.incorrect_answers.map(decode), correct].sort(() => Math.random() - 0.5);
                    return { question: decode(q.question), options: opts, answer: opts.indexOf(correct) };
                }).slice(0, 7);
                console.log(`[Quiz] Fetched ${questions.length} questions from Open Trivia DB`);
            } catch (err) {
                console.error('[Quiz] Falling back to local questions:', err.message);
                questions = [
                    { question: 'What is the capital of France?', options: ['Madrid', 'Paris', 'Berlin', 'Rome'], answer: 1 },
                    { question: 'How many continents are there?', options: ['5', '6', '7', '8'], answer: 2 },
                    { question: 'What is 12 × 12?', options: ['124', '144', '132', '148'], answer: 1 },
                    { question: 'Who painted the Mona Lisa?', options: ['Michelangelo', 'Raphael', 'Da Vinci', 'Van Gogh'], answer: 2 },
                    { question: 'What does HTML stand for?', options: ['HyperText Markup Language', 'High-Tech Modern Language', 'HyperTransfer Method Link', 'HyperText Modern Layout'], answer: 0 },
                    { question: 'Which planet is closest to the Sun?', options: ['Venus', 'Earth', 'Mercury', 'Mars'], answer: 2 },
                    { question: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], answer: 1 },
                ];
            }
            room.gameState = { questions, currentQuestion: 0, answersThisRound: {}, scores: {} };
            room.players.forEach(p => room.gameState.scores[p.id] = 0);
        }

        // ── MR. WHITE ──
        else if (room.game === 'mrwhite') {
            const words = ['Apple', 'Banana', 'Car', 'Laptop', 'Ocean', 'Mountain', 'Guitar', 'Piano',
                'Coffee', 'Sun', 'Clock', 'Bridge', 'Cloud', 'Library', 'Diamond', 'Penguin',
                'Volcano', 'Umbrella', 'Castle', 'Submarine', 'Telescope', 'Cactus', 'Anchor'];
            const secretWord = words[Math.floor(Math.random() * words.length)];
            const mrWhiteIndex = Math.floor(Math.random() * room.players.length);
            const mrWhiteId = room.players[mrWhiteIndex].id;
            const playerIds = room.players.map(p => p.id);
            const speakingOrder = generateSpeakingOrder(playerIds, mrWhiteId);

            room.gameState = {
                phase: 'discussion',
                round: 1,
                speakingOrder,
                currentSpeakerIndex: 0,
                activePlayers: [...playerIds],
                eliminatedPlayers: [],
                votes: {},
                mrWhiteId,
                secretWord,
                lastEliminated: null,
                tied: false,
                winner: null
            };

            room.players.forEach((p, idx) => {
                const isMW = idx === mrWhiteIndex;
                io.to(p.id).emit('secret_role', { role: isMW ? 'mrwhite' : 'civilian', word: isMW ? '???' : secretWord });
            });
        }

        // ── IMPOSTER ──
        else if (room.game === 'imposter') {
            const imposterIndex = Math.floor(Math.random() * room.players.length);
            room.gameState = {
                phase: 'night',
                deadPlayers: [],
                votes: {},
                imposterId: room.players[imposterIndex].id,
                lastKilled: null
            };
            room.players.forEach((p, idx) => {
                io.to(p.id).emit('secret_role', { role: idx === imposterIndex ? 'imposter' : 'crewmate' });
            });
        }

        // ── GO KART ──
        else if (room.game === 'gokart') {
            room.gameState = {
                totalLaps: 3,
                positions: {},   // { playerId: { progress:0, angle:0, laps:0, x:0, y:0 } }
                finishOrder: [], // playerIds in finish order
                startTime: Date.now()
            };
            room.players.forEach((p, idx) => {
                // Determine starting position on track based on start finish line
                // The start finish line is WAYPOINTS[0] which is [180, 80]
                const startX = 180 + (idx % 2 === 0 ? -15 : 15);
                const startY = 80 + Math.floor(idx / 2) * 25;
                room.gameState.positions[p.id] = { progress: 0, angle: -Math.PI / 2, laps: 0, x: startX, y: startY, name: p.name };
            });
        }

        // ── LUDO ──
        else if (room.game === 'ludo') {
            const tokens = {};
            room.players.forEach(p => {
                tokens[p.id] = [-1, -1, -1, -1]; // -1 = home yard, 0-51 = board, 56 = finished
            });
            room.gameState = {
                tokens,
                currentPlayerIdx: 0,
                die: null,
                dieRolled: false,
                winner: null,
            };
        }

        // ── SNAKE & LADDERS ──
        else if (room.game === 'snakeladders') {
            const positions = {};
            room.players.forEach(p => { positions[p.id] = 0; });
            room.gameState = {
                positions,
                currentPlayerIdx: 0,
                die: null,
                dieRolled: false,
                lastEvent: null,
                winner: null,
            };
        }

        // ── UNO ──
        else if (room.game === 'uno') {
            const colors = ['red', 'blue', 'green', 'yellow'];
            let deck = [];
            colors.forEach(color => {
                deck.push({ color, value: '0', type: 'number' });
                for (let i = 1; i <= 9; i++) {
                    deck.push({ color, value: i.toString(), type: 'number' });
                    deck.push({ color, value: i.toString(), type: 'number' });
                }
                for (let i = 0; i < 2; i++) {
                    deck.push({ color, value: 'skip', type: 'action' });
                    deck.push({ color, value: 'reverse', type: 'action' });
                    deck.push({ color, value: 'draw2', type: 'action' });
                }
            });
            for (let i = 0; i < 4; i++) {
                deck.push({ color: 'black', value: 'wild', type: 'wild' });
                deck.push({ color: 'black', value: 'draw4', type: 'wild' });
            }

            // Shuffle
            deck.sort(() => Math.random() - 0.5);

            const hands = {};
            room.players.forEach(p => {
                hands[p.id] = deck.splice(0, 7);
            });

            const discardPile = [];
            let topCard = deck.pop();
            // First card should not be a draw4/wild ideally, but keeping it simple: just re-draw if wild
            while (topCard.color === 'black') {
                deck.splice(Math.floor(Math.random() * deck.length), 0, topCard);
                topCard = deck.pop();
            }
            discardPile.push(topCard);

            room.gameState = {
                deck,
                discardPile,
                hands,
                currentColor: topCard.color,
                currentTurnIndex: 0,
                direction: 1, // 1 for clockwise, -1 for counter-clockwise
                winner: null,
                unoCalled: {} // { playerId: true }
            };
        }

        io.to(roomCode).emit('room_update', room);
    });

    // ─── Re-request secret role (on component mount) ───
    socket.on('request_role', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room?.gameState) return;
        const gs = room.gameState;

        if (room.game === 'mrwhite') {
            const isMW = socket.id === gs.mrWhiteId;
            socket.emit('secret_role', { role: isMW ? 'mrwhite' : 'civilian', word: isMW ? '???' : gs.secretWord });
        } else if (room.game === 'imposter') {
            socket.emit('secret_role', { role: socket.id === gs.imposterId ? 'imposter' : 'crewmate' });
        }
    });

    // ─── Quiz: Submit Answer ───
    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || room.game !== 'quiz') return;
        const gs = room.gameState;
        gs.answersThisRound[socket.id] = answerIndex;

        if (Object.keys(gs.answersThisRound).length >= room.players.length) {
            const currentQ = gs.questions[gs.currentQuestion];
            for (const [pId, ans] of Object.entries(gs.answersThisRound)) {
                if (ans === currentQ.answer) gs.scores[pId] = (gs.scores[pId] || 0) + 100;
            }
            if (gs.currentQuestion < gs.questions.length - 1) {
                gs.currentQuestion++;
                gs.answersThisRound = {};
            } else {
                room.state = 'finished';
            }
        }
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Mr. White: Speaker Done ───
    socket.on('done_speaking', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || room.game !== 'mrwhite') return;
        const gs = room.gameState;
        if (gs.phase !== 'discussion') return;
        if (gs.speakingOrder[gs.currentSpeakerIndex] !== socket.id) return;

        gs.currentSpeakerIndex++;
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Mr. White: Change Phase (host) ───
    socket.on('change_phase', ({ roomCode, newPhase }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;

        const gs = room.gameState;
        gs.phase = newPhase;
        if (newPhase === 'voting') gs.votes = {};
        if (newPhase === 'night') { gs.votes = {}; gs.lastKilled = null; }
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Mr. White: Vote ───
    socket.on('submit_vote', ({ roomCode, votedId }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || room.game !== 'mrwhite') return;
        const gs = room.gameState;
        if (gs.phase !== 'voting') return;

        gs.votes[socket.id] = votedId;

        const activePlayers = room.players.filter(p => gs.activePlayers.includes(p.id));
        if (Object.keys(gs.votes).length < activePlayers.length) {
            io.to(roomCode).emit('room_update', room);
            return;
        }

        // Tally
        const counts = {};
        for (const id of Object.values(gs.votes)) counts[id] = (counts[id] || 0) + 1;
        const maxVotes = Math.max(...Object.values(counts));
        const tiedIds = Object.keys(counts).filter(id => counts[id] === maxVotes);
        gs.tied = tiedIds.length > 1;

        if (gs.tied) {
            // TIE: no elimination, back to discussion with new speaking order
            gs.phase = 'discussion';
            gs.votes = {};
            gs.lastEliminated = null;
            gs.round++;
            gs.speakingOrder = generateSpeakingOrder(gs.activePlayers, gs.mrWhiteId);
            gs.currentSpeakerIndex = 0;
        } else {
            const eliminatedId = tiedIds[0];
            gs.lastEliminated = eliminatedId;

            if (eliminatedId === gs.mrWhiteId) {
                gs.winner = 'citizens';
                gs.phase = 'revealed';
                room.state = 'finished';
            } else {
                // Innocent eliminated
                gs.eliminatedPlayers.push(eliminatedId);
                gs.activePlayers = gs.activePlayers.filter(id => id !== eliminatedId);

                if (gs.activePlayers.length <= 2) {
                    // Mr. White wins (can't be caught with only 2 left)
                    gs.winner = 'mrwhite';
                    gs.phase = 'revealed';
                    room.state = 'finished';
                } else {
                    gs.tied = false;
                    gs.phase = 'discussion';
                    gs.votes = {};
                    gs.round++;
                    gs.speakingOrder = generateSpeakingOrder(gs.activePlayers, gs.mrWhiteId);
                    gs.currentSpeakerIndex = 0;
                }
            }
        }
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Imposter: Kill ───
    socket.on('imposter_kill', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || room.game !== 'imposter') return;
        const gs = room.gameState;
        if (gs.phase !== 'night' || socket.id !== gs.imposterId) return;

        gs.deadPlayers.push(targetId);
        gs.lastKilled = targetId;
        const alive = room.players.filter(p => !gs.deadPlayers.includes(p.id));
        gs.phase = alive.length <= 2 ? 'revealed' : 'day_discussion';
        if (gs.phase === 'revealed') { gs.winner = 'imposter'; room.state = 'finished'; }
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Go Kart: Position Update ───
    socket.on('kart_position', ({ roomCode, progress, angle, laps, x, y }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'gokart' || !room.gameState) return;
        const gs = room.gameState;
        if (!gs.positions[socket.id]) return;
        gs.positions[socket.id] = { ...gs.positions[socket.id], progress, angle, laps, x, y };
        // Broadcast all positions (lightweight)
        const allPos = Object.entries(gs.positions).map(([id, p]) => ({ id, ...p }));
        io.to(roomCode).emit('kart_positions', allPos);
    });

    // ─── Go Kart: Finished ───
    socket.on('kart_finished', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'gokart' || !room.gameState) return;
        const gs = room.gameState;
        if (gs.finishOrder.includes(socket.id)) return;
        gs.finishOrder.push(socket.id);
        const elapsed = ((Date.now() - gs.startTime) / 1000).toFixed(1);
        gs.positions[socket.id].finishTime = elapsed;
        if (gs.finishOrder.length >= room.players.length) {
            room.state = 'finished';
            const results = gs.finishOrder.map(id => ({
                id,
                name: room.players.find(p => p.id === id)?.name || '?',
                time: gs.positions[id]?.finishTime || '???'
            }));
            io.to(roomCode).emit('race_finished', results);
            io.to(roomCode).emit('room_update', room);
        } else {
            // Notify all of partial finish order
            io.to(roomCode).emit('kart_positions', Object.entries(gs.positions).map(([id, p]) => ({ id, ...p })));
        }
    });

    // ─── Ludo: Roll Dice ───
    socket.on('ludo_roll', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'ludo' || !room.gameState) return;
        const gs = room.gameState;
        const cp = room.players[gs.currentPlayerIdx];
        if (cp?.id !== socket.id || gs.dieRolled) return;
        const die = Math.floor(Math.random() * 6) + 1;
        gs.die = die;
        gs.dieRolled = true;
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Ludo: Move Token ───
    socket.on('ludo_move', ({ roomCode, tokenIdx }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'ludo' || !room.gameState) return;
        const gs = room.gameState;
        const cp = room.players[gs.currentPlayerIdx];
        if (cp?.id !== socket.id || !gs.dieRolled) return;

        const playerTokens = gs.tokens[socket.id];
        if (!playerTokens || tokenIdx < 0 || tokenIdx > 3) return;
        const pos = playerTokens[tokenIdx];

        // Can't move finished tokens
        if (pos === 56) return;

        // Move from home: need die=6
        if (pos === -1) {
            if (gs.die === 6) playerTokens[tokenIdx] = 0;
            else return; // invalid move, can't come out
        } else {
            const newPos = pos + gs.die;
            if (newPos >= 52) {
                // Passed all 52 — home column (simplified: just mark as done at 56)
                if (newPos - 52 >= 4 || newPos > 56) playerTokens[tokenIdx] = 56;
                else playerTokens[tokenIdx] = 52 + (newPos - 52); // home stretch stub
            } else {
                // Capture: knock opponents off
                const SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47];
                if (!SAFE_CELLS.includes(newPos)) {
                    room.players.forEach(p => {
                        if (p.id === socket.id) return;
                        const ot = gs.tokens[p.id];
                        if (ot) for (let i = 0; i < 4; i++) { if (ot[i] === newPos) ot[i] = -1; }
                    });
                }
                playerTokens[tokenIdx] = newPos;
            }
        }

        // Check win: all 4 tokens at 56
        if (playerTokens.every(t => t === 56)) {
            gs.winner = socket.id;
            room.state = 'finished';
        }

        // Advance turn (die=6 means extra turn)
        if (gs.die !== 6) {
            gs.currentPlayerIdx = (gs.currentPlayerIdx + 1) % room.players.length;
        }
        gs.die = null;
        gs.dieRolled = false;
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Snake & Ladders: Roll ───
    const SNL_SNAKES = { 98: 79, 95: 13, 87: 24, 64: 60, 54: 34, 17: 7 };
    const SNL_LADDERS = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };

    socket.on('snl_roll', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'snakeladders' || !room.gameState) return;
        const gs = room.gameState;
        const cp = room.players[gs.currentPlayerIdx];
        if (cp?.id !== socket.id || gs.dieRolled) return;

        const die = Math.floor(Math.random() * 6) + 1;
        gs.die = die;
        gs.dieRolled = true;
        gs.lastEvent = null;

        let pos = (gs.positions[socket.id] || 0) + die;
        if (pos > 100) pos = (gs.positions[socket.id] || 0); // bounce back
        else if (SNL_SNAKES[pos]) {
            const oldPos = pos;
            pos = SNL_SNAKES[pos];
            gs.lastEvent = `😱 ${cp.name} hit a snake! ${oldPos} → ${pos}`;
        } else if (SNL_LADDERS[pos]) {
            const oldPos = pos;
            pos = SNL_LADDERS[pos];
            gs.lastEvent = `🎉 ${cp.name} climbed a ladder! ${oldPos} → ${pos}`;
        }

        gs.positions[socket.id] = pos;

        if (pos === 100) {
            gs.winner = socket.id;
            room.state = 'finished';
        } else {
            // Extra turn on 6
            if (die !== 6) gs.currentPlayerIdx = (gs.currentPlayerIdx + 1) % room.players.length;
            gs.dieRolled = false;
        }

        io.to(roomCode).emit('room_update', room);
    });

    // ─── Imposter: Vote ───
    socket.on('imposter_vote', ({ roomCode, votedId }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || room.game !== 'imposter') return;
        const gs = room.gameState;
        if (gs.phase !== 'day_voting' || gs.deadPlayers.includes(socket.id)) return;

        gs.votes[socket.id] = votedId;
        const alive = room.players.filter(p => !gs.deadPlayers.includes(p.id));
        if (Object.keys(gs.votes).length < alive.length) {
            io.to(roomCode).emit('room_update', room);
            return;
        }

        const counts = {};
        for (const id of Object.values(gs.votes)) counts[id] = (counts[id] || 0) + 1;
        const maxVotes = Math.max(...Object.values(counts));
        const tiedIds = Object.keys(counts).filter(id => counts[id] === maxVotes);

        if (tiedIds.length > 1 || tiedIds[0] === 'skip') {
            gs.phase = 'night';
            gs.votes = {};
            gs.lastKilled = null;
        } else {
            const ejectedId = tiedIds[0];
            gs.deadPlayers.push(ejectedId);
            gs.lastEjected = ejectedId;
            const stillAlive = room.players.filter(p => !gs.deadPlayers.includes(p.id));
            if (ejectedId === gs.imposterId) {
                gs.winner = 'crewmates'; gs.phase = 'revealed'; room.state = 'finished';
            } else if (stillAlive.length <= 2) {
                gs.winner = 'imposter'; gs.phase = 'revealed'; room.state = 'finished';
            } else {
                gs.phase = 'night'; gs.votes = {};
            }
        }
        io.to(roomCode).emit('room_update', room);
    });

    // ─── UNO: Play Card ───
    socket.on('uno_play_card', ({ roomCode, cardIndex, newColor }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'uno' || room.state !== 'playing' || !room.gameState) return;
        const gs = room.gameState;
        const cp = room.players[gs.currentTurnIndex];
        if (cp?.id !== socket.id) return; // not their turn

        const hand = gs.hands[socket.id];
        if (!hand || cardIndex < 0 || cardIndex >= hand.length) return;
        const card = hand[cardIndex];

        // Validation
        const topCard = gs.discardPile[gs.discardPile.length - 1];
        const isValid = card.color === 'black' || card.color === gs.currentColor || card.value === topCard.value;
        if (!isValid) return;

        // Play card
        hand.splice(cardIndex, 1);
        gs.discardPile.push(card);
        gs.currentColor = card.color === 'black' ? (newColor || 'red') : card.color;

        // Reset uno call if they had 1 card but didn't call it (auto penalty could be added, here we just clear it)
        if (hand.length > 1) gs.unoCalled[socket.id] = false;

        // Check win
        if (hand.length === 0) {
            gs.winner = socket.id;
            room.state = 'finished';
            io.to(roomCode).emit('room_update', room);
            return;
        }

        // Handle Action/Wild cards
        let skipNext = false;
        if (card.value === 'reverse') {
            gs.direction *= -1;
            // If only 2 players, reverse acts like a skip
            if (room.players.length === 2) skipNext = true;
        } else if (card.value === 'skip') {
            skipNext = true;
        } else if (card.value === 'draw2') {
            skipNext = true;
            const nextIdx = (gs.currentTurnIndex + gs.direction + room.players.length) % room.players.length;
            const nextPlayer = room.players[nextIdx];
            for (let i = 0; i < 2; i++) {
                if (gs.deck.length === 0) reshuffleUnoDeck(gs);
                if (gs.deck.length > 0) gs.hands[nextPlayer.id].push(gs.deck.pop());
            }
            gs.unoCalled[nextPlayer.id] = false;
        } else if (card.value === 'draw4') {
            skipNext = true;
            const nextIdx = (gs.currentTurnIndex + gs.direction + room.players.length) % room.players.length;
            const nextPlayer = room.players[nextIdx];
            for (let i = 0; i < 4; i++) {
                if (gs.deck.length === 0) reshuffleUnoDeck(gs);
                if (gs.deck.length > 0) gs.hands[nextPlayer.id].push(gs.deck.pop());
            }
            gs.unoCalled[nextPlayer.id] = false;
        }

        // Advance turn
        let steps = skipNext ? 2 : 1;
        gs.currentTurnIndex = (gs.currentTurnIndex + (gs.direction * steps) + (room.players.length * 2)) % room.players.length;

        io.to(roomCode).emit('room_update', room);
    });

    // ─── UNO: Draw Card ───
    socket.on('uno_draw_card', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'uno' || room.state !== 'playing' || !room.gameState) return;
        const gs = room.gameState;
        const cp = room.players[gs.currentTurnIndex];
        if (cp?.id !== socket.id) return; // not their turn

        if (gs.deck.length === 0) reshuffleUnoDeck(gs);
        if (gs.deck.length > 0) {
            gs.hands[socket.id].push(gs.deck.pop());
            gs.unoCalled[socket.id] = false;
        }

        // Advance turn
        gs.currentTurnIndex = (gs.currentTurnIndex + gs.direction + room.players.length) % room.players.length;
        io.to(roomCode).emit('room_update', room);
    });

    // ─── UNO: Call UNO ───
    socket.on('uno_call', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.game !== 'uno' || room.state !== 'playing' || !room.gameState) return;
        const gs = room.gameState;
        if (gs.hands[socket.id] && gs.hands[socket.id].length <= 2) {
            gs.unoCalled[socket.id] = true;
            io.to(roomCode).emit('room_update', room);
        }
    });

    function reshuffleUnoDeck(gs) {
        if (gs.discardPile.length <= 1) return;
        const top = gs.discardPile.pop();
        gs.deck = gs.discardPile;
        gs.deck.forEach(c => {
            if (c.color === 'black') {
                // leave as black, value remains same
            }
        });
        gs.deck.sort(() => Math.random() - 0.5);
        gs.discardPile = [top];
    }

    // ─── Return to Lobby ───
    socket.on('return_to_lobby', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || (room.state !== 'finished' && room.state !== 'playing')) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player?.isHost) return;

        room.state = 'lobby';
        room.gameState = null;
        room.players.forEach(p => p.score = 0);
        io.to(roomCode).emit('room_update', room);
    });

    // ─── Leave / Disconnect ───
    const handleLeave = () => {
        for (const [code, room] of Object.entries(rooms)) {
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx === -1) continue;
            const player = room.players[idx];
            room.players.splice(idx, 1);
            console.log(`[Room] ${player.name} left room ${code}`);
            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                if (player.isHost) room.players[0].isHost = true;
                io.to(code).emit('room_update', room);
            }
        }
    };

    socket.on('leave_room', handleLeave);
    socket.on('disconnect', () => { console.log(`[-] Disconnected: ${socket.id}`); handleLeave(); });
});

// ─── Catch-all to serve React app ───
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 Game Server running on port ${PORT}`);
    console.log(`🌐 Local Network Access enabled!`);
    console.log(`=========================================`);
});
