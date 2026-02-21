import React, { useState, useEffect, useRef } from 'react';

export default function MrWhite({ roomState, socket, roomCode, onReturnLobby }) {
    const [myRole, setMyRole] = useState(null);
    const [myVote, setMyVote] = useState(null);
    const [wordVisible, setWordVisible] = useState(true);
    const [countdown, setCountdown] = useState(5);
    const countRef = useRef(null);

    const gs = roomState.gameState;
    const isHost = roomState.players.find(p => p.id === socket.id)?.isHost;
    const myId = socket.id;

    // Get role on mount / when game starts
    useEffect(() => {
        const onRole = (data) => {
            setMyRole(data);
            setWordVisible(true);
            setCountdown(5);
        };
        socket.on('secret_role', onRole);
        socket.emit('request_role', { roomCode });
        return () => socket.off('secret_role', onRole);
    }, [socket, roomCode]);

    // Countdown to auto-hide word (5 seconds)
    useEffect(() => {
        if (!wordVisible) return;
        if (countdown <= 0) { setWordVisible(false); return; }
        countRef.current = setInterval(() => {
            setCountdown(c => {
                if (c <= 1) { clearInterval(countRef.current); setWordVisible(false); return 0; }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(countRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wordVisible, myRole]);

    // Reset vote when phase changes
    const [prevPhase, setPrevPhase] = useState(gs?.phase);
    if (gs && gs.phase !== prevPhase) {
        setPrevPhase(gs.phase);
        setMyVote(null);
        // Reset word visibility for new round
        if (gs.phase === 'discussion') {
            setWordVisible(true);
            setCountdown(5);
        }
    }

    if (!gs) return null;

    // ── GAME OVER ──
    if (roomState.state === 'finished' || gs.phase === 'revealed') {
        const mrWhitePlayer = roomState.players.find(p => p.id === gs.mrWhiteId);
        const citizensWon = gs.winner === 'citizens';

        return (
            <div className="game-card glass-card fade-in">
                <h2>🎭 Game Over</h2>
                <div className="reveal-box">
                    {citizensWon ? (
                        <div className="win-msg success">🎉 Citizens Win! Mr. White was caught!</div>
                    ) : (
                        <div className="win-msg danger">😈 Mr. White Wins! Citizens couldn't find them.</div>
                    )}
                    <p className="mt-2">Mr. White was: <strong className="danger-text">{mrWhitePlayer?.name}</strong></p>
                    <p>The secret word was: <strong className="highlight-text">{gs.secretWord}</strong></p>
                    {gs.eliminatedPlayers?.length > 0 && (
                        <p style={{ opacity: 0.7, fontSize: '0.85em' }}>
                            Eliminated along the way: {gs.eliminatedPlayers.map(id =>
                                roomState.players.find(p => p.id === id)?.name
                            ).filter(Boolean).join(', ')}
                        </p>
                    )}
                </div>
                {isHost && <button className="btn-primary mt-2" onClick={onReturnLobby}>Return to Lobby</button>}
            </div>
        );
    }

    // ── ACTIVE GAME ──
    const activePlayers = roomState.players.filter(p => gs.activePlayers?.includes(p.id));
    const eliminatedPlayers = roomState.players.filter(p => gs.eliminatedPlayers?.includes(p.id));
    const speakingOrder = gs.speakingOrder || [];
    const currentSpeakerIndex = gs.currentSpeakerIndex ?? 0;
    const currentSpeakerId = speakingOrder[currentSpeakerIndex];
    const allSpoken = currentSpeakerIndex >= speakingOrder.length;
    const isMyTurn = currentSpeakerId === myId;

    return (
        <div className="game-card glass-card fade-in">
            {/* Header */}
            <div className="quiz-header">
                <span>Round <strong>{gs.round || 1}</strong> · {gs.phase === 'discussion' ? '💬 Discussion' : '🗳️ Voting'}</span>
                <span>{activePlayers.length} Active Players</span>
            </div>

            {gs.tied && (
                <div className="tie-notice">⚖️ Tie vote! No one was eliminated. Starting new round.</div>
            )}
            {gs.lastEliminated && !gs.tied && gs.phase === 'discussion' && (
                <div className="elimination-notice">
                    ❌ <strong>{roomState.players.find(p => p.id === gs.lastEliminated)?.name}</strong> was eliminated last round.
                </div>
            )}

            {/* Word / Role Card */}
            <div className="secret-role-box">
                {myRole ? (
                    <>
                        <div className="role-label">
                            {myRole.role === 'mrwhite' ? '🕵️ Mr. White' : '👤 Citizen'}
                        </div>
                        <div className="word-reveal-area">
                            {wordVisible ? (
                                <>
                                    <div className={`secret-word ${myRole.role === 'mrwhite' ? 'danger-text' : 'highlight-text'}`}>
                                        {myRole.word}
                                    </div>
                                    <p className="word-hint">
                                        {myRole.role === 'mrwhite'
                                            ? '⚠️ You don\'t know the word — blend in!'
                                            : 'Describe it without saying it directly!'}
                                    </p>
                                    {countdown > 0 && (
                                        <p className="countdown-hint">Hiding in {countdown}s...</p>
                                    )}
                                </>
                            ) : (
                                <button className="reveal-toggle" onClick={() => { setWordVisible(true); setCountdown(5); }}>
                                    👁️ Tap to reveal word
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <p>Receiving your role...</p>
                )}
            </div>

            {/* Discussion Phase */}
            {gs.phase === 'discussion' && (
                <div className="discussion-section">
                    <h3>🎤 Speaking Order</h3>
                    <div className="speaking-order-list">
                        {speakingOrder.map((pid, idx) => {
                            const player = roomState.players.find(p => p.id === pid);
                            const spoken = idx < currentSpeakerIndex;
                            const current = idx === currentSpeakerIndex;
                            const isMe = pid === myId;
                            return (
                                <div key={pid} className={`speaker-item ${current ? 'speaker-current' : ''} ${spoken ? 'speaker-done' : ''}`}>
                                    <span className="speaker-num">{idx + 1}</span>
                                    <span className="speaker-name">
                                        {player?.name || 'Unknown'} {isMe ? '(You)' : ''}
                                    </span>
                                    {spoken && <span className="speaker-tick">✓</span>}
                                    {current && !allSpoken && <span className="speaker-indicator">🎙️ Speaking</span>}
                                </div>
                            );
                        })}
                    </div>

                    {isMyTurn && !allSpoken && (
                        <div className="your-turn-banner">
                            <p>🎙️ <strong>It's your turn!</strong> Say something about your word.</p>
                            <button className="btn-primary" onClick={() => socket.emit('done_speaking', { roomCode })}>
                                ✅ Done Speaking
                            </button>
                        </div>
                    )}

                    {!isMyTurn && !allSpoken && (
                        <p className="waiting-text">
                            Waiting for <strong>{roomState.players.find(p => p.id === currentSpeakerId)?.name}</strong> to speak...
                        </p>
                    )}

                    {allSpoken && isHost && (
                        <button className="btn-secondary mt-2" onClick={() => socket.emit('change_phase', { roomCode, newPhase: 'voting' })}>
                            🗳️ Start Voting
                        </button>
                    )}

                    {allSpoken && !isHost && (
                        <p className="waiting-text">All done speaking. Waiting for host to start voting...</p>
                    )}
                </div>
            )}

            {/* Voting Phase */}
            {gs.phase === 'voting' && (
                <div className="voting-section">
                    <h3>🗳️ Vote for Mr. White</h3>
                    <p style={{ opacity: 0.7, fontSize: '0.85em' }}>Who do you think doesn't know the word?</p>
                    <div className="player-grid">
                        {activePlayers.map(p => (
                            <button
                                key={p.id}
                                className={`qz-btn ${myVote === p.id ? 'qz-selected' : ''}`}
                                disabled={myVote !== null}
                                onClick={() => {
                                    setMyVote(p.id);
                                    socket.emit('submit_vote', { roomCode, votedId: p.id });
                                }}
                            >
                                {p.name} {p.id === myId ? '(You)' : ''}
                            </button>
                        ))}
                    </div>
                    {myVote && (
                        <p className="waiting-text mt-1">
                            Voted! Waiting... ({Object.keys(gs.votes || {}).length}/{activePlayers.length})
                        </p>
                    )}
                </div>
            )}

            {/* Eliminated players */}
            {eliminatedPlayers.length > 0 && (
                <div className="eliminated-list">
                    <span style={{ opacity: 0.6, fontSize: '0.8em' }}>
                        ❌ Eliminated: {eliminatedPlayers.map(p => p.name).join(', ')}
                    </span>
                </div>
            )}
        </div>
    );
}
