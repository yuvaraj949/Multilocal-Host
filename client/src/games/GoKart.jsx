import React, { useEffect, useRef, useState, useCallback } from 'react';

// ── Track definition (waypoints for closed-loop oval + chicane) ──
const TRACK_WIDTH = 52;
const CANVAS_W = 360;
const CANVAS_H = 600;

// Center-line waypoints of the track (x, y)
const WAYPOINTS = [
    [180, 80],   // top start/finish
    [290, 120],
    [310, 200],
    [290, 300],
    [240, 370],
    [280, 440],
    [300, 510],
    [200, 550],
    [100, 510],
    [120, 440],
    [80, 370],
    [60, 260],
    [80, 160],
    [100, 100],
    [180, 80],   // back to start
];

// Colours for up to 20 players (cycling)
const KART_COLOURS = [
    '#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#a29bfe',
    '#fd79a8', '#fdcb6e', '#00cec9', '#6c5ce7', '#e17055',
    '#55efc4', '#74b9ff', '#ff7675', '#b2bec3', '#0984e3',
    '#e84393', '#00b894', '#e67e22', '#9b59b6', '#1abc9c',
];

// Point at distance t along polyline
function interpolate(waypoints, t) {
    const totalLen = waypoints.reduce((acc, _, i) => {
        if (i === 0) return acc;
        const dx = waypoints[i][0] - waypoints[i - 1][0];
        const dy = waypoints[i][1] - waypoints[i - 1][1];
        return acc + Math.sqrt(dx * dx + dy * dy);
    }, 0);
    const target = ((t % 1) + 1) % 1 * totalLen;
    let covered = 0;
    for (let i = 1; i < waypoints.length; i++) {
        const dx = waypoints[i][0] - waypoints[i - 1][0];
        const dy = waypoints[i][1] - waypoints[i - 1][1];
        const seg = Math.sqrt(dx * dx + dy * dy);
        if (covered + seg >= target) {
            const frac = (target - covered) / seg;
            return [waypoints[i - 1][0] + dx * frac, waypoints[i - 1][1] + dy * frac];
        }
        covered += seg;
    }
    return waypoints[0];
}

function drawTrack(ctx) {
    // Outer shadow
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;

    // Draw thick black border then grey road
    ctx.lineWidth = TRACK_WIDTH + 10;
    ctx.strokeStyle = '#222';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.lineWidth = TRACK_WIDTH;
    ctx.strokeStyle = '#3d4a5a';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // Dashed centre line
    ctx.setLineDash([12, 12]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line
    ctx.lineWidth = TRACK_WIDTH;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(WAYPOINTS[0][0] - 2, WAYPOINTS[0][1]);
    ctx.lineTo(WAYPOINTS[0][0] + 2, WAYPOINTS[0][1]);
    ctx.stroke();

    // Chequered start/finish
    const sfx = WAYPOINTS[0][0];
    const sfy = WAYPOINTS[0][1];
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'white' : 'black';
        ctx.fillRect(sfx - TRACK_WIDTH / 2 + i * (TRACK_WIDTH / 6), sfy - 6, TRACK_WIDTH / 6, 12);
    }
}

function drawKart(ctx, x, y, angle, colour, name, isMe) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Glow for self
    if (isMe) {
        ctx.shadowColor = colour;
        ctx.shadowBlur = 14;
    }

    // Body
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(-9, -14, 18, 28, 4);
    ctx.fill();

    // Cockpit
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -2, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#111';
    [[-11, -10], [11, -10], [-11, 10], [11, 10]].forEach(([wx, wy]) => {
        ctx.fillRect(wx - 3, wy - 4, 6, 8);
    });

    ctx.shadowBlur = 0;
    ctx.restore();

    // Name tag
    ctx.save();
    ctx.font = isMe ? 'bold 10px sans-serif' : '9px sans-serif';
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(name, x, y - 18);
    ctx.restore();
}

