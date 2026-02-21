import React, { useState, useEffect } from 'react';

const COLOURS = ['#ff4757', '#2ed573', '#ffa502', '#1e90ff'];
const COLOUR_LIGHT = ['rgba(255,71,87,0.15)', 'rgba(46,213,115,0.15)', 'rgba(255,165,2,0.15)', 'rgba(30,144,255,0.15)'];


const SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47]; // safe tiles

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function DiceIcon({ value, rolling }) {
    const dots = {
        1: [[50, 50]],
        2: [[25, 25], [75, 75]],
        3: [[25, 25], [50, 50], [75, 75]],
        4: [[25, 25], [75, 25], [25, 75], [75, 75]],
        5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
        6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]],
    };
    return (
        <svg width={56} height={56} viewBox="0 0 100 100" style={{ filter: rolling ? 'blur(2px)' : 'none', transition: 'filter 0.1s' }}>
            <rect x={5} y={5} width={90} height={90} rx={16} fill="white" stroke="#ddd" strokeWidth={4} />
            {(dots[value] || []).map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={8} fill="#222" />
            ))}
        </svg>
    );
}

export default function Ludo({ roomState, socket, roomCode, onReturnLobby }) {
    const gs = roomState?.gameState;
    const players = roomState?.players || [];
    const myId = socket.id;
    const myIdx = players.findIndex(p => p.id === myId);
    const me = players[myIdx];
    const isHost = me?.isHost;

    // Each player gets a colour (cycled if >4)
    // Tokens per team (up to 20 players share 4 teams of up to 5)
    const TEAMS = Math.min(4, players.length);
    const myTeam = myIdx % TEAMS;

    const [dieRolling, setDieRolling] = useState(false);
    const [dieValue, setDieValue] = useState(null);

    // Whose turn
    const currentPlayerIdx = gs?.currentPlayerIdx ?? 0;
    const currentPlayer = players[currentPlayerIdx];
    const isMyTurn = currentPlayer?.id === myId;

    // Tokens state from server
    const tokens = gs?.tokens || {};         // { playerId: [pos0, pos1, pos2, pos3] }  pos= -1 (home), 0-51 (board), 56 (finished)
    const die = gs?.die ?? null;
    const finished = roomState?.state === 'finished';
    const winner = gs?.winner || null;

    // Show die from server
    useEffect(() => {
        if (gs?.die !== undefined) setDieValue(gs.die);
    }, [gs?.die]);

    const handleRoll = () => {
        if (!isMyTurn || dieRolling) return;
        setDieRolling(true);
        let count = 0;
        const iv = setInterval(() => {
            setDieValue(rollDie());
            count++;
            if (count >= 8) { clearInterval(iv); setDieRolling(false); socket.emit('ludo_roll', { roomCode }); }
        }, 80);
    };

    const handleMoveToken = (tokenIdx) => {
        if (!isMyTurn || dieRolling || die === null) return;
        socket.emit('ludo_move', { roomCode, tokenIdx });
    };

    // Simple board rendering
    const myTokens = (tokens[myId] || [-1, -1, -1, -1]).slice(0, 4);

    const renderBoard = () => {
        const cells = [];
        for (let i = 0; i < 52; i++) {
            const isSafe = SAFE_CELLS.includes(i);
            const playersHere = players.map((p, pi) => {
                const ptoks = tokens[p.id] || [-1, -1, -1, -1];
                const count = ptoks.filter(pos => pos === i).length;
                return count > 0 ? { pi, count, colour: COLOURS[pi % TEAMS] } : null;
            }).filter(Boolean);

            cells.push(
                <div key={i} style={{
                    width: 32, height: 32, borderRadius: 6, margin: 2,
                    background: isSafe ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                    border: isSafe ? '2px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', fontSize: '0.55em', color: 'rgba(255,255,255,0.5)',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                }}>
                    <span style={{ position: 'absolute', top: 1, left: 3, fontSize: '0.65em', opacity: 0.4 }}>{i}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', alignItems: 'center' }}>
                        {playersHere.map(({ pi, count, colour }) =>
                            Array.from({ length: count }).map((_, ci) => (
                                <div key={`${pi}-${ci}`} style={{ width: 10, height: 10, borderRadius: '50%', background: colour, border: '1px solid rgba(255,255,255,0.5)' }} />
                            ))
                        )}
                    </div>
                </div>
            );
        }
        return cells;
    };

    if (finished && winner) {
        const winnerPlayer = players.find(p => p.id === winner);
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: '4em', marginBottom: 8 }}>🎉</div>
                <h2 style={{ marginBottom: 8 }}>Game Over!</h2>
                <div className="glass-card" style={{ margin: '12px auto', maxWidth: 300 }}>
                    <div style={{ fontSize: '1.5em', fontWeight: 700, color: COLOURS[players.findIndex(p => p.id === winner) % TEAMS] }}>
                        🏆 {winnerPlayer?.name || 'Someone'} wins!
                    </div>
                </div>
                {isHost && <button className="btn-primary" style={{ marginTop: 16 }} onClick={onReturnLobby}>Return to Lobby</button>}
            </div>
        );
    }

    return (
        <div style={{ padding: 12, maxWidth: 400, margin: '0 auto' }}>
            <h2 style={{ textAlign: 'center', marginBottom: 4 }}>🎲 Ludo</h2>

            {/* Turn indicator */}
            <div style={{
                textAlign: 'center', marginBottom: 12, padding: '8px 16px',
                background: COLOUR_LIGHT[currentPlayerIdx % TEAMS],
                borderRadius: 12, fontSize: '0.9em', border: `2px solid ${COLOURS[currentPlayerIdx % TEAMS]}`
            }}>
                {isMyTurn
                    ? <strong>🎯 Your turn!</strong>
                    : <span>Waiting for <strong>{currentPlayer?.name}</strong>...</span>
                }
            </div>

            {/* Dice + Roll */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 16 }}>
                <DiceIcon value={dieValue || 1} rolling={dieRolling} />
                {isMyTurn && (
                    <button
                        className="btn-primary"
                        style={{ fontSize: '1.1em', padding: '10px 24px' }}
                        onClick={handleRoll}
                        disabled={dieRolling || gs?.dieRolled}
                    >
                        {gs?.dieRolled ? '🎲 Rolled!' : '🎲 Roll!'}
                    </button>
                )}
                {dieValue && <div style={{ fontSize: '2em', fontWeight: 900 }}>{dieValue}</div>}
            </div>

            {/* My tokens */}
            {gs?.dieRolled && isMyTurn && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: 6 }}>Select token to move:</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {myTokens.map((pos, i) => (
                            <button
                                key={i}
                                onClick={() => handleMoveToken(i)}
                                style={{
                                    flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                                    background: pos === 56 ? '#aaa' : COLOURS[myTeam], color: '#fff', fontWeight: 700, fontSize: '0.9em',
                                    opacity: pos === 56 ? 0.4 : 1,
                                }}
                                disabled={pos === 56}
                            >
                                {pos === -1 ? '🏠' : pos === 56 ? '✅' : `#${i + 1}`}<br />
                                <small style={{ fontWeight: 400, fontSize: '0.7em' }}>{pos === -1 ? 'Home' : pos === 56 ? 'Done' : `Pos ${pos}`}</small>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Board */}
            <div className="glass-card" style={{ padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: '0.75em', fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>BOARD (52 cells)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', maxHeight: 240, overflowY: 'auto' }}>
                    {renderBoard()}
                </div>
            </div>

            {/* Players */}
            <div className="glass-card" style={{ padding: 10 }}>
                <div style={{ fontSize: '0.75em', fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>PLAYERS</div>
                {players.map((p, pi) => {
                    const ptoks = tokens[p.id] || [-1, -1, -1, -1];
                    const finished = ptoks.filter(t => t === 56).length;
                    return (
                        <div key={p.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            fontWeight: p.id === myId ? 700 : 400
                        }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: COLOURS[pi % TEAMS], flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: '0.9em' }}>{p.name}</span>
                            <span style={{ fontSize: '0.75em', opacity: 0.7 }}>{'✅'.repeat(finished)}{'●'.repeat(4 - finished)}</span>
                            {pi === currentPlayerIdx && <span style={{ fontSize: '0.75em' }}>← turn</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
