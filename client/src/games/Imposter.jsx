import React, { useState, useEffect } from 'react';

export default function Imposter({ roomState, socket, roomCode, onReturnLobby }) {
    const [myRole, setMyRole] = useState(null);
    const [myVote, setMyVote] = useState(null);
    const [hasKilledThisNight, setHasKilledThisNight] = useState(false);

    const gs = roomState.gameState;
    const isHost = roomState.players.find(p => p.id === socket.id)?.isHost;
    const isDead = gs.deadPlayers?.includes(socket.id);
    const isImposter = myRole?.role === 'imposter';

    useEffect(() => {
        const handleSecretRole = (data) => setMyRole(data);
        socket.on('secret_role', handleSecretRole);
        socket.emit('request_role', { roomCode });
        return () => socket.off('secret_role', handleSecretRole);
    }, [socket, roomCode]);

    // Reset vote + kill state when phase changes
    const [prevPhase, setPrevPhase] = useState(gs?.phase);
    if (gs && gs.phase !== prevPhase) {
        setPrevPhase(gs.phase);
        setMyVote(null);
        // Reset kill ability when night resets
        if (gs.phase === 'night') setHasKilledThisNight(false);
    }

    if (!gs) return null;

    // --- REVEALED PHASE (Game Over) ---
    if (roomState.state === 'finished' || gs.phase === 'revealed') {
        const imposterPlayer = roomState.players.find(p => p.id === gs.imposterId);
        const crewmatesWon = gs.winner === 'crewmates';

        return (
            <div className="game-card glass-card fade-in">
                <h2>Game Over</h2>
                <div className="reveal-box">
                    {crewmatesWon ? (
                        <div className="win-msg success">🎉 Crewmates Win! The Imposter was ejected.</div>
                    ) : (
                        <div className="win-msg danger">😈 Imposter Wins! Not enough Crewmates left.</div>
                    )}
                    <p className="mt-2">The Imposter was: <strong className="danger-text">{imposterPlayer?.name}</strong></p>
                    {gs.deadPlayers?.length > 0 && (
                        <p>Eliminated: {gs.deadPlayers.map(id => roomState.players.find(p => p.id === id)?.name).filter(Boolean).join(', ')}</p>
                    )}
                </div>
                {isHost && (
                    <button className="btn-primary mt-2" onClick={onReturnLobby}>Return to Lobby</button>
                )}
            </div>
        );
    }

    // --- DEAD PLAYER VIEW ---
    if (isDead) {
        return (
            <div className="game-card glass-card fade-in" style={{ opacity: 0.7 }}>
                <h2>💀 You were eliminated</h2>
                <p>Watch silently as the game unfolds...</p>
                <div className="mt-2">
                    <span className="game-badge">PHASE: {gs.phase.toUpperCase().replace('_', ' ')}</span>
                    {gs.lastKilled && (
                        <p className="mt-2 danger-text">Last eliminated: {roomState.players.find(p => p.id === gs.lastKilled)?.name}</p>
                    )}
                </div>
            </div>
        );
    }

    // --- ACTIVE GAME ---
    const alivePlayers = roomState.players.filter(p => !gs.deadPlayers.includes(p.id));

    return (
        <div className="game-card glass-card fade-in">
            <div className="quiz-header">
                <span>Phase: <strong className={gs.phase.startsWith('night') ? 'danger-text' : 'highlight-text'}>{gs.phase.toUpperCase().replace('_', ' ')}</strong></span>
                <span>Alive: {alivePlayers.length}/{roomState.players.length}</span>
            </div>

            {/* Role Display */}
            <div className="secret-role-box">
                {myRole ? (
                    <>
                        <h3>Your Role</h3>
                        <div className={`secret-word ${isImposter ? 'danger-text' : 'success-text'}`}>
                            {isImposter ? '🔪 IMPOSTER' : '👨‍🚀 CREWMATE'}
                        </div>
                        <p className="mt-1">{isImposter ? 'Eliminate crewmates without getting caught.' : 'Vote out the Imposter!'}</p>
                    </>
                ) : (
                    <p>Receiving role assignment...</p>
                )}
            </div>

            <div className="mt-2">
                {/* NIGHT PHASE */}
                {gs.phase === 'night' && (
                    <div className="night-phase">
                        <h3 className="danger-text">🌙 Night Phase</h3>
                        {isImposter ? (
                            hasKilledThisNight ? (
                                <p className="waiting-text">You made your move. Waiting for morning...</p>
                            ) : (
                                <div className="imposter-action">
                                    <p>Choose a crewmate to eliminate:</p>
                                    <div className="player-grid">
                                        {alivePlayers.filter(p => p.id !== socket.id).map(p => (
                                            <button
                                                key={p.id}
                                                className="qz-btn danger-btn"
                                                onClick={() => {
                                                    setHasKilledThisNight(true);
                                                    socket.emit('imposter_kill', { roomCode, targetId: p.id });
                                                }}
                                            >
                                                🔪 {p.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        ) : (
                            <p className="waiting-text">💤 The lights are out. Wait for morning...</p>
                        )}

                        {/* Host override always visible for debugging edge cases */}
                        {isHost && !isImposter && (
                            <button className="btn-secondary mt-2" style={{ opacity: 0.4, fontSize: '0.75em' }}
                                onClick={() => socket.emit('change_phase', { roomCode, newPhase: 'day_discussion' })}>
                                Force Morning (Host)
                            </button>
                        )}
                    </div>
                )}

                {/* DAY DISCUSSION */}
                {gs.phase === 'day_discussion' && (
                    <div className="discussion-phase">
                        {gs.lastKilled ? (
                            <p className="danger-text"><strong>😵 {roomState.players.find(p => p.id === gs.lastKilled)?.name}</strong> was killed last night!</p>
                        ) : (
                            <p className="success-text">☀️ Nobody died last night!</p>
                        )}
                        <p className="mt-2">Discuss who you think the Imposter is.</p>
                        {isHost && (
                            <button className="btn-secondary mt-2"
                                onClick={() => socket.emit('change_phase', { roomCode, newPhase: 'day_voting' })}>
                                End Discussion &amp; Vote
                            </button>
                        )}
                    </div>
                )}

                {/* DAY VOTING */}
                {gs.phase === 'day_voting' && (
                    <div className="voting-phase">
                        <h3>🗳️ Vote to Eject</h3>
                        <div className="player-grid">
                            {alivePlayers.map(p => (
                                <button
                                    key={p.id}
                                    className={`qz-btn ${myVote === p.id ? 'qz-selected' : ''}`}
                                    disabled={myVote !== null}
                                    onClick={() => {
                                        setMyVote(p.id);
                                        socket.emit('imposter_vote', { roomCode, votedId: p.id });
                                    }}
                                >
                                    {p.name} {p.id === socket.id ? '(You)' : ''}
                                </button>
                            ))}
                            <button
                                className={`qz-btn ${myVote === 'skip' ? 'qz-selected' : ''}`}
                                disabled={myVote !== null}
                                style={{ background: 'rgba(100,100,100,0.3)' }}
                                onClick={() => {
                                    setMyVote('skip');
                                    socket.emit('imposter_vote', { roomCode, votedId: 'skip' });
                                }}
                            >
                                ⏭️ Skip Vote
                            </button>
                        </div>
                        {myVote && (
                            <p className="mt-1 waiting-text">
                                Voted! Waiting for others... ({Object.keys(gs.votes || {}).length}/{alivePlayers.length})
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
