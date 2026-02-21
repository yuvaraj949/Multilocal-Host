import React, { useState, useEffect } from 'react';


// Snakes: head -> tail
const SNAKES = { 98: 79, 95: 13, 87: 24, 64: 60, 54: 34, 17: 7 };
// Ladders: bottom -> top
const LADDERS = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };

const PLAYER_COLOURS = [
    '#ff4757', '#2ed573', '#ffa502', '#1e90ff', '#a29bfe',
    '#fd79a8', '#fdcb6e', '#00cec9', '#6c5ce7', '#e17055',
    '#55efc4', '#74b9ff', '#ff7675', '#b2bec3', '#0984e3',
    '#e84393', '#00b894', '#e67e22', '#9b59b6', '#1abc9c',
];

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function DiceDisplay({ value, rolling }) {
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    return (
        <div style={{
            fontSize: '4em', lineHeight: 1,
            filter: rolling ? 'blur(3px)' : 'none',
            transition: 'filter 0.1s',
            userSelect: 'none',
        }}>
            {faces[(value || 1) - 1]}
        </div>
    );
}

function Board({ positions, players }) {
    // Build 10×10 board, snake-style (row 0 = cells 1-10 at bottom)
    const cells = [];
    for (let row = 9; row >= 0; row--) {
        const isReversed = (9 - row) % 2 === 1;
        const rowCells = [];
        for (let col = 0; col < 10; col++) {
            const c = isReversed ? col : 9 - col;
            const cell = row * 10 + c + 1;
            const playersHere = players.filter(p => positions[p.id] === cell);
            const isSnakeTail = Object.values(SNAKES).includes(cell);
            const isSnakeHead = Object.keys(SNAKES).includes(String(cell));
            const isLadderBottom = Object.keys(LADDERS).includes(String(cell));
            const isLadderTop = Object.values(LADDERS).includes(cell);

            let bg = 'rgba(255,255,255,0.04)';
            let border = '1px solid rgba(255,255,255,0.08)';
            let icon = null;

            if (isSnakeHead) { bg = 'rgba(255,71,87,0.2)'; icon = '🐍'; border = '1px solid rgba(255,71,87,0.4)'; }
            else if (isSnakeTail) { bg = 'rgba(255,71,87,0.08)'; }
            else if (isLadderBottom) { bg = 'rgba(46,213,115,0.2)'; icon = '🪜'; border = '1px solid rgba(46,213,115,0.4)'; }
            else if (isLadderTop) { bg = 'rgba(46,213,115,0.08)'; }
            if (cell === 100) { bg = 'rgba(255,215,0,0.3)'; icon = '🏁'; border = '2px solid gold'; }
            if (cell === 1) { bg = 'rgba(255,255,255,0.12)'; icon = '🚩'; }

            rowCells.push(
                <div key={cell} style={{
                    width: '9.5%', aspectRatio: '1', minWidth: 0,
                    background: bg, border, borderRadius: 3,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', overflow: 'hidden',
                    padding: 0, flexShrink: 0, boxSizing: 'border-box',
                }}>
                    <span style={{ position: 'absolute', top: 0, left: 1, fontSize: '5.5px', opacity: 0.4, color: '#fff' }}>{cell}</span>
                    {icon && <span style={{ fontSize: '9px', lineHeight: 1 }}>{icon}</span>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1px', justifyContent: 'center' }}>
                        {playersHere.map((p) => {
                            const pi = players.findIndex(pl => pl.id === p.id);
                            return <div key={p.id} style={{ width: 7, height: 7, borderRadius: '50%', background: PLAYER_COLOURS[pi % 20], border: `1px solid rgba(255,255,255,0.6)`, flexShrink: 0 }} />;
                        })}
                    </div>
                </div>
            );
        }
        cells.push(
            <div key={row} style={{ display: 'flex', width: '100%', gap: '0.5%' }}>
                {isReversed ? rowCells : rowCells}
            </div>
        );
    }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5%', width: '100%' }}>{cells}</div>;
}

export default function SnakeLadders({ roomState, socket, roomCode, onReturnLobby }) {
    const gs = roomState?.gameState;
    const players = roomState?.players || [];
    const myId = socket.id;
    const me = players.find(p => p.id === myId);
    const isHost = me?.isHost;

    const currentPlayerIdx = gs?.currentPlayerIdx ?? 0;
    const currentPlayer = players[currentPlayerIdx];
    const isMyTurn = currentPlayer?.id === myId;

    const positions = gs?.positions || {};   // { playerId: cellNumber }
    // gs?.die is used via dieValue display only
    const lastEvent = gs?.lastEvent || null;  // e.g. "hit snake!", "climbed ladder!"
    const winner = gs?.winner || null;
    const finished = roomState?.state === 'finished';

    const [dieRolling, setDieRolling] = useState(false);
    const [dieValue, setDieValue] = useState(1);
    const [showEvent, setShowEvent] = useState('');

    useEffect(() => {
        if (gs?.die !== undefined) setDieValue(gs.die);
    }, [gs?.die]);

    useEffect(() => {
        if (lastEvent) {
            setShowEvent(lastEvent);
            const t = setTimeout(() => setShowEvent(''), 2500);
            return () => clearTimeout(t);
        }
    }, [lastEvent, gs?.die]);

    const handleRoll = () => {
        if (!isMyTurn || dieRolling || gs?.dieRolled) return;
        setDieRolling(true);
        let count = 0;
        const iv = setInterval(() => {
            setDieValue(rollDie());
            count++;
            if (count >= 10) {
                clearInterval(iv);
                setDieRolling(false);
                socket.emit('snl_roll', { roomCode });
            }
        }, 80);
    };

    if (finished && winner) {
        const winnerPlayer = players.find(p => p.id === winner);
        const winnerIdx = players.findIndex(p => p.id === winner);
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: '4em', marginBottom: 8 }}>🎉</div>
                <h2 style={{ marginBottom: 8 }}>Game Over!</h2>
                <div className="glass-card" style={{ margin: '12px auto', maxWidth: 300 }}>
                    <div style={{ fontSize: '1.5em', fontWeight: 700, color: PLAYER_COLOURS[winnerIdx % 20] }}>
                        🏆 {winnerPlayer?.name || 'Someone'} wins!
                    </div>
                    <p style={{ opacity: 0.7, marginTop: 8 }}>First to reach cell 100!</p>
                </div>
                {isHost && <button className="btn-primary" style={{ marginTop: 16 }} onClick={onReturnLobby}>Return to Lobby</button>}
            </div>
        );
    }

    return (
        <div style={{ padding: 10, maxWidth: 420, margin: '0 auto' }}>
            <h2 style={{ textAlign: 'center', marginBottom: 6, fontSize: '1.2em' }}>🐍 Snake & Ladders</h2>

            {/* Turn */}
            <div style={{
                textAlign: 'center', padding: '6px 12px', marginBottom: 8,
                background: `rgba(${isMyTurn ? '46,213,115' : '255,255,255'},0.1)`,
                borderRadius: 10, fontSize: '0.85em',
                border: `1px solid ${isMyTurn ? '#2ed573' : 'rgba(255,255,255,0.2)'}`
            }}>
                {isMyTurn ? <strong>🎯 Your turn! Roll the dice!</strong> : <span>⏳ Waiting for <strong>{currentPlayer?.name}</strong>...</span>}
            </div>

            {/* Event flash */}
            {showEvent && (
                <div style={{
                    textAlign: 'center', padding: '8px 16px', marginBottom: 8,
                    background: showEvent.includes('snake') ? 'rgba(255,71,87,0.25)' : 'rgba(46,213,115,0.25)',
                    borderRadius: 10, fontSize: '1.1em', fontWeight: 700,
                    border: `2px solid ${showEvent.includes('snake') ? '#ff4757' : '#2ed573'}`,
                    animation: 'pulse 0.5s ease',
                }}>
                    {showEvent}
                </div>
            )}

            {/* Dice */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 10 }}>
                <DiceDisplay value={dieValue} rolling={dieRolling} />
                {isMyTurn && !gs?.dieRolled && (
                    <button
                        className="btn-primary"
                        style={{ fontSize: '1em', padding: '12px 24px' }}
                        onClick={handleRoll}
                        disabled={dieRolling}
                    >
                        🎲 Roll!
                    </button>
                )}
                {isMyTurn && gs?.dieRolled && <span style={{ fontSize: '0.85em', opacity: 0.7 }}>Moving...</span>}
            </div>

            {/* Board */}
            <div className="glass-card" style={{ padding: 8, marginBottom: 10 }}>
                <Board positions={positions} players={players} />
            </div>

            {/* Player positions */}
            <div className="glass-card" style={{ padding: 10 }}>
                <div style={{ fontSize: '0.75em', fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>STANDINGS</div>
                {[...players]
                    .map((p, pi) => ({ ...p, pi, pos: positions[p.id] || 0 }))
                    .sort((a, b) => b.pos - a.pos)
                    .map(({ id, name, pi, pos }, rank) => (
                        <div key={id} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            fontWeight: id === myId ? 700 : 400
                        }}>
                            <span style={{ minWidth: 20, fontSize: '0.85em', opacity: 0.6 }}>#{rank + 1}</span>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: PLAYER_COLOURS[pi % 20], flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: '0.9em' }}>{name}{id === myId ? ' (you)' : ''}</span>
                            <span style={{ fontSize: '0.8em', opacity: 0.7 }}>Cell {pos || 0}</span>
                            {players[currentPlayerIdx]?.id === id && <span style={{ fontSize: '0.7em' }}>← turn</span>}
                        </div>
                    ))}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, fontSize: '0.75em', opacity: 0.6 }}>
                <span>🐍 Snake (go down)</span>
                <span>🪜 Ladder (go up)</span>
                <span>🏁 Goal (100)</span>
            </div>
        </div>
    );
}
