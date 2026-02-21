import React, { useState } from 'react';

export default function Uno({ roomState, socket, roomCode, onReturnLobby }) {
    const gs = roomState.gameState;
    const me = roomState.players.find(p => p.id === socket.id);
    const myHand = gs.hands[socket.id] || [];
    const isMyTurn = roomState.players[gs.currentTurnIndex]?.id === socket.id;

    const [selectedWildIndex, setSelectedWildIndex] = useState(null);

    const handlePlayCard = (index) => {
        if (!isMyTurn) return;
        const card = myHand[index];

        // Check if wild card
        if (card.color === 'black') {
            setSelectedWildIndex(index);
            return;
        }

        // Normal card validation
        const topCard = gs.discardPile[gs.discardPile.length - 1];
        const isValid = card.color === gs.currentColor || card.value === topCard.value;
        if (isValid) {
            socket.emit('uno_play_card', { roomCode, cardIndex: index });
        }
    };

    const handlePlayWild = (color) => {
        if (selectedWildIndex !== null) {
            socket.emit('uno_play_card', { roomCode, cardIndex: selectedWildIndex, newColor: color });
            setSelectedWildIndex(null);
        }
    };

    const handleDrawCard = () => {
        if (isMyTurn) socket.emit('uno_draw_card', { roomCode });
    };

    const handleCallUno = () => {
        socket.emit('uno_call', { roomCode });
    };

    // ── Render Helpers ──
    const getCardStyle = (color) => {
        const colors = {
            'red': '#ff5555',
            'blue': '#5555ff',
            'green': '#55aa55',
            'yellow': '#ffaa00',
            'black': '#333'
        };
        return {
            backgroundColor: colors[color] || '#fff',
            color: color === 'yellow' ? '#111' : '#fff',
            border: `2px solid ${color === 'black' ? '#555' : '#fff'}`,
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            borderRadius: '8px',
            width: '60px',
            height: '90px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 'bold',
            margin: '0 4px',
            position: 'relative',
            cursor: 'pointer',
            userSelect: 'none'
        };
    };

    const renderCardValue = (card) => {
        if (card.value === 'skip') return '⊘';
        if (card.value === 'reverse') return '⇄';
        if (card.value === 'draw2') return '+2';
        if (card.value === 'draw4') return '+4';
        if (card.value === 'wild') return 'W';
        return card.value;
    };

    // ── Finished State ──
    if (roomState.state === 'finished') {
        const winnerName = roomState.players.find(p => p.id === gs.winner)?.name || 'Someone';
        return (
            <div className="glass-card" style={{ textAlign: 'center' }}>
                <h2>🎉 {winnerName} won the game! 🎉</h2>
                {me?.isHost && (
                    <button className="btn-primary" style={{ marginTop: 20 }} onClick={onReturnLobby}>
                        Return to Lobby
                    </button>
                )}
            </div>
        );
    }

    const topCard = gs.discardPile[gs.discardPile.length - 1];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
            {/* Top: Opponents */}
            <div className="glass-card" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                {roomState.players.map((p, idx) => {
                    const isCurrent = idx === gs.currentTurnIndex;
                    if (p.id === socket.id) return null; // self
                    return (
                        <div key={p.id} style={{
                            background: isCurrent ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: isCurrent ? '2px solid #fff' : '2px solid transparent',
                            textAlign: 'center'
                        }}>
                            <div>{p.name}</div>
                            <div style={{ fontSize: '0.8em', opacity: 0.8 }}>Cards: {gs.hands[p.id]?.length || 0}</div>
                            {gs.unoCalled[p.id] && <div style={{ color: '#ffaa00', fontWeight: 'bold' }}>UNO!</div>}
                        </div>
                    );
                })}
            </div>

            {/* Middle: Table */}
            <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {/* Wild Color Indicator */}
                {gs.currentColor && (
                    <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '16px', fontSize: '0.9em' }}>
                        Current Color: <span style={{ color: gs.currentColor, fontWeight: 'bold', textTransform: 'uppercase' }}>{gs.currentColor}</span>
                    </div>
                )}

                {/* Turn Indicator */}
                <h3 style={{ marginBottom: '20px' }}>
                    {isMyTurn ? "It's your turn!" : `${roomState.players[gs.currentTurnIndex]?.name}'s turn`}
                </h3>

                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    {/* Deck (Draw Pile) */}
                    <div
                        onClick={handleDrawCard}
                        style={{ ...getCardStyle('black'), background: '#222', border: isMyTurn ? '2px solid #fff' : 'none', cursor: isMyTurn ? 'pointer' : 'default' }}>
                        <div style={{ transform: 'rotate(-45deg)', fontSize: '18px', color: '#ccc' }}>UNO</div>
                        <div style={{ position: 'absolute', bottom: -25, fontSize: '12px' }}>Draw Pile</div>
                    </div>

                    {/* Discard Pile */}
                    <div style={getCardStyle(topCard.color)}>
                        <div style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '12px' }}>{renderCardValue(topCard)}</div>
                        {renderCardValue(topCard)}
                        <div style={{ position: 'absolute', bottom: '4px', right: '4px', fontSize: '12px', transform: 'rotate(180deg)' }}>{renderCardValue(topCard)}</div>
                        <div style={{ position: 'absolute', bottom: -25, fontSize: '12px', color: '#ccc', width: '100%', textAlign: 'center' }}>Discard Pile</div>
                    </div>
                </div>

                {/* Direction Indicator */}
                <div style={{ marginTop: '40px', fontSize: '1.2em', opacity: 0.5 }}>
                    Direction: {gs.direction === 1 ? '↻ Clockwise' : '↺ Counter-Clockwise'}
                </div>
            </div>

            {/* Bottom: Player Hand */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '10px' }}>
                    <h3>Your Hand</h3>
                    {(myHand.length === 2 || gs.unoCalled[socket.id]) && (
                        <button
                            className={gs.unoCalled[socket.id] ? 'btn-secondary' : 'btn-primary'}
                            onClick={handleCallUno}
                            disabled={gs.unoCalled[socket.id]}
                            style={{ padding: '4px 16px', margin: 0 }}
                        >
                            {gs.unoCalled[socket.id] ? 'UNO Called!' : 'Call UNO'}
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                    {myHand.map((card, idx) => {
                        const isValid = card.color === 'black' || card.color === gs.currentColor || card.value === topCard.value;
                        return (
                            <div
                                key={idx}
                                onClick={() => handlePlayCard(idx)}
                                style={{
                                    ...getCardStyle(card.color),
                                    opacity: (!isMyTurn || !isValid) ? 0.6 : 1,
                                    transform: (!isMyTurn || !isValid) ? 'scale(0.95)' : 'scale(1)',
                                    transition: 'all 0.2s ease',
                                    border: (isMyTurn && isValid) ? '2px solid #fff' : `2px solid ${card.color === 'black' ? '#555' : '#fff'}`
                                }}
                            >
                                <div style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '12px' }}>{renderCardValue(card)}</div>
                                {renderCardValue(card)}
                                <div style={{ position: 'absolute', bottom: '4px', right: '4px', fontSize: '12px', transform: 'rotate(180deg)' }}>{renderCardValue(card)}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Color Picker Modal for Wild Cards */}
            {selectedWildIndex !== null && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.8)', zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div className="glass-card" style={{ textAlign: 'center' }}>
                        <h2>Choose a Color</h2>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button style={{ ...getCardStyle('red'), width: 60, height: 60 }} onClick={() => handlePlayWild('red')}></button>
                            <button style={{ ...getCardStyle('blue'), width: 60, height: 60 }} onClick={() => handlePlayWild('blue')}></button>
                            <button style={{ ...getCardStyle('green'), width: 60, height: 60 }} onClick={() => handlePlayWild('green')}></button>
                            <button style={{ ...getCardStyle('yellow'), width: 60, height: 60 }} onClick={() => handlePlayWild('yellow')}></button>
                        </div>
                        <button className="btn-secondary" style={{ marginTop: '20px' }} onClick={() => setSelectedWildIndex(null)}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}