// ── Main Component ──
export default function GoKart({ roomState, socket, roomCode, onReturnLobby }) {
    const canvasRef = useRef(null);
    const animRef = useRef(null);
    const stateRef = useRef(null);
    const touchRef = useRef({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
    const tiltRef = useRef(0);        // -1 (left) to +1 (right)
    const throttleRef = useRef(0);   // 0 to 1
    const myProgressRef = useRef(0); // 0-1+ track progress
    const myAngleRef = useRef(-Math.PI / 2);
    const mySpeedRef = useRef(0);
    const lastTimeRef = useRef(null);
    const [positions, setPositions] = useState([]);
    const [myProgress, setMyProgress] = useState(0);
    const [laps, setLaps] = useState(0);
    const [finished, setFinished] = useState(false);
    const [countdown, setCountdown] = useState(3);
    const [racing, setRacing] = useState(false);
    const [results, setResults] = useState(null);
    const [deviceTilt, setDeviceTilt] = useState(false);

    const gs = roomState?.gameState;
    const myId = socket.id;
    const players = roomState?.players || [];
    const me = players.find(p => p.id === myId);
    const isHost = me?.isHost;
    const TOTAL_LAPS = gs?.totalLaps || 3;

    // ── Countdown ──
    useEffect(() => {
        if (roomState?.state !== 'playing') return;
        let n = 3;
        setCountdown(3);
        setRacing(false);
        const iv = setInterval(() => {
            n--;
            setCountdown(n);
            if (n <= 0) { clearInterval(iv); setRacing(true); }
        }, 1000);
        return () => clearInterval(iv);
    }, [roomState?.state]);

    // ── Device orientation (tilt steering) ──
    useEffect(() => {
        const handler = (e) => {
            if (e.gamma !== null) {
                tiltRef.current = Math.max(-1, Math.min(1, e.gamma / 30));
                setDeviceTilt(true);
            }
        };
        window.addEventListener('deviceorientation', handler);
        return () => window.removeEventListener('deviceorientation', handler);
    }, []);

    // ── Touch controls ──
    const handleTouchStart = useCallback((e) => {
        const t = e.touches[0];
        touchRef.current = { active: true, startX: t.clientX, startY: t.clientY, dx: 0, dy: 0 };
    }, []);

    const handleTouchMove = useCallback((e) => {
        e.preventDefault();
        const t = e.touches[0];
        touchRef.current.dx = t.clientX - touchRef.current.startX;
        touchRef.current.dy = t.clientY - touchRef.current.startY;
        if (!deviceTilt) tiltRef.current = Math.max(-1, Math.min(1, touchRef.current.dx / 80));
        throttleRef.current = Math.max(0, Math.min(1, 1 - touchRef.current.dy / 100));
    }, [deviceTilt]);

    const handleTouchEnd = useCallback(() => {
        touchRef.current.active = false;
        if (!deviceTilt) tiltRef.current = 0;
        throttleRef.current = 0;
    }, [deviceTilt]);

    // ── Socket: position sync ──
    useEffect(() => {
        const iv = setInterval(() => {
            if (!racing) return;
            socket.emit('kart_position', {
                roomCode,
                progress: myProgressRef.current,
                angle: myAngleRef.current,
                laps: Math.floor(myProgressRef.current),
            });
        }, 80);
        return () => clearInterval(iv);
    }, [racing, roomCode, socket]);

    useEffect(() => {
        socket.on('kart_positions', (data) => {
            setPositions(data);
            stateRef.current = data;
        });
        socket.on('race_finished', (res) => {
            setResults(res);
            setFinished(true);
        });
        return () => {
            socket.off('kart_positions');
            socket.off('race_finished');
        };
    }, [socket]);

    // ── Game loop ──
    useEffect(() => {
        if (!racing || finished) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const loop = (time) => {
            const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 0.016;
            lastTimeRef.current = time;

            // ── Physics ──
            const MAX_SPEED = 0.18; // progress units/sec
            const ACCEL = 0.4;
            const DECEL = 0.6;
            const TURN_SPEED = 2.0;

            const targetSpeed = racing ? throttleRef.current * MAX_SPEED + 0.04 : 0;
            if (mySpeedRef.current < targetSpeed) mySpeedRef.current = Math.min(targetSpeed, mySpeedRef.current + ACCEL * dt);
            else mySpeedRef.current = Math.max(targetSpeed, mySpeedRef.current - DECEL * dt);

            // Advance progress
            myProgressRef.current += mySpeedRef.current * dt;
            myAngleRef.current += tiltRef.current * TURN_SPEED * dt;

            const lapCount = Math.floor(myProgressRef.current);
            setMyProgress(myProgressRef.current);
            setLaps(lapCount);

            // ── Draw ──
            ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

            // Dark background
            ctx.fillStyle = '#1a2332';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            // Grass texture
            ctx.fillStyle = '#1e3a1e';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            drawTrack(ctx);

            // Other players
            (stateRef.current || []).forEach((p) => {
                if (p.id === myId) return;
                const pidx = players.findIndex(pl => pl.id === p.id);
                const colour = KART_COLOURS[pidx % KART_COLOURS.length];
                const t = ((p.progress % 1) + 1) % 1;
                const [px, py] = interpolate(WAYPOINTS, t);
                const pname = players.find(pl => pl.id === p.id)?.name || '?';
                drawKart(ctx, px, py, p.angle, colour, pname, false);
            });

            // My kart
            const myT = ((myProgressRef.current % 1) + 1) % 1;
            const [mx, my] = interpolate(WAYPOINTS, myT);
            const myIdx = players.findIndex(p => p.id === myId);
            drawKart(ctx, mx, my, myAngleRef.current, KART_COLOURS[myIdx % KART_COLOURS.length], me?.name || 'You', true);

            // Lap indicator on canvas
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(8, 8, 120, 32);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`Lap ${Math.min(lapCount + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`, 16, 28);

            animRef.current = requestAnimationFrame(loop);
        };

        animRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animRef.current);
    }, [racing, finished, players, myId, me, TOTAL_LAPS]);

    // Finish detection
    useEffect(() => {
        if (Math.floor(myProgressRef.current) >= TOTAL_LAPS && !finished) {
            socket.emit('kart_finished', { roomCode, laps: TOTAL_LAPS });
        }
    }, [laps, finished, TOTAL_LAPS, roomCode, socket]);

    // Results screen
    if (finished && results) {
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <h2 style={{ fontSize: '1.8em', marginBottom: 8 }}>🏁 Race Over!</h2>
                <div className="glass-card" style={{ margin: '16px auto', maxWidth: 340 }}>
                    <h3 style={{ marginBottom: 12, color: '#ffd700' }}>🏆 Results</h3>
                    {results.map((r, i) => (
                        <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', marginBottom: 6,
                            background: r.id === myId ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.05)',
                            borderRadius: 10, fontSize: '1em'
                        }}>
                            <span style={{ fontSize: '1.4em', minWidth: 32 }}>
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                            </span>
                            <span style={{ flex: 1, textAlign: 'left', fontWeight: r.id === myId ? 700 : 400 }}>{r.name}</span>
                            <span style={{ opacity: 0.7, fontSize: '0.85em' }}>{r.time}s</span>
                        </div>
                    ))}
                </div>
                {isHost && (
                    <button className="btn-primary" style={{ marginTop: 12 }} onClick={onReturnLobby}>
                        Return to Lobby
                    </button>
                )}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', padding: '8px 0', userSelect: 'none' }}>
            {/* Header */}
            <div style={{ width: '100%', maxWidth: CANVAS_W, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 8px' }}>
                <div>
                    <span style={{ fontSize: '1.2em', fontWeight: 700 }}>🏎️ Go Kart</span>
                </div>
                <div style={{ fontSize: '0.85em', opacity: 0.7 }}>
                    Lap {Math.min(laps + 1, TOTAL_LAPS)}/{TOTAL_LAPS}
                </div>
                <div style={{ fontSize: '0.75em', opacity: 0.6 }}>
                    {(positions.length)} racers
                </div>
            </div>

            {/* Canvas */}
            <div style={{ position: 'relative', width: CANVAS_W, height: CANVAS_H, touchAction: 'none' }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ borderRadius: 16, display: 'block' }} />

                {/* Countdown overlay */}
                {!racing && countdown > 0 && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.6)', borderRadius: 16
                    }}>
                        <div style={{ fontSize: '6em', fontWeight: 900, color: countdown === 1 ? '#ff4757' : countdown === 2 ? '#ffa502' : '#2ed573', textShadow: '0 0 40px currentColor' }}>
                            {countdown}
                        </div>
                    </div>
                )}
                {!racing && countdown === 0 && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.4)', borderRadius: 16, pointerEvents: 'none'
                    }}>
                        <div style={{ fontSize: '4em', fontWeight: 900, color: '#2ed573', textShadow: '0 0 40px #2ed573' }}>GO!</div>
                    </div>
                )}

                {/* Touch hint */}
                {racing && (
                    <div style={{
                        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                        fontSize: '0.7em', opacity: 0.4, color: '#fff', pointerEvents: 'none'
                    }}>
                        {deviceTilt ? '📱 Tilt to steer · Hold screen to speed up' : '👈 Swipe left/right to steer · Swipe up to accelerate'}
                    </div>
                )}
            </div>

            {/* Minimap / leaderboard */}
            <div style={{ width: '100%', maxWidth: CANVAS_W, marginTop: 12, padding: '0 8px' }}>
                <div className="glass-card" style={{ padding: 12 }}>
                    <div style={{ fontSize: '0.75em', fontWeight: 700, marginBottom: 8, opacity: 0.7 }}>STANDINGS</div>
                    {[...positions].sort((a, b) => b.progress - a.progress).map((p, i) => {
                        const pname = players.find(pl => pl.id === p.id)?.name || '?';
                        const pidx = players.findIndex(pl => pl.id === p.id);
                        return (
                            <div key={p.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontWeight: p.id === myId ? 700 : 400
                            }}>
                                <span style={{ minWidth: 24, opacity: 0.7 }}>#{i + 1}</span>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: KART_COLOURS[pidx % KART_COLOURS.length], flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: '0.9em' }}>{pname}{p.id === myId ? ' (you)' : ''}</span>
                                <span style={{ fontSize: '0.75em', opacity: 0.6 }}>Lap {Math.min(Math.floor(p.progress) + 1, TOTAL_LAPS)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Mobile accelerator button (fallback) */}
            {!deviceTilt && racing && (
                <div style={{ width: '100%', maxWidth: CANVAS_W, display: 'flex', gap: 8, padding: '8px 8px 0', marginTop: 4 }}>
                    <button
                        style={{ flex: 1, padding: '20px 0', fontSize: '1.5em', borderRadius: 12, background: '#e17055', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                        onTouchStart={() => { tiltRef.current = -0.6; }}
                        onTouchEnd={() => { tiltRef.current = 0; }}
                    >◀</button>
                    <button
                        style={{ flex: 2, padding: '20px 0', fontSize: '1.2em', borderRadius: 12, background: '#2ed573', border: 'none', color: '#1a2332', fontWeight: 900, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                        onTouchStart={() => { throttleRef.current = 1; }}
                        onTouchEnd={() => { throttleRef.current = 0; }}
                    >🚀 GAS</button>
                    <button
                        style={{ flex: 1, padding: '20px 0', fontSize: '1.5em', borderRadius: 12, background: '#e17055', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                        onTouchStart={() => { tiltRef.current = 0.6; }}
                        onTouchEnd={() => { tiltRef.current = 0; }}
                    >▶</button>
                </div>
            )}
        </div>
    );
}
