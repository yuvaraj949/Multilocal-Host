import React, { useState } from 'react';

export default function Quiz({ roomState, socket, roomCode, onReturnLobby }) {
    const [selectedOption, setSelectedOption] = useState(null);

    if (!roomState || !roomState.gameState) return <div className="game-card glass-card"><p>Loading questions...</p></div>;

    const gs = roomState.gameState;
    const questions = gs.questions || [];
    const currentQIndex = gs.currentQuestion;
    const question = questions[currentQIndex];

    // If game finished
    if (roomState.state === 'finished') {
        const playersRanked = [...roomState.players].sort((a, b) => (gs.scores[b.id] || 0) - (gs.scores[a.id] || 0));
        const isHost = roomState.players.find(p => p.id === socket.id)?.isHost;

        return (
            <div className="game-card glass-card fade-in">
                <h2>🎉 Game Over!</h2>
                <h3>Final Scores</h3>
                <div className="leaderboard">
                    {playersRanked.map((p, index) => (
                        <div key={p.id} className={`lb-entry ${index === 0 ? 'lb-first' : ''}`}>
                            <span className="rank">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</span>
                            <span className="name">{p.name}</span>
                            <span className="score">{gs.scores[p.id] || 0} pts</span>
                        </div>
                    ))}
                </div>
                {isHost && (
                    <button className="btn-primary mt-2" onClick={onReturnLobby}>Return to Lobby</button>
                )}
            </div>
        );
    }

    if (!question) {
        return <div className="game-card glass-card"><p>Loading question...</p></div>;
    }

    const hasAnswered = Object.keys(gs.answersThisRound || {}).includes(socket.id);
    const totalAnswers = Object.keys(gs.answersThisRound || {}).length;

    const handleAnswer = (index) => {
        if (!hasAnswered) {
            setSelectedOption(index);
            socket.emit('submit_answer', { roomCode, answerIndex: index });
        }
    };

    return (
        <div className="game-card glass-card fade-in">
            <div className="quiz-header">
                <span>Question {currentQIndex + 1} / {questions.length}</span>
                <span className="answers-count">{totalAnswers} / {roomState.players.length} answered</span>
            </div>

            <h2 className="quiz-q">{question.question}</h2>

            <div className="quiz-options">
                {question.options.map((opt, i) => (
                    <button
                        key={i}
                        className={`qz-btn ${hasAnswered && selectedOption === i ? 'qz-selected' : ''} ${hasAnswered ? 'qz-disabled' : ''}`}
                        onClick={() => handleAnswer(i)}
                        disabled={hasAnswered}
                    >
                        {opt}
                    </button>
                ))}
            </div>

            {hasAnswered && (
                <p className="waiting-text mt-2">✅ Answered! Waiting for others... ({totalAnswers}/{roomState.players.length})</p>
            )}
        </div>
    );
}
